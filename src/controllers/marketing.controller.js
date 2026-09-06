const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/marketing.service');

const listerCampagnes = asyncHandler(async (req, res) => sendList(res, await service.listerCampagnes(req.query)));
const creerCampagne = asyncHandler(async (req, res) => sendOne(res, await service.creerCampagne(req.body), 201));
const ajouterMesure = asyncHandler(async (req, res) => sendOne(res, await service.ajouterMesure(req.body), 201));
const performance = asyncHandler(async (req, res) => sendList(res, await service.performance(req.query)));

module.exports = { listerCampagnes, creerCampagne, ajouterMesure, performance };
