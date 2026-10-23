const ArticleStock = require('../models/ArticleStock');
const MouvementArticle = require('../models/MouvementArticle');
const ApiError = require('../utils/ApiError');
const { getCurrentUser } = require('../utils/requestContext');

/**
 * Lien entre les commandes et le stock des bijoux « en stock » (retour du
 * 23/10/2026). Chaque article du stock a un produit « miroir » dans le
 * catalogue : une commande qui le contient réserve la pièce, la livraison la
 * fait sortir définitivement, un échec / une annulation la libère.
 *
 * `synchroniser` est IDEMPOTENT : il compare l'état voulu (d'après la commande
 * telle qu'elle est maintenant) à ce que le journal contient déjà pour cette
 * commande, et n'écrit que la différence. On peut donc l'appeler après
 * n'importe quel changement (création, lignes, statuts, suppression) sans
 * risque de double comptage.
 */

const opts = (session) => (session ? { session } : {});

/** Articles du stock correspondant aux lignes (par produit miroir), indexés par id de produit. */
async function articlesDesLignes(lignes, session) {
  const ids = [...new Set(lignes.map((l) => String(l.produit_id)))];
  const articles = await ArticleStock.find({ produit_id: { $in: ids } }).session(session || null);
  return new Map(articles.map((a) => [String(a.produit_id), a]));
}

/**
 * Une commande est « stock » (toutes ses lignes sont des bijoux en stock) ou
 * « normale » (aucune) ; mélanger les deux est refusé.
 * @returns {Promise<{stock: boolean, articles: Map}>}
 */
async function analyserLignes(lignes, session) {
  const articles = await articlesDesLignes(lignes, session);
  if (articles.size === 0) return { stock: false, articles };
  const toutes = lignes.every((l) => articles.has(String(l.produit_id)));
  if (!toutes) {
    throw ApiError.badRequest('Une commande ne peut pas mélanger des bijoux en stock et des bijoux personnalisés : faites deux commandes.');
  }
  return { stock: true, articles };
}

/** Quantité par article demandée par les lignes. */
function quantitesParArticle(lignes, articles) {
  const parArticle = new Map();
  for (const l of lignes) {
    const article = articles.get(String(l.produit_id));
    if (!article) continue;
    const cle = String(article._id);
    parArticle.set(cle, (parArticle.get(cle) || 0) + Number(l.quantite || 0));
  }
  return parArticle;
}

/** Quantité déjà réservée / vendue par cette commande pour chaque article (d'après le journal). */
async function etatActuel(commandeId, session) {
  const lignes = await MouvementArticle.aggregate([
    { $match: { reference_commande_id: commandeId, annule: { $ne: true } } },
    { $group: { _id: { article: '$article_id', type: '$type' }, somme: { $sum: '$quantite' } } },
  ]).session(session || null);
  const etat = new Map();
  for (const l of lignes) {
    const cle = String(l._id.article);
    const e = etat.get(cle) || { reserve: 0, vendu: 0 };
    if (l._id.type === 'reservation') e.reserve = -l.somme;
    if (l._id.type === 'sortie') e.vendu = -l.somme;
    etat.set(cle, e);
  }
  return etat;
}

/** Niveaux (physique, réservé) d'un article, comme dans stock.service. */
async function niveauArticle(articleId, session) {
  const [r] = await MouvementArticle.aggregate([
    { $match: { article_id: articleId, annule: { $ne: true } } },
    {
      $group: {
        _id: null,
        physique: { $sum: { $cond: [{ $eq: ['$type', 'reservation'] }, 0, '$quantite'] } },
        reserve: { $sum: { $cond: [{ $eq: ['$type', 'reservation'] }, { $multiply: ['$quantite', -1] }, 0] } },
      },
    },
  ]).session(session || null);
  const physique = r ? r.physique : 0;
  const reserve = r ? r.reserve : 0;
  return { physique, reserve, disponible: physique - reserve };
}

/**
 * Vérifie qu'il reste assez de pièces pour les lignes. `commandeId` (en cas de
 * modification) : ce que cette commande a déjà réservé ne compte pas contre elle.
 */
async function verifierDisponibilite(lignes, articles, commandeId, session) {
  const demandes = quantitesParArticle(lignes, articles);
  const deja = commandeId ? await etatActuel(commandeId, session) : new Map();
  for (const [articleId, voulu] of demandes) {
    const article = [...articles.values()].find((a) => String(a._id) === articleId);
    const { disponible } = await niveauArticle(article._id, session);
    const dejaReserve = (deja.get(articleId) || { reserve: 0 }).reserve;
    const possible = disponible + dejaReserve;
    if (voulu > possible) {
      throw ApiError.conflict(
        `Stock insuffisant pour « ${article.nom}${article.couleur ? ` · ${article.couleur}` : ''} » : ${possible} disponible${possible > 1 ? 's' : ''}, ${voulu} demandé${voulu > 1 ? 's' : ''}`
      );
    }
  }
}

/**
 * Aligne le journal de stock sur l'état de la commande :
 *  - en cours (confirmée, pas livrée, pas en échec) → pièces réservées ;
 *  - livrée → pièces sorties du stock ;
 *  - annulée / refusée / en échec de livraison / supprimée → rien (pièces libérées).
 */
async function synchroniser(commande, { supprimee = false, session } = {}) {
  if (!commande || !commande.lignes || commande.lignes.length === 0) return;
  const articles = await articlesDesLignes(commande.lignes, session);
  if (articles.size === 0) return;

  let etat = 'reserve';
  if (supprimee || ['Annulee', 'Refusee'].includes(commande.statut_commande)) etat = 'aucun';
  else if (commande.statut_livraison === 'Livree') etat = 'vendu';
  else if (commande.statut_livraison === 'Retour_echec') etat = 'aucun';

  const voulus = quantitesParArticle(commande.lignes, articles);
  const actuel = await etatActuel(commande._id, session);
  const utilisateur = getCurrentUser();
  const mouvements = [];
  const base = (article, type, quantite, commentaire) => ({
    article_id: article._id,
    pays_id: article.pays_id,
    type,
    quantite,
    reference_commande_id: commande._id,
    auto: true,
    commentaire,
    saisi_par: utilisateur ? utilisateur.id : undefined,
  });

  for (const article of articles.values()) {
    const cle = String(article._id);
    const q = voulus.get(cle) || 0;
    const courant = actuel.get(cle) || { reserve: 0, vendu: 0 };
    const reserveVoulue = etat === 'reserve' ? q : 0;
    const venduVoulu = etat === 'vendu' ? q : 0;

    if (reserveVoulue !== courant.reserve) {
      const delta = reserveVoulue - courant.reserve; // > 0 : on réserve plus
      mouvements.push(base(
        article, 'reservation', -delta,
        delta > 0 ? `Réservé pour la commande ${commande.numero}` : `Libéré (commande ${commande.numero})`
      ));
    }
    if (venduVoulu !== courant.vendu) {
      const delta = venduVoulu - courant.vendu; // > 0 : on sort plus de pièces
      mouvements.push(base(
        article, 'sortie', -delta,
        delta > 0 ? `Livraison de la commande ${commande.numero}` : `Retour en stock (commande ${commande.numero})`
      ));
    }
  }
  if (mouvements.length) await MouvementArticle.create(mouvements, { ...opts(session), ordered: true });
}

module.exports = { analyserLignes, verifierDisponibilite, synchroniser, quantitesParArticle };
