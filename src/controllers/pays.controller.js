const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const paysService = require('../services/pays.service');
const catalogueService = require('../services/catalogue.service');

const lister = asyncHandler(async (req, res) => {
  const items = req.user.porteeGlobale
    ? await paysService.lister(req.query)
    : (await paysService.lister(req.query)).filter((p) => req.user.paysAutorises.includes(String(p._id)));
  sendList(res, items);
});

const obtenir = asyncHandler(async (req, res) => {
  sendOne(res, await paysService.obtenir(req.params.id));
});

const creer = asyncHandler(async (req, res) => {
  sendOne(res, await paysService.creer(req.body), 201);
});

const modifier = asyncHandler(async (req, res) => {
  sendOne(res, await paysService.modifier(req.params.id, req.body));
});

const supprimer = asyncHandler(async (req, res) => {
  sendOne(res, await paysService.supprimer(req.params.id));
});

const heriterCatalogue = asyncHandler(async (req, res) => {
  sendOne(res, await catalogueService.heriterCatalogue(req.params.id));
});

module.exports = { lister, obtenir, creer, modifier, supprimer, heriterCatalogue };
