const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/livraison.service');

const lister = asyncHandler(async (req, res) => sendList(res, await service.lister(req.query)));
const planifier = asyncHandler(async (req, res) => sendOne(res, await service.planifier(req.body, req), 201));
const retirer = asyncHandler(async (req, res) => sendOne(res, await service.retirer(req.params.id)));

module.exports = { lister, planifier, retirer };
