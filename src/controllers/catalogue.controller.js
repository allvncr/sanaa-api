const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/catalogue.service');

const listerCategories = asyncHandler(async (req, res) => sendList(res, await service.listerCategories()));
const creerCategorie = asyncHandler(async (req, res) => sendOne(res, await service.creerCategorie(req.body), 201));
const modifierCategorie = asyncHandler(async (req, res) =>
  sendOne(res, await service.modifierCategorie(req.params.id, req.body))
);
const supprimerCategorie = asyncHandler(async (req, res) => sendOne(res, await service.supprimerCategorie(req.params.id)));

const listerProduits = asyncHandler(async (req, res) => sendList(res, await service.listerProduits(req.query)));
const obtenirProduit = asyncHandler(async (req, res) => sendOne(res, await service.obtenirProduit(req.params.id)));
const creerProduit = asyncHandler(async (req, res) => sendOne(res, await service.creerProduit(req.body), 201));
const modifierProduit = asyncHandler(async (req, res) =>
  sendOne(res, await service.modifierProduit(req.params.id, req.body))
);
const ajouterVariante = asyncHandler(async (req, res) =>
  sendOne(res, await service.ajouterVariante(req.params.id, req.body), 201)
);

const prixEffectif = asyncHandler(async (req, res) => {
  const prix = await service.prixEffectif(req.params.id, req.query.variante_id, req.query.pays_id);
  sendOne(res, prix);
});

const definirPrixPays = asyncHandler(async (req, res) =>
  sendOne(res, await service.definirPrixPays(req.params.id, req.params.pays_id, req.body))
);

module.exports = {
  listerCategories,
  creerCategorie,
  modifierCategorie,
  supprimerCategorie,
  listerProduits,
  obtenirProduit,
  creerProduit,
  modifierProduit,
  ajouterVariante,
  prixEffectif,
  definirPrixPays,
};
