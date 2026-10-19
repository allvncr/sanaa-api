const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/livraison.service');
const ficheService = require('../services/ficheLivraison.service');

const lister = asyncHandler(async (req, res) => sendList(res, await service.lister(req.query)));
const planifier = asyncHandler(async (req, res) => sendOne(res, await service.planifier(req.body, req), 201));
const retirer = asyncHandler(async (req, res) => sendOne(res, await service.retirer(req.params.id)));
const marquerLivree = asyncHandler(async (req, res) => sendOne(res, await service.marquerLivree(req.params.id, req.body, req)));
const signalerProbleme = asyncHandler(async (req, res) => sendOne(res, await service.signalerProbleme(req.params.id, req)));
const fichePdf = asyncHandler(async (req, res) => {
  const { buffer, nomFichier } = await ficheService.genererFiche(req.query);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
});

module.exports = { lister, planifier, retirer, marquerLivree, signalerProbleme, fichePdf };
