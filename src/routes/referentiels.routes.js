const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/referentiels.controller');
const requirePermission = require('../middlewares/permissions');

router.get('/devises', ctrl.listerDevises);
router.post('/devises', requirePermission('parametres:gerer_taux_change'), ctrl.creerDevise);

router.get('/taux-change', ctrl.listerTaux);
router.post('/taux-change', requirePermission('parametres:gerer_taux_change'), ctrl.ajouterTaux);

router.get('/moyens-paiement', ctrl.listerMoyensPaiement);

router.get('/roles', requirePermission('utilisateurs:voir'), ctrl.listerRoles);
router.post('/roles', requirePermission('utilisateurs:creer'), ctrl.creerRole);

module.exports = router;
