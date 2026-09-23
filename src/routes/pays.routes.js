const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/pays.controller');
const requirePermission = require('../middlewares/permissions');

// Pas de requirePermission ici : tout utilisateur connecté a besoin de la liste
// des pays pour le sélecteur de contexte de l'en-tête (section 22), quel que
// soit son rôle — le contrôleur filtre déjà sur req.user.paysAutorises pour une
// portée non globale. `pays:voir` ne reste requis que pour l'écran d'admin
// "Pays" (CRUD complet, ci-dessous).
router.get('/', ctrl.lister);
router.get('/:id', requirePermission('pays:voir'), ctrl.obtenir);
router.post('/', requirePermission('pays:creer'), ctrl.creer);
router.put('/:id', requirePermission('pays:modifier'), ctrl.modifier);
router.delete('/:id', requirePermission('pays:supprimer'), ctrl.supprimer);
router.post('/:id/heriter-catalogue', requirePermission('catalogue:definir_prix_pays'), ctrl.heriterCatalogue);

module.exports = router;
