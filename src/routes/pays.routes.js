const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/pays.controller');
const requirePermission = require('../middlewares/permissions');

router.get('/', requirePermission('pays:voir'), ctrl.lister);
router.get('/:id', requirePermission('pays:voir'), ctrl.obtenir);
router.post('/', requirePermission('pays:creer'), ctrl.creer);
router.put('/:id', requirePermission('pays:modifier'), ctrl.modifier);
router.delete('/:id', requirePermission('pays:supprimer'), ctrl.supprimer);
router.post('/:id/heriter-catalogue', requirePermission('catalogue:definir_prix_pays'), ctrl.heriterCatalogue);

module.exports = router;
