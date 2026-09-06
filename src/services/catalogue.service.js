const Categorie = require('../models/Categorie');
const Produit = require('../models/Produit');
const Pays = require('../models/Pays');
const ApiError = require('../utils/ApiError');

async function listerCategories() {
  return Categorie.find().sort({ nom: 1 });
}

async function creerCategorie(data) {
  return Categorie.create(data);
}

// Retour V0.1 : la liste des collections doit rester modifiable (SANAA prévoit
// d'en ajouter) — renommage libre, suppression bloquée si des produits y sont
// encore rattachés pour ne jamais laisser un produit orphelin de collection.
async function modifierCategorie(id, data) {
  const categorie = await Categorie.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!categorie) throw ApiError.notFound('Collection introuvable');
  return categorie;
}

async function supprimerCategorie(id) {
  const categorie = await Categorie.findById(id);
  if (!categorie) throw ApiError.notFound('Collection introuvable');
  const utilisee = await Produit.exists({ categorie_id: id });
  if (utilisee) {
    throw ApiError.conflict(
      'Suppression impossible : des produits appartiennent encore à cette collection.'
    );
  }
  await Categorie.deleteOne({ _id: id });
  return { supprime: true };
}

async function listerProduits({ statut, categorie_id, q } = {}) {
  const filtre = {};
  if (statut) filtre.statut = statut;
  if (categorie_id) filtre.categorie_id = categorie_id;
  if (q) filtre.$text = { $search: q };
  return Produit.find(filtre).populate('categorie_id').sort({ nom: 1 });
}

async function obtenirProduit(id) {
  const produit = await Produit.findById(id).populate('categorie_id');
  if (!produit) throw ApiError.notFound('Produit introuvable');
  return produit;
}

async function creerProduit(data) {
  return Produit.create(data);
}

async function modifierProduit(id, data) {
  const { variantes, ...champs } = data; // les variantes se gèrent via des routes dédiées
  const produit = await Produit.findByIdAndUpdate(id, champs, { new: true, runValidators: true });
  if (!produit) throw ApiError.notFound('Produit introuvable');
  return produit;
}

/**
 * Suppression d'un produit (retour V0.1) — refusée si des commandes ou des
 * mouvements de stock le référencent déjà (même via une seule de ses
 * variantes), pour ne jamais casser l'historique. `statut: 'inactif'` via
 * modifierProduit() reste la voie pour le retirer de la vente sans perte de
 * données.
 */
async function supprimerProduit(id) {
  const produit = await Produit.findById(id);
  if (!produit) throw ApiError.notFound('Produit introuvable');

  const Commande = require('../models/Commande');
  const StockMouvement = require('../models/StockMouvement');
  const [utiliseDansCommande, utiliseDansStock] = await Promise.all([
    Commande.exists({ 'lignes.produit_id': id }),
    StockMouvement.exists({ produit_id: id }),
  ]);
  if (utiliseDansCommande || utiliseDansStock) {
    throw ApiError.conflict(
      "Suppression impossible : ce produit est déjà référencé par des commandes ou des mouvements de stock. Désactivez-le plutôt (statut = inactif)."
    );
  }

  await Produit.deleteOne({ _id: id });
  return { supprime: true };
}

async function ajouterVariante(produitId, variante) {
  const produit = await Produit.findById(produitId);
  if (!produit) throw ApiError.notFound('Produit introuvable');
  produit.variantes.push(variante);
  await produit.save();
  return produit;
}

async function modifierVariante(produitId, varianteId, data) {
  const produit = await Produit.findById(produitId);
  if (!produit) throw ApiError.notFound('Produit introuvable');
  const variante = produit.variantes.id(varianteId);
  if (!variante) throw ApiError.notFound('Variante introuvable');
  if (data.couleur !== undefined) variante.couleur = data.couleur;
  if (data.couleur_zh !== undefined) variante.couleur_zh = data.couleur_zh;
  if (data.actif !== undefined) variante.actif = data.actif;
  await produit.save();
  return produit;
}

/**
 * Suppression d'une variante — même garde que pour un produit entier (une
 * ligne de commande ou un mouvement de stock peut référencer précisément
 * cette variante sans référencer les autres du même produit).
 */
async function supprimerVariante(produitId, varianteId) {
  const produit = await Produit.findById(produitId);
  if (!produit) throw ApiError.notFound('Produit introuvable');
  const variante = produit.variantes.id(varianteId);
  if (!variante) throw ApiError.notFound('Variante introuvable');

  const Commande = require('../models/Commande');
  const StockMouvement = require('../models/StockMouvement');
  const [utiliseDansCommande, utiliseDansStock] = await Promise.all([
    Commande.exists({ 'lignes.variante_id': varianteId }),
    StockMouvement.exists({ variante_id: varianteId }),
  ]);
  if (utiliseDansCommande || utiliseDansStock) {
    throw ApiError.conflict(
      "Suppression impossible : cette variante est déjà référencée par des commandes ou des mouvements de stock. Désactivez-la plutôt."
    );
  }

  variante.deleteOne();
  await produit.save();
  return produit;
}

/**
 * Prix effectif d'une variante pour un pays (section 5.4 : GET /produits/:id/prix?pays_id=).
 * Retourne l'entrée prix_pays active la plus récente pour ce pays, ou null.
 */
async function prixEffectif(produitId, varianteId, paysId) {
  const produit = await Produit.findById(produitId);
  if (!produit) throw ApiError.notFound('Produit introuvable');
  const variante = produit.variantes.id(varianteId);
  if (!variante) throw ApiError.notFound('Variante introuvable');
  const candidats = variante.prix_pays
    .filter((p) => String(p.pays_id) === String(paysId) && p.actif && p.date_debut_validite <= new Date())
    .sort((a, b) => b.date_debut_validite - a.date_debut_validite);
  return candidats[0] || null;
}

// Route section 5.4 : PUT /variantes/:id/prix/:pays_id — la variante étant un
// sous-document, on retrouve son produit parent par recherche sur variantes._id
// (les ObjectId de sous-documents Mongoose sont générés globalement uniques).
async function definirPrixPays(varianteId, paysId, data) {
  const produit = await Produit.findOne({ 'variantes._id': varianteId });
  if (!produit) throw ApiError.notFound('Variante introuvable');
  const variante = produit.variantes.id(varianteId);

  variante.prix_pays.push({
    pays_id: paysId,
    prix: data.prix,
    devise_id: data.devise_id,
    actif: true,
    date_debut_validite: data.date_debut_validite || new Date(),
  });
  await produit.save();
  return produit;
}

/**
 * Initialise les prix d'un pays à partir du catalogue global (section 5.4,
 * "hériter-catalogue" — principe d'héritage puis personnalisation, section 5 du
 * cahier de cadrage). Copie, pour chaque variante n'ayant pas encore de prix pour
 * ce pays, le prix de la première entrée active trouvée (à défaut de "prix de
 * référence" explicite dans le cahier de cadrage) comme point de départ éditable.
 */
async function heriterCatalogue(paysId) {
  const pays = await Pays.findById(paysId);
  if (!pays) throw ApiError.notFound('Pays introuvable');

  const produits = await Produit.find({ statut: 'actif' });
  let compteurVariantes = 0;

  for (const produit of produits) {
    let modifie = false;
    for (const variante of produit.variantes) {
      const dejaPresent = variante.prix_pays.some((p) => String(p.pays_id) === String(paysId));
      if (dejaPresent) continue;
      const reference = variante.prix_pays[0];
      if (!reference) continue;
      variante.prix_pays.push({
        pays_id: paysId,
        prix: reference.prix,
        devise_id: pays.devise_locale_id,
        actif: false, // désactivé par défaut : à valider avant mise en vente dans le pays
        date_debut_validite: new Date(),
      });
      modifie = true;
      compteurVariantes += 1;
    }
    if (modifie) await produit.save();
  }

  return { produitsParcourus: produits.length, variantesInitialisees: compteurVariantes };
}

module.exports = {
  listerCategories,
  creerCategorie,
  modifierCategorie,
  supprimerCategorie,
  listerProduits,
  obtenirProduit,
  creerProduit,
  modifierProduit,
  supprimerProduit,
  ajouterVariante,
  modifierVariante,
  supprimerVariante,
  prixEffectif,
  definirPrixPays,
  heriterCatalogue,
};
