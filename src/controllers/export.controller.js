const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/export.service');

const genererInterne = asyncHandler(async (req, res) => {
  const exp = await service.genererExportInterne(req.query.pays_id, req.query.date, req.user.id);
  sendOne(res, exp, 201);
});

// Pas de pays_id : l'export usine combine tous les pays d'un même jour
// (retour V0.1 — voir export.service.js).
const genererUsine = asyncHandler(async (req, res) => {
  const exp = await service.genererExportUsine(req.query.date, req);
  sendOne(res, exp, 201);
});

const lister = asyncHandler(async (req, res) => sendList(res, await service.lister(req.query)));

const telecharger = asyncHandler(async (req, res) => {
  const exp = await service.obtenir(req.params.id);
  res.download(exp.chemin_fichier, exp.nom_fichier);
});

module.exports = { genererInterne, genererUsine, lister, telecharger };
