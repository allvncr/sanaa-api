const mongoose = require('mongoose');
const ArticleStock = require('../models/ArticleStock');
const MouvementArticle = require('../models/MouvementArticle');
const Produit = require('../models/Produit');
const Pays = require('../models/Pays');
const Depense = require('../models/Depense');
const CategorieDepense = require('../models/CategorieDepense');
const Commande = require('../models/Commande');
const ApiError = require('../utils/ApiError');
const withTransaction = require('../utils/withTransaction');
const { toDecimal, toDecimal128 } = require('../utils/money');

const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 100;
const TYPES_SAISIE = ['entree', 'sortie', 'retour', 'ajustement'];
const CATEGORIE_ACHAT = 'Achat de stock';
const CATEGORIE_TRANSPORT = 'Transport de stock';

const escapeRegex = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const entierPositif = (v) => Number.isInteger(Number(v)) && Number(v) >= 1;
const texte = (v) => (v === null || v === undefined ? null : v.toString());
const opts = (session) => (session ? { session } : {});

/**
 * Stock des bijoux « en stock » (retour du 23/10/2026) : modèles uniques,
 * achetés en quantité, livrés le jour même. Les ventes passent par les
 * commandes (voir stockCommande.service : réservation à la commande, sortie à la
 * livraison, libération en cas d'échec) ; ici on gère les produits, les achats
 * (avec leur coût), les retours et les inventaires.
 *
 * Niveaux : physique = somme des mouvements (hors réservations) ; réservé =
 * pièces mises de côté par des commandes en cours ; disponible = physique − réservé.
 */

async function niveaux(articleIds) {
  if (articleIds.length === 0) return new Map();
  const lignes = await MouvementArticle.aggregate([
    { $match: { article_id: { $in: articleIds }, annule: { $ne: true } } },
    {
      $group: {
        _id: '$article_id',
        physique: { $sum: { $cond: [{ $eq: ['$type', 'reservation'] }, 0, '$quantite'] } },
        reserve: { $sum: { $cond: [{ $eq: ['$type', 'reservation'] }, { $multiply: ['$quantite', -1] }, 0] } },
        dernier: { $max: { $cond: [{ $eq: ['$type', 'reservation'] }, null, '$date'] } },
      },
    },
  ]);
  return new Map(lignes.map((l) => [String(l._id), { physique: l.physique, reserve: l.reserve, dernier: l.dernier }]));
}

async function niveauArticle(articleId) {
  const map = await niveaux([new mongoose.Types.ObjectId(String(articleId))]);
  const n = map.get(String(articleId)) || { physique: 0, reserve: 0 };
  return { physique: n.physique, reserve: n.reserve, disponible: n.physique - n.reserve };
}

/** Coût d'achat cumulé (pièces + transport) et quantité achetée avec un coût renseigné, par article. */
async function achats(articleIds) {
  if (articleIds.length === 0) return new Map();
  const aCout = { $or: [{ $ne: [{ $ifNull: ['$cout_unitaire', null] }, null] }, { $ne: [{ $ifNull: ['$frais_transport', null] }, null] }] };
  const lignes = await MouvementArticle.aggregate([
    { $match: { article_id: { $in: articleIds }, annule: { $ne: true }, type: { $in: ['creation', 'entree'] } } },
    {
      $group: {
        _id: '$article_id',
        quantite_cout: { $sum: { $cond: [aCout, '$quantite', 0] } },
        pieces: { $sum: { $cond: [aCout, { $multiply: [{ $ifNull: ['$cout_unitaire', 0] }, '$quantite'] }, 0] } },
        transport: { $sum: { $ifNull: ['$frais_transport', 0] } },
      },
    },
  ]);
  return new Map(lignes.map((l) => [String(l._id), l]));
}

/** Pièces livrées et chiffre d'affaires correspondant (commandes confirmées et livrées), par produit miroir. */
async function ventes(produitIds) {
  if (produitIds.length === 0) return new Map();
  const lignes = await Commande.aggregate([
    { $match: { statut_commande: 'Confirmee', statut_livraison: 'Livree', 'lignes.produit_id': { $in: produitIds } } },
    { $unwind: '$lignes' },
    { $match: { 'lignes.produit_id': { $in: produitIds } } },
    { $group: { _id: '$lignes.produit_id', quantite: { $sum: '$lignes.quantite' }, ca: { $sum: '$lignes.sous_total' } } },
  ]);
  return new Map(lignes.map((l) => [String(l._id), l]));
}

function statutStock(disponible, seuil) {
  if (disponible <= 0) return 'rupture';
  if (seuil > 0 && disponible <= seuil) return 'bas';
  return 'ok';
}

/** Date saisie « yyyy-MM-dd » (jour calendaire, sans décalage de fuseau) ou maintenant. */
function resoudreDate(date) {
  if (!date) return new Date();
  const t = String(date);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(`${t}T12:00:00Z`) : new Date(t);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('Date invalide');
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw ApiError.badRequest('La date ne peut pas être dans le futur');
  return d;
}

function montantOptionnel(valeur, libelle) {
  if (valeur === undefined || valeur === null || valeur === '') return null;
  const m = toDecimal(valeur);
  if (m.isNaN() || m.lt(0)) throw ApiError.badRequest(`${libelle} invalide (nombre positif attendu)`);
  return m;
}

/** Assemble un article avec ses niveaux, son coût de revient et sa rentabilité. */
function composer(article, niv, ach, vente) {
  const physique = niv ? niv.physique : 0;
  const reserve = niv ? niv.reserve : 0;
  const disponible = physique - reserve;
  const prixVente = toDecimal(article.prix_vente);

  let coutRevient = null;
  if (ach && ach.quantite_cout > 0) coutRevient = toDecimal(ach.pieces).plus(toDecimal(ach.transport)).div(ach.quantite_cout);
  const vendus = vente ? vente.quantite : 0;
  const ca = vente ? toDecimal(vente.ca) : toDecimal(0);

  return {
    ...article,
    prix_vente: prixVente.toFixed(2),
    quantite: physique,
    reserve,
    disponible,
    dernier_mouvement: niv ? niv.dernier : null,
    statut_stock: statutStock(disponible, article.seuil_alerte || 0),
    cout_revient: coutRevient ? coutRevient.toFixed(2) : null,
    marge_unitaire: coutRevient ? prixVente.minus(coutRevient).toFixed(2) : null,
    valeur_stock: coutRevient ? coutRevient.times(Math.max(0, physique)).toFixed(2) : null,
    vendus,
    chiffre_affaires: ca.toFixed(2),
    benefice: coutRevient && vendus > 0 ? ca.minus(coutRevient.times(vendus)).toFixed(2) : null,
  };
}

/** Liste des articles avec stock, coût de revient et rentabilité, plus un résumé (cartes en haut de page). */
async function listerArticles({ pays_id, q, inactifs } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (!inactifs) filtre.actif = true;
  if (q && String(q).trim()) {
    const regex = new RegExp(escapeRegex(String(q).trim()), 'i');
    filtre.$or = [{ nom: regex }, { reference: regex }, { couleur: regex }];
  }
  const articles = await ArticleStock.find(filtre).populate('pays_id', 'code nom').sort({ nom: 1 }).lean();
  const [niv, ach, ven] = await Promise.all([
    niveaux(articles.map((a) => a._id)),
    achats(articles.map((a) => a._id)),
    ventes(articles.map((a) => a.produit_id).filter(Boolean)),
  ]);

  const items = articles.map((a) => composer(a, niv.get(String(a._id)), ach.get(String(a._id)), ven.get(String(a.produit_id))));
  const actifs = items.filter((i) => i.actif);
  const somme = (liste, cle) => liste.reduce((s, i) => s.plus(toDecimal(i[cle] || 0)), toDecimal(0));
  return {
    items,
    resume: {
      articles: actifs.length,
      pieces: actifs.reduce((s, i) => s + Math.max(0, i.quantite), 0),
      reservees: actifs.reduce((s, i) => s + i.reserve, 0),
      bas: actifs.filter((i) => i.statut_stock === 'bas').length,
      rupture: actifs.filter((i) => i.statut_stock === 'rupture').length,
      valeur_stock: somme(actifs, 'valeur_stock').toFixed(2),
      benefice: somme(items, 'benefice').toFixed(2),
    },
  };
}

async function categorie(nom, session) {
  let c = await CategorieDepense.findOne({ nom }).session(session || null);
  if (!c) [c] = await CategorieDepense.create([{ nom }], opts(session));
  return c;
}

/** Dépenses créées par un achat de stock : les pièces, puis le transport. Retourne leurs ids. */
async function creerDepensesAchat({ pays, article, quantite, coutUnitaire, fraisTransport, date }, req, session) {
  const depenses = [];
  const montantPieces = coutUnitaire ? coutUnitaire.times(quantite) : toDecimal(0);
  if (montantPieces.gt(0)) {
    const cat = await categorie(CATEGORIE_ACHAT, session);
    depenses.push({ categorie_id: cat._id, montant: montantPieces, commentaire: `Achat de stock : ${article.nom} ×${quantite}` });
  }
  if (fraisTransport && fraisTransport.gt(0)) {
    const cat = await categorie(CATEGORIE_TRANSPORT, session);
    depenses.push({ categorie_id: cat._id, montant: fraisTransport, commentaire: `Transport du stock : ${article.nom} ×${quantite}` });
  }
  if (depenses.length === 0) return [];
  const docs = await Depense.create(
    depenses.map((d) => ({
      pays_id: article.pays_id,
      categorie_id: d.categorie_id,
      date,
      montant: toDecimal128(d.montant),
      devise_id: pays.devise_locale_id,
      commentaire: d.commentaire,
      statut: 'validee',
      valide_par: req.user.id,
    })),
    { ...opts(session), ordered: true }
  );
  return docs.map((d) => d._id);
}

/** Produit « miroir » du catalogue : permet de commander l'article (prix, CA, livraison). */
async function creerMiroir({ nom, couleur, pays, prix }, session) {
  const [produit] = await Produit.create(
    [{
      nom,
      fabrication_locale: true,
      en_stock: true,
      nb_prenoms_max: 0,
      statut: 'actif',
      variantes: [{
        couleur,
        prix_pays: [{
          pays_id: pays._id,
          prix: toDecimal128(prix),
          devise_id: pays.devise_locale_id,
          actif: true,
          date_debut_validite: new Date(Date.now() - 60 * 1000),
        }],
      }],
    }],
    opts(session)
  );
  return { produit_id: produit._id, variante_id: produit.variantes[0]._id };
}

/** Nouveau produit en stock : prix de vente, stock de départ et coûts d'achat (facultatifs). */
async function creerArticle(data, req) {
  const { pays_id, nom, reference, couleur, seuil_alerte, notes, quantite_initiale, commentaire } = data;
  if (!pays_id) throw ApiError.badRequest('Choisissez un pays pour ajouter un produit en stock');
  if (!nom || !String(nom).trim()) throw ApiError.badRequest('Le nom du produit est requis');
  const prix = montantOptionnel(data.prix_vente, 'Le prix de vente');
  if (!prix || prix.lte(0)) throw ApiError.badRequest('Indiquez le prix de vente du produit');
  const quantite = Number(quantite_initiale || 0);
  if (!Number.isInteger(quantite) || quantite < 0) throw ApiError.badRequest('La quantité de départ doit être un nombre entier (0 ou plus)');
  const coutUnitaire = montantOptionnel(data.cout_unitaire, "Le coût d'achat");
  const fraisTransport = montantOptionnel(data.frais_transport, 'Les frais de transport');

  const pays = await Pays.findById(pays_id);
  if (!pays) throw ApiError.notFound('Pays introuvable');

  const doublon = await ArticleStock.findOne({
    pays_id,
    nom: new RegExp(`^${escapeRegex(String(nom).trim())}$`, 'i'),
    couleur: couleur ? new RegExp(`^${escapeRegex(String(couleur).trim())}$`, 'i') : { $in: [null, ''] },
  });
  if (doublon) throw ApiError.conflict('Ce produit existe déjà dans le stock (même nom et même couleur)');

  const resultat = await withTransaction(async (session) => {
    const miroir = await creerMiroir({ nom: String(nom).trim(), couleur, pays, prix }, session);
    const [article] = await ArticleStock.create(
      [{
        pays_id, nom, reference, couleur, notes, seuil_alerte: Number(seuil_alerte) || 0,
        prix_vente: toDecimal128(prix), ...miroir, cree_par: req.user.id,
      }],
      opts(session)
    );
    if (quantite > 0) {
      const date = new Date();
      const depenseIds = await creerDepensesAchat({ pays, article, quantite, coutUnitaire, fraisTransport, date }, req, session);
      await MouvementArticle.create(
        [{
          article_id: article._id,
          pays_id,
          type: 'creation',
          quantite,
          cout_unitaire: coutUnitaire ? toDecimal128(coutUnitaire) : undefined,
          frais_transport: fraisTransport ? toDecimal128(fraisTransport) : undefined,
          depense_ids: depenseIds,
          commentaire: commentaire || 'Stock de départ',
          date,
          saisi_par: req.user.id,
        }],
        opts(session)
      );
    }
    return article;
  });
  const liste = await listerArticles({ pays_id });
  return liste.items.find((i) => String(i._id) === String(resultat._id));
}

async function modifierArticle(id, data) {
  const article = await ArticleStock.findById(id);
  if (!article) throw ApiError.notFound('Produit en stock introuvable');

  for (const cle of ['nom', 'reference', 'couleur', 'notes']) if (data[cle] !== undefined) article[cle] = data[cle];
  if (data.nom !== undefined && !String(data.nom).trim()) throw ApiError.badRequest('Le nom du produit est requis');
  if (data.seuil_alerte !== undefined) article.seuil_alerte = Math.max(0, Number(data.seuil_alerte) || 0);
  if (data.actif !== undefined) article.actif = Boolean(data.actif);
  let nouveauPrix = null;
  if (data.prix_vente !== undefined) {
    nouveauPrix = montantOptionnel(data.prix_vente, 'Le prix de vente');
    if (!nouveauPrix || nouveauPrix.lte(0)) throw ApiError.badRequest('Indiquez le prix de vente du produit');
    article.prix_vente = toDecimal128(nouveauPrix);
  }
  await article.save();

  // Le produit miroir suit (nom, couleur, prix, statut) ; les commandes déjà
  // saisies gardent le prix appliqué à l'époque.
  if (article.produit_id) {
    const produit = await Produit.findById(article.produit_id);
    if (produit) {
      produit.nom = article.nom;
      produit.statut = article.actif ? 'actif' : 'inactif';
      const variante = produit.variantes.id(article.variante_id);
      if (variante) {
        variante.couleur = article.couleur;
        if (nouveauPrix) {
          const entree = variante.prix_pays.find((p) => String(p.pays_id) === String(article.pays_id));
          if (entree) entree.prix = toDecimal128(nouveauPrix);
        }
      }
      await produit.save();
    }
  }
  const liste = await listerArticles({ pays_id: article.pays_id, inactifs: 'true' });
  return liste.items.find((i) => String(i._id) === String(article._id));
}

/**
 * Saisie d'un mouvement manuel : entrée (achat, avec coûts), sortie (correction
 * ou vente hors commande), retour (bijou rapporté après livraison) ou
 * ajustement (quantité réellement comptée ; l'écart est calculé). Une sortie ne
 * peut jamais dépasser le stock disponible (hors pièces réservées).
 */
async function enregistrerMouvement(data, req) {
  const { article_id, type, quantite, quantite_constatee, commentaire, date } = data;
  if (!TYPES_SAISIE.includes(type)) throw ApiError.badRequest('Type de mouvement invalide (entrée, sortie, retour ou inventaire)');
  const article = await ArticleStock.findById(article_id);
  if (!article) throw ApiError.notFound('Produit en stock introuvable');
  if (!article.actif) throw ApiError.conflict('Ce produit est archivé : réactivez-le avant de saisir un mouvement');

  const niv = await niveauArticle(article._id);
  let signee;
  if (type === 'ajustement') {
    const compte = Number(quantite_constatee);
    if (!Number.isInteger(compte) || compte < 0) throw ApiError.badRequest('Indiquez la quantité réellement comptée (nombre entier, 0 ou plus)');
    signee = compte - niv.physique;
    if (signee === 0) throw ApiError.badRequest(`Aucun écart : le stock est déjà de ${niv.physique}`);
    if (compte < niv.reserve) {
      throw ApiError.conflict(`Impossible : ${niv.reserve} pièce${niv.reserve > 1 ? 's sont' : ' est'} réservée${niv.reserve > 1 ? 's' : ''} par des commandes en cours (comptées : ${compte})`);
    }
  } else {
    if (!entierPositif(quantite)) throw ApiError.badRequest('La quantité doit être un nombre entier supérieur à 0');
    const q = Number(quantite);
    if (type === 'sortie') {
      if (q > niv.disponible) {
        throw ApiError.conflict(
          `Stock insuffisant : ${niv.disponible} pièce${niv.disponible > 1 ? 's' : ''} disponible${niv.disponible > 1 ? 's' : ''}${niv.reserve ? ` (${niv.reserve} réservée${niv.reserve > 1 ? 's' : ''} par des commandes)` : ''} pour « ${article.nom} »`
        );
      }
      signee = -q;
    } else {
      signee = q;
    }
  }

  const jour = resoudreDate(date);
  const coutUnitaire = type === 'entree' ? montantOptionnel(data.cout_unitaire, "Le coût d'achat") : null;
  const fraisTransport = type === 'entree' ? montantOptionnel(data.frais_transport, 'Les frais de transport') : null;

  const mouvement = await withTransaction(async (session) => {
    let depenseIds = [];
    if (type === 'entree' && (coutUnitaire || fraisTransport)) {
      const pays = await Pays.findById(article.pays_id);
      depenseIds = await creerDepensesAchat({ pays, article, quantite: signee, coutUnitaire, fraisTransport, date: jour }, req, session);
    }
    const [m] = await MouvementArticle.create(
      [{
        article_id: article._id,
        pays_id: article.pays_id,
        type,
        quantite: signee,
        cout_unitaire: coutUnitaire ? toDecimal128(coutUnitaire) : undefined,
        frais_transport: fraisTransport ? toDecimal128(fraisTransport) : undefined,
        depense_ids: depenseIds,
        commentaire,
        date: jour,
        saisi_par: req.user.id,
      }],
      opts(session)
    );
    return m;
  });
  const physique = niv.physique + signee;
  return {
    mouvement: mouvement.toObject(),
    article: {
      _id: article._id, nom: article.nom, quantite: physique, reserve: niv.reserve,
      disponible: physique - niv.reserve, statut_stock: statutStock(physique - niv.reserve, article.seuil_alerte || 0),
    },
  };
}

/** Annule une saisie par erreur (et les dépenses d'achat qu'elle avait créées) ; le stock ne doit pas devenir négatif. */
async function annulerMouvement(id, req) {
  const mouvement = await MouvementArticle.findById(id);
  if (!mouvement) throw ApiError.notFound('Mouvement introuvable');
  if (mouvement.annule) throw ApiError.conflict('Ce mouvement est déjà annulé');
  if (mouvement.auto) throw ApiError.conflict('Ce mouvement vient d\'une commande : modifiez ou annulez la commande pour le corriger');

  const niv = await niveauArticle(mouvement.article_id);
  if (niv.disponible - mouvement.quantite < 0) {
    throw ApiError.conflict(`Annulation impossible : le stock deviendrait négatif (${niv.disponible - mouvement.quantite}). Annulez d'abord les sorties plus récentes.`);
  }
  mouvement.annule = true;
  mouvement.annule_par = req.user.id;
  mouvement.annule_le = new Date();
  await mouvement.save();

  // Les dépenses d'achat liées disparaissent aussi : sinon l'achat annulé resterait dans les dépenses.
  for (const depenseId of mouvement.depense_ids || []) {
    const d = await Depense.findById(depenseId);
    if (d) await Depense.findOneAndDelete({ _id: d._id, pays_id: d.pays_id });
  }
  return mouvement.toObject();
}

async function listerMouvements({ pays_id, article_id, type, date_de, date_a, annules, page, limite } = {}) {
  const filtre = { type: { $ne: 'reservation' } }; // les réservations sont du bruit pour l'utilisateur
  if (type) filtre.type = type;
  if (pays_id) filtre.pays_id = pays_id;
  if (article_id) filtre.article_id = article_id;
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
  const [brut, total] = await Promise.all([
    MouvementArticle.find(filtre)
      .populate('article_id', 'nom reference couleur')
      .populate('saisi_par', 'nom')
      .populate('reference_commande_id', 'numero')
      .sort({ date: -1, createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l),
    MouvementArticle.countDocuments(filtre),
  ]);
  const items = brut.map((m) => {
    const o = m.toObject();
    o.cout_unitaire = texte(o.cout_unitaire);
    o.frais_transport = texte(o.frais_transport);
    return o;
  });
  return { items, meta: { page: p, limite: l, total } };
}

module.exports = { listerArticles, creerArticle, modifierArticle, enregistrerMouvement, annulerMouvement, listerMouvements };
