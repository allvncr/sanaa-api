const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/utilisateur.service');

const lister = asyncHandler(async (req, res) => sendList(res, await service.lister(req)));
const creer = asyncHandler(async (req, res) => sendOne(res, await service.creer(req.body, req), 201));
const modifier = asyncHandler(async (req, res) => sendOne(res, await service.modifier(req.params.id, req.body, req)));
const attribuerPays = asyncHandler(async (req, res) =>
  sendOne(res, await service.attribuerPays(req.params.id, req.body.pays_ids))
);

module.exports = { lister, creer, modifier, attribuerPays };
