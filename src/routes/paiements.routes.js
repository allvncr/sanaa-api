const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/commande.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

// Section 5.7 : GET /paiements/encaissements-jour?pays_id=&date=
router.get('/encaissements-jour', requirePermission('paiements:voir'), scopePays('pays_id'), ctrl.encaissementsJour);

module.exports = router;
