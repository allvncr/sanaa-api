const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/utilisateur.controller');
const requirePermission = require('../middlewares/permissions');

router.get('/', requirePermission('utilisateurs:voir'), ctrl.lister);
router.post('/', requirePermission('utilisateurs:creer'), ctrl.creer);
router.put('/:id', requirePermission('utilisateurs:modifier'), ctrl.modifier);
router.post('/:id/pays', requirePermission('utilisateurs:attribuer_pays'), ctrl.attribuerPays);

module.exports = router;
