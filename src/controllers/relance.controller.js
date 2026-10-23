const asyncHandler = require('../utils/asyncHandler');
const { sendOne } = require('../utils/apiResponse');
const service = require('../services/relance.service');

const lister = asyncHandler(async (req, res) => sendOne(res, await service.lister(req.query)));
const enregistrer = asyncHandler(async (req, res) => sendOne(res, await service.enregistrer(req.body, req), 201));

module.exports = { lister, enregistrer };
