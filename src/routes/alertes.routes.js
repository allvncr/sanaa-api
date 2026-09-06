const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/', requirePermission('dashboard:voir_pays'), scopePays('pays_id'), ctrl.listerAlertes);

module.exports = router;
