const mongoose = require('mongoose');
const ArticleStock = require('../models/ArticleStock');
const MouvementArticle = require('../models/MouvementArticle');
const ApiError = require('../utils/ApiError');
const withTransaction = require('../utils/withTransaction');

const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 100;
const TYPES_SAISIE = ['entree', 'sortie', 'retour', 'ajustement'];

const escapeRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entierPositif = (v) => Number.isInteger(Number(v)) && Number(v) >= 1;

/**
 * Stock des bijoux « en stock » (retour du 23/10/2026) : articles uniques,
 * hors catalogue et hors commandes. Le niveau est toujours la somme des
 * mouvements non annulés — jamais une valeur stockée.
 */

/** Niveau et dernier mouvement de chaque article demandé. */
async function niveaux(articleIds) {
  if (articleIds.length === 0) return new Map();
  const lignes = await MouvementArticle.aggregate([
    { $match: { article_id: { $in: articleIds }, annule: { $ne: true } } },
    { $group: { _id: '$article_id', quantite: { $sum: '$quantite' }, dernier: { $max: '$date' } } },
  ]);
  return new Map(lignes.map((l) => [String(l._id), { quantite: l.quantite, dernier: l.dernier }]));
}

async function niveauArticle(articleId) {
  const map = await niveaux([new mongoose.Types.ObjectId(String(articleId))]);
  return (map.get(String(articleId)) || { quantite: 0 }).quantite;
}

function statutStock(quantite, seuil) {
  if (quantite <= 0) return 'rupture';
  if (seuil > 0 && quantite <= seuil) return 'bas';
  return 'ok';
}

/** Date saisie « yyyy-MM-dd » (jour calendaire, sans décalage de fuseau) ou maintenant. */
function resoudreDate(date) {
  if (!date) return new Date();
  const texte = String(date);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(texte) ? new Date(`${texte}T12:00:00Z`) : new Date(texte);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Date invalide');
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw ApiError.badRequest('La date ne peut pas être dans le futur');
  return d;
}

/** Liste des articles avec leur stock actuel et un résumé (cartes en haut de page). */
async function listerArticles({ pays_id, q, inactifs } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (!inactifs) filtre.actif = true;
  if (q && String(q).trim()) {
    const regex = new RegExp(escapeRegex(String(q).trim()), 'i');
    filtre.$or = [{ nom: regex }, { reference: regex }, { couleur: regex }];
  }
  const articles = await ArticleStock.find(filtre).populate('pays_id', 'code nom').sort({ nom: 1 }).lean();
  const niveauxParId = await niveaux(articles.map((a) => a._id));

  const items = articles.map((a) => {
    const n = niveauxParId.get(String(a._id)) || { quantite: 0, dernier: null };
    return { ...a, quantite: n.quantite, dernier_mouvement: n.dernier, statut_stock: statutStock(n.quantite, a.seuil_alerte || 0) };
  });
  const actifs = items.filter((i) => i.actif);
  return {
    items,
    resume: {
      articles: actifs.length,
      pieces: actifs.reduce((s, i) => s + Math.max(0, i.quantite), 0),
      bas: actifs.filter((i) => i.statut_stock === 'bas').length,
      rupture: actifs.filter((i) => i.statut_stock === 'rupture').length,
    },
  };
}

/** Nouveau produit en stock, avec une quantité de départ facultative. */
async function creerArticle(data, req) {
  const { pays_id, nom, reference, couleur, seuil_alerte, notes, quantite_initiale, commentaire } = data;
  if (!pays_id) throw ApiError.badRequest('Choisissez un pays pour ajouter un produit en stock');
  if (!nom || !String(nom).trim()) throw ApiError.badRequest('Le nom du produit est requis');
  const quantite = Number(quantite_initiale || 0);
  if (!Number.isInteger(quantite) || quantite < 0) throw ApiError.badRequest('La quantité de départ doit être un nombre entier (0 ou plus)');

  const doublon = await ArticleStock.findOne({
    pays_id,
    nom: new RegExp(`^${escapeRegex(String(nom).trim())}$`, 'i'),
    couleur: couleur ? new RegExp(`^${escapeRegex(String(couleur).trim())}$`, 'i') : { $in: [null, ''] },
  });
  if (doublon) throw ApiError.conflict('Ce produit existe déjà dans le stock (même nom et même couleur)');

  return withTransaction(async (session) => {
    const [article] = await ArticleStock.create(
      [{ pays_id, nom, reference, couleur, seuil_alerte: Number(seuil_alerte) || 0, notes, cree_par: req.user.id }],
      { session }
    );
    if (quantite > 0) {
      await MouvementArticle.create(
        [{
          article_id: article._id,
          pays_id,
          type: 'creation',
          quantite,
          commentaire: commentaire || 'Stock de départ',
          saisi_par: req.user.id,
        }],
        { session }
      );
    }
    return { ...article.toObject(), quantite, statut_stock: statutStock(quantite, article.seuil_alerte || 0) };
  });
}

async function modifierArticle(id, data) {
  const autorises = ['nom', 'reference', 'couleur', 'seuil_alerte', 'notes', 'actif'];
  const champs = {};
  for (const cle of autorises) if (data[cle] !== undefined) champs[cle] = data[cle];
  if (champs.nom !== undefined && !String(champs.nom).trim()) throw ApiError.badRequest('Le nom du produit est requis');
  if (champs.seuil_alerte !== undefined) champs.seuil_alerte = Math.max(0, Number(champs.seuil_alerte) || 0);
  const article = await ArticleStock.findByIdAndUpdate(id, champs, { new: true, runValidators: true });
  if (!article) throw ApiError.notFound('Produit en stock introuvable');
  const quantite = await niveauArticle(article._id);
  return { ...article.toObject(), quantite, statut_stock: statutStock(quantite, article.seuil_alerte || 0) };
}

/**
 * Saisie d'un mouvement : entrée (achat), sortie (vente), retour (bijou revenu,
 * non livré) ou ajustement (on indique la quantité réellement comptée ; l'écart
 * est calculé). Une sortie ne peut jamais dépasser le stock disponible.
 */
async function enregistrerMouvement(data, req) {
  const { article_id, type, quantite, quantite_constatee, commentaire, date } = data;
  if (!TYPES_SAISIE.includes(type)) throw ApiError.badRequest('Type de mouvement invalide (entrée, sortie, retour ou ajustement)');
  const article = await ArticleStock.findById(article_id);
  if (!article) throw ApiError.notFound('Produit en stock introuvable');
  if (!article.actif) throw ApiError.conflict('Ce produit est archivé : réactivez-le avant de saisir un mouvement');

  const actuel = await niveauArticle(article._id);
  let signee;
  if (type === 'ajustement') {
    const compte = Number(quantite_constatee);
    if (!Number.isInteger(compte) || compte < 0) throw ApiError.badRequest('Indiquez la quantité réellement comptée (nombre entier, 0 ou plus)');
    signee = compte - actuel;
    if (signee === 0) throw ApiError.badRequest(`Aucun écart : le stock est déjà de ${actuel}`);
  } else {
    if (!entierPositif(quantite)) throw ApiError.badRequest('La quantité doit être un nombre entier supérieur à 0');
    const q = Number(quantite);
    if (type === 'sortie') {
      if (q > actuel) throw ApiError.conflict(`Stock insuffisant : il reste ${actuel} pièce${actuel > 1 ? 's' : ''} de « ${article.nom} »`);
      signee = -q;
    } else {
      signee = q;
    }
  }

  const mouvement = await MouvementArticle.create({
    article_id: article._id,
    pays_id: article.pays_id,
    type,
    quantite: signee,
    commentaire,
    date: resoudreDate(date),
    saisi_par: req.user.id,
  });
  const quantiteApres = actuel + signee;
  return {
    mouvement: mouvement.toObject(),
    article: { _id: article._id, nom: article.nom, quantite: quantiteApres, statut_stock: statutStock(quantiteApres, article.seuil_alerte || 0) },
  };
}

/** Annule une saisie par erreur : le stock ne doit pas devenir négatif. */
async function annulerMouvement(id, req) {
  const mouvement = await MouvementArticle.findById(id);
  if (!mouvement) throw ApiError.notFound('Mouvement introuvable');
  if (mouvement.annule) throw ApiError.conflict('Ce mouvement est déjà annulé');

  const actuel = await niveauArticle(mouvement.article_id);
  if (actuel - mouvement.quantite < 0) {
    throw ApiError.conflict(`Annulation impossible : le stock deviendrait négatif (${actuel - mouvement.quantite}). Annulez d'abord les sorties plus récentes.`);
  }
  mouvement.annule = true;
  mouvement.annule_par = req.user.id;
  mouvement.annule_le = new Date();
  await mouvement.save();
  return mouvement.toObject();
}

async function listerMouvements({ pays_id, article_id, type, date_de, date_a, annules, page, limite } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (article_id) filtre.article_id = article_id;
  if (type) filtre.type = type;
  if (!annules) filtre.annule = { $ne: true };
  if (date_de || date_a) {
    filtre.date = {};
    if (date_de) filtre.date.$gte = new Date(date_de);
    if (date_a) {
      const fin = new Date(date_a);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(date_a))) fin.setUTCHours(23, 59, 59, 999);
      filtre.date.$lte = fin;
    }
  }
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(LIMITE_MAX, Math.max(1, Number(limite) || LIMITE_DEFAUT));
  const [items, total] = await Promise.all([
    MouvementArticle.find(filtre)
      .populate('article_id', 'nom reference couleur')
      .populate('saisi_par', 'nom')
      .sort({ date: -1, createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .lean(),
    MouvementArticle.countDocuments(filtre),
  ]);
  return { items, meta: { page: p, limite: l, total } };
}

module.exports = { listerArticles, creerArticle, modifierArticle, enregistrerMouvement, annulerMouvement, listerMouvements };
