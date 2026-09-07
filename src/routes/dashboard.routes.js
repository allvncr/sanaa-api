const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/kpis', requirePermission('dashboard:voir_pays'), scopePays('pays_id'), ctrl.kpis);
router.get('/comparaison-pays', requirePermission('dashboard:comparer_pays'), ctrl.comparaisonPays);
router.get(
  '/performance-produits',
  requirePermission('dashboard:voir_pays'),
  scopePays('pays_id'),
  ctrl.performanceProduits
);
router.get('/evolution-ca', requirePermission('dashboard:voir_pays'), scopePays('pays_id'), ctrl.evolutionCA);
router.get(
  '/repartition-livraison',
  requirePermission('dashboard:voir_pays'),
  scopePays('pays_id'),
  ctrl.repartitionLivraison
);
router.get(
  '/repartition-canal',
  requirePermission('dashboard:voir_pays'),
  scopePays('pays_id'),
  ctrl.repartitionCanal
);
router.get(
  '/nouveaux-clients',
  requirePermission('dashboard:voir_pays'),
  scopePays('pays_id'),
  ctrl.nouveauxClients
);
router.get(
  '/analyse-ca-pub-depenses',
  requirePermission('dashboard:voir_pays'),
  scopePays('pays_id'),
  ctrl.analyseCaPubDepenses
);

module.exports = router;
