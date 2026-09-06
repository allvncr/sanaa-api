const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/client.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/', requirePermission('clients:voir'), scopePays('pays_id'), ctrl.lister);
router.post('/', requirePermission('clients:creer'), scopePays('pays_id'), ctrl.creer);
router.put('/:id', requirePermission('clients:modifier'), ctrl.modifier);
router.get('/:id/commandes', requirePermission('clients:voir'), ctrl.historiqueCommandes);

module.exports = router;
