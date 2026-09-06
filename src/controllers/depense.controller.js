const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/depense.service');

const listerCategories = asyncHandler(async (req, res) => sendList(res, await service.listerCategories()));
const creerCategorie = asyncHandler(async (req, res) => sendOne(res, await service.creerCategorie(req.body), 201));

const lister = asyncHandler(async (req, res) => sendList(res, await service.lister(req.query)));
const creer = asyncHandler(async (req, res) => sendOne(res, await service.creer(req.body), 201));
const valider = asyncHandler(async (req, res) => sendOne(res, await service.valider(req.params.id, req.user.id)));
const supprimer = asyncHandler(async (req, res) => sendOne(res, await service.supprimer(req.params.id)));

module.exports = { listerCategories, creerCategorie, lister, creer, valider, supprimer };
