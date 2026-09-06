const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/fournisseur.service');

const lister = asyncHandler(async (req, res) => sendList(res, await service.lister()));
const creer = asyncHandler(async (req, res) => sendOne(res, await service.creer(req.body), 201));

const listerCommandes = asyncHandler(async (req, res) => sendList(res, await service.listerCommandes(req.query)));
const creerCommande = asyncHandler(async (req, res) => sendOne(res, await service.creerCommande(req.body), 201));
const changerStatut = asyncHandler(async (req, res) =>
  sendOne(res, await service.changerStatut(req.params.id, req.body.statut))
);

module.exports = { lister, creer, listerCommandes, creerCommande, changerStatut };
