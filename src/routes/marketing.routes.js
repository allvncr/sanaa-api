const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/marketing.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/campagnes', requirePermission('marketing:voir'), scopePays('pays_id'), ctrl.listerCampagnes);
router.post('/campagnes', requirePermission('marketing:gerer'), scopePays('pays_id'), ctrl.creerCampagne);
router.post('/mesures', requirePermission('marketing:gerer'), ctrl.ajouterMesure);
router.get('/performance', requirePermission('marketing:voir'), scopePays('pays_id'), ctrl.performance);

module.exports = router;
