const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/commande.service');

const lister = asyncHandler(async (req, res) => sendList(res, await service.lister(req.query)));
const obtenir = asyncHandler(async (req, res) => sendOne(res, await service.obtenir(req.params.id)));
const creer = asyncHandler(async (req, res) => sendOne(res, await service.creer(req.body, req), 201));
const modifier = asyncHandler(async (req, res) => sendOne(res, await service.modifier(req.params.id, req.body)));

const changerStatutCommande = asyncHandler(async (req, res) =>
  sendOne(res, await service.changerStatutCommande(req.params.id, req.body.statut, req))
);
const changerStatutFabrication = asyncHandler(async (req, res) =>
  sendOne(res, await service.changerStatutFabrication(req.params.id, req.body.statut))
);
const changerStatutLivraison = asyncHandler(async (req, res) =>
  sendOne(res, await service.changerStatutLivraison(req.params.id, req.body.statut))
);

const listerPaiements = asyncHandler(async (req, res) => sendList(res, await service.listerPaiements(req.params.id)));
const enregistrerPaiement = asyncHandler(async (req, res) =>
  sendOne(res, await service.enregistrerPaiement(req.params.id, req.body, req), 201)
);

const encaissementsJour = asyncHandler(async (req, res) =>
  sendOne(res, await service.encaissementsJour(req.query.pays_id, req.query.date))
);

module.exports = {
  lister,
  obtenir,
  creer,
  modifier,
  changerStatutCommande,
  changerStatutFabrication,
  changerStatutLivraison,
  listerPaiements,
  enregistrerPaiement,
  encaissementsJour,
};
