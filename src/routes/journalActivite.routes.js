const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/', requirePermission('journal_activite:voir'), scopePays('pays_id'), ctrl.listerJournal);

module.exports = router;
