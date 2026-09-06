const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/fournisseur.controller');
const requirePermission = require('../middlewares/permissions');

router.get('/', requirePermission('fournisseurs:voir'), ctrl.listerCommandes);
router.post('/', requirePermission('fournisseurs:gerer'), ctrl.creerCommande);
router.patch('/:id/statut', requirePermission('fournisseurs:gerer'), ctrl.changerStatut);

module.exports = router;
