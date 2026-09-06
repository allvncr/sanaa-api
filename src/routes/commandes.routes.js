const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/commande.controller');
const requirePermission = require('../middlewares/permissions');
const scopePays = require('../middlewares/scopePays');

router.get('/', requirePermission('commandes:voir'), scopePays('pays_id'), ctrl.lister);
router.get('/:id', requirePermission('commandes:voir'), ctrl.obtenir);
router.post('/', requirePermission('commandes:creer'), scopePays('pays_id'), ctrl.creer);
router.put('/:id', requirePermission('commandes:modifier'), ctrl.modifier);

router.patch('/:id/statut-commande', requirePermission('commandes:changer_statut'), ctrl.changerStatutCommande);
router.patch('/:id/statut-fabrication', requirePermission('commandes:changer_statut'), ctrl.changerStatutFabrication);
router.patch('/:id/statut-livraison', requirePermission('commandes:changer_statut'), ctrl.changerStatutLivraison);

router.get('/:id/paiements', requirePermission('paiements:voir'), ctrl.listerPaiements);
router.post('/:id/paiements', requirePermission('paiements:enregistrer'), ctrl.enregistrerPaiement);

module.exports = router;
