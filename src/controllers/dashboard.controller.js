const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/dashboard.service');
const alerteService = require('../services/alerte.service');
const journalService = require('../services/journal.service');

const kpis = asyncHandler(async (req, res) => sendOne(res, await service.kpis(req.query)));
const comparaisonPays = asyncHandler(async (req, res) => sendOne(res, await service.comparaisonPays(req.query)));
const performanceProduits = asyncHandler(async (req, res) =>
  sendList(res, await service.performanceProduits(req.query))
);
const evolutionCA = asyncHandler(async (req, res) => sendOne(res, await service.evolutionCA(req.query)));
const repartitionLivraison = asyncHandler(async (req, res) =>
  sendList(res, await service.repartitionLivraison(req.query))
);
const repartitionCanal = asyncHandler(async (req, res) =>
  sendList(res, await service.repartitionCanal(req.query))
);
const nouveauxClients = asyncHandler(async (req, res) => sendOne(res, await service.nouveauxClients(req.query)));
const analyseCaPubDepenses = asyncHandler(async (req, res) =>
  sendOne(res, await service.analyseCaPubDepenses(req.query))
);

const listerAlertes = asyncHandler(async (req, res) => sendList(res, await alerteService.lister(req.query)));
const listerJournal = asyncHandler(async (req, res) => {
  const { items, meta } = await journalService.lister(req.query);
  sendList(res, items, meta);
});

module.exports = {
  kpis,
  comparaisonPays,
  performanceProduits,
  evolutionCA,
  repartitionLivraison,
  repartitionCanal,
  nouveauxClients,
  analyseCaPubDepenses,
  listerAlertes,
  listerJournal,
};
