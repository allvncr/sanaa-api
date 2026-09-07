const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/export.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.post('/interne', requirePermission('exports:generer'), scopePays('pays_id'), ctrl.genererInterne);
router.post('/usine', requirePermission('exports:generer'), scopePays('pays_id'), ctrl.genererUsine);
router.get('/', requirePermission('exports:telecharger'), scopePays('pays_id'), ctrl.lister);
router.get('/:id/telecharger', requirePermission('exports:telecharger'), ctrl.telecharger);

module.exports = router;
