const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/relance.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

// Pas de permission dédiée : relancer un client relève de la gestion des clients
// (donc pas de nouveau « seed » des rôles à lancer en production).
router.get('/', requirePermission('clients:voir'), scopePays('pays_id'), ctrl.lister);
router.post('/', requirePermission('clients:modifier'), ctrl.enregistrer);

module.exports = router;
