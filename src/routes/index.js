const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authentifier = require('../middlewares/auth');

// Limitation de débit sur les routes sensibles — section 2.6.
const limiteurConnexion = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const limiteurExports = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.use('/auth', (req, res, next) => {
  if (req.path === '/login') return limiteurConnexion(req, res, next);
  return next();
});
router.use('/auth', require('./auth.routes'));

// Toutes les routes suivantes nécessitent un jeton JWT valide (section 5).
router.use(authentifier);

router.use('/pays', require('./pays.routes'));
router.use('/', require('./referentiels.routes')); // /devises, /taux-change, /moyens-paiement, /roles
router.use('/utilisateurs', require('./utilisateurs.routes'));
router.use('/', require('./catalogue.routes')); // /collections, /produits, /variantes
router.use('/clients', require('./clients.routes'));
router.use('/commandes', require('./commandes.routes'));
router.use('/paiements', require('./paiements.routes'));
router.use('/stock', require('./stock.routes'));
router.use('/fournisseurs', require('./fournisseurs.routes'));
router.use('/commandes-fournisseurs', require('./commandesFournisseurs.routes'));
router.use('/', require('./depenses.routes')); // /categories-depenses, /depenses
router.use('/marketing', require('./marketing.routes'));
router.use('/exports', limiteurExports, require('./exports.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/alertes', require('./alertes.routes'));
router.use('/journal-activite', require('./journalActivite.routes'));

module.exports = router;
