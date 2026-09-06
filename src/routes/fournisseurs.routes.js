const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/fournisseur.controller');
const requirePermission = require('../middlewares/permissions');

router.get('/', requirePermission('fournisseurs:voir'), ctrl.lister);
router.post('/', requirePermission('fournisseurs:gerer'), ctrl.creer);

module.exports = router;
