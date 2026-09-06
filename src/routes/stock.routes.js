const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/stock.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/', requirePermission('stock:voir'), scopePays('pays_id'), ctrl.niveaux);
router.get('/mouvements', requirePermission('stock:voir'), scopePays('pays_id'), ctrl.listerMouvements);
router.post('/mouvements', requirePermission('stock:ajuster'), scopePays('pays_id'), ctrl.enregistrerMouvement);
router.post(
  '/transferts',
  requirePermission('stock:transferer'),
  scopePays('pays_source_id', 'pays_destination_id'),
  ctrl.creerTransfert
);

module.exports = router;
