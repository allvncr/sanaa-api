const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/stock.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

// Stock des bijoux « en stock » (voir models/ArticleStock.js). Consulter =
// stock:voir ; ajouter un produit, saisir ou annuler un mouvement = stock:ajuster.
router.get('/articles', requirePermission('stock:voir'), scopePays('pays_id'), ctrl.listerArticles);
router.post('/articles', requirePermission('stock:ajuster'), scopePays('pays_id'), ctrl.creerArticle);
router.patch('/articles/:id', requirePermission('stock:ajuster'), ctrl.modifierArticle);
router.get('/mouvements', requirePermission('stock:voir'), scopePays('pays_id'), ctrl.listerMouvements);
router.post('/mouvements', requirePermission('stock:ajuster'), ctrl.enregistrerMouvement);
router.patch('/mouvements/:id/annuler', requirePermission('stock:ajuster'), ctrl.annulerMouvement);

module.exports = router;
