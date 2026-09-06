const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/depense.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/categories-depenses', requirePermission('depenses:voir'), ctrl.listerCategories);
router.post('/categories-depenses', requirePermission('depenses:creer'), ctrl.creerCategorie);

router.get('/depenses', requirePermission('depenses:voir'), scopePays('pays_id'), ctrl.lister);
router.post('/depenses', requirePermission('depenses:creer'), scopePays('pays_id'), ctrl.creer);
router.patch('/depenses/:id/valider', requirePermission('depenses:valider'), ctrl.valider);

module.exports = router;
