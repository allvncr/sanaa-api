const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/stock.service');

const listerArticles = asyncHandler(async (req, res) => sendOne(res, await service.listerArticles(req.query)));
const creerArticle = asyncHandler(async (req, res) => sendOne(res, await service.creerArticle(req.body, req), 201));
const modifierArticle = asyncHandler(async (req, res) => sendOne(res, await service.modifierArticle(req.params.id, req.body)));
const enregistrerMouvement = asyncHandler(async (req, res) =>
  sendOne(res, await service.enregistrerMouvement(req.body, req), 201)
);
const annulerMouvement = asyncHandler(async (req, res) => sendOne(res, await service.annulerMouvement(req.params.id, req)));
const listerMouvements = asyncHandler(async (req, res) => {
  const { items, meta } = await service.listerMouvements(req.query);
  return sendList(res, items, meta);
});

module.exports = { listerArticles, creerArticle, modifierArticle, enregistrerMouvement, annulerMouvement, listerMouvements };
