const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/catalogue.controller');
const requirePermission = require('../middlewares/permissions');

router.get('/collections', ctrl.listerCategories);
router.post('/collections', requirePermission('catalogue:creer'), ctrl.creerCategorie);
router.put('/collections/:id', requirePermission('catalogue:modifier'), ctrl.modifierCategorie);
router.delete('/collections/:id', requirePermission('catalogue:supprimer'), ctrl.supprimerCategorie);

router.get('/produits', requirePermission('catalogue:voir'), ctrl.listerProduits);
router.get('/produits/:id', requirePermission('catalogue:voir'), ctrl.obtenirProduit);
router.get('/produits/:id/prix', requirePermission('catalogue:voir'), ctrl.prixEffectif);
router.post('/produits', requirePermission('catalogue:creer'), ctrl.creerProduit);
router.put('/produits/:id', requirePermission('catalogue:modifier'), ctrl.modifierProduit);
router.delete('/produits/:id', requirePermission('catalogue:supprimer'), ctrl.supprimerProduit);
router.post('/produits/:id/variantes', requirePermission('catalogue:modifier'), ctrl.ajouterVariante);
router.put('/produits/:id/variantes/:varianteId', requirePermission('catalogue:modifier'), ctrl.modifierVariante);
router.delete('/produits/:id/variantes/:varianteId', requirePermission('catalogue:supprimer'), ctrl.supprimerVariante);

router.put('/variantes/:id/prix/:pays_id', requirePermission('catalogue:definir_prix_pays'), ctrl.definirPrixPays);

module.exports = router;
