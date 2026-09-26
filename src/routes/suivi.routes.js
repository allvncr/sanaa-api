const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/suivi.controller');

// Public, sans authentification (monté avant `authentifier` dans routes/index.js).
// Le rate-limit (routes/index.js) est la seconde barrière contre l'énumération
// des numéros de commande, après la vérification numéro+téléphone du service.
router.get('/:numero', ctrl.suivre);

module.exports = router;
