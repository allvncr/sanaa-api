const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/livraison.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/', requirePermission('livraisons:voir'), scopePays('pays_id'), ctrl.lister);
router.post('/', requirePermission('livraisons:planifier'), ctrl.planifier);
router.delete('/:id', requirePermission('livraisons:planifier'), ctrl.retirer);

module.exports = router;
