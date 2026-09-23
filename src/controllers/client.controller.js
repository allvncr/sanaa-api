const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/client.service');

const lister = asyncHandler(async (req, res) => {
  const { items, meta } = await service.lister(req.query);
  sendList(res, items, meta);
});
const creer = asyncHandler(async (req, res) => sendOne(res, await service.creer(req.body), 201));
const modifier = asyncHandler(async (req, res) => sendOne(res, await service.modifier(req.params.id, req.body)));
const historiqueCommandes = asyncHandler(async (req, res) =>
  sendOne(res, await service.historiqueCommandes(req.params.id))
);

module.exports = { lister, creer, modifier, historiqueCommandes };
