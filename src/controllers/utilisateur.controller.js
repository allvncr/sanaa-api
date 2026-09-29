const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/utilisateur.service');

const lister = asyncHandler(async (req, res) => {
  const { items, meta } = await service.lister(req);
  sendList(res, items, meta);
});
const creer = asyncHandler(async (req, res) => sendOne(res, await service.creer(req.body, req), 201));
const modifier = asyncHandler(async (req, res) => sendOne(res, await service.modifier(req.params.id, req.body, req)));
const attribuerPays = asyncHandler(async (req, res) =>
  sendOne(res, await service.attribuerPays(req.params.id, req.body.pays_ids))
);
const supprimer = asyncHandler(async (req, res) => sendOne(res, await service.supprimer(req.params.id, req)));

module.exports = { lister, creer, modifier, attribuerPays, supprimer };
