const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/stock.service');

const niveaux = asyncHandler(async (req, res) => sendList(res, await service.niveaux(req.query)));
const listerMouvements = asyncHandler(async (req, res) => sendList(res, await service.listerMouvements(req.query)));
const enregistrerMouvement = asyncHandler(async (req, res) =>
  sendOne(res, await service.enregistrerMouvement(req.body, req), 201)
);
const creerTransfert = asyncHandler(async (req, res) => sendOne(res, await service.creerTransfert(req.body, req), 201));

module.exports = { niveaux, listerMouvements, enregistrerMouvement, creerTransfert };
