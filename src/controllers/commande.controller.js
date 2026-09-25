const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const service = require('../services/commande.service');

const lister = asyncHandler(async (req, res) => {
  const { items, meta } = await service.lister(req.query);
  sendList(res, items, meta);
});
const createurs = asyncHandler(async (req, res) => sendList(res, await service.createurs(req.query)));
const obtenir =asyncHandler(async (req, res) => sendOne(res, await service.obtenir(req.params.id)));
const creer = asyncHandler(async (req, res) => sendOne(res, await service.creer(req.body, req), 201));
const modifier = asyncHandler(async (req, res) => sendOne(res, await service.modifier(req.params.id, req.body, req)));
const supprimer = asyncHandler(async (req, res) =>
  sendOne(
    res,
    await service.supprimer(req.params.id, { confirmerPaiements: req.query.confirmer_paiements === 'true' }, req)
  )
);
const historique = asyncHandler(async (req, res) => sendOne(res, await service.historique(req.params.id)));

const changerStatutCommande = asyncHandler(async (req, res) =>
  sendOne(res, await service.changerStatutCommande(req.params.id, req.body.statut, req))
);
const changerStatutFabrication = asyncHandler(async (req, res) =>
  sendOne(res, await service.changerStatutFabrication(req.params.id, req.body.statut))
);
const changerStatutLivraison = asyncHandler(async (req, res) =>
  sendOne(res, await service.changerStatutLivraison(req.params.id, req.body.statut))
);
const modifierStatutsEnLot = asyncHandler(async (req, res) => sendOne(res, await service.modifierStatutsEnLot(req.body)));

const listerPaiements = asyncHandler(async (req, res) => sendList(res, await service.listerPaiements(req.params.id)));
const enregistrerPaiement = asyncHandler(async (req, res) =>
  sendOne(res, await service.enregistrerPaiement(req.params.id, req.body, req), 201)
);
const modifierPaiement = asyncHandler(async (req, res) =>
  sendOne(res, await service.modifierPaiement(req.params.id, req.params.paiementId, req.body))
);
const annulerPaiement = asyncHandler(async (req, res) =>
  sendOne(res, await service.annulerPaiement(req.params.id, req.params.paiementId, req))
);

const encaissementsJour = asyncHandler(async (req, res) =>
  sendOne(res, await service.encaissementsJour(req.query.pays_id, req.query.date, req.query.periode))
);

module.exports = {
  lister,
  createurs,
  obtenir,
  creer,
  modifier,
  supprimer,
  historique,
  changerStatutCommande,
  changerStatutFabrication,
  changerStatutLivraison,
  modifierStatutsEnLot,
  listerPaiements,
  enregistrerPaiement,
  modifierPaiement,
  annulerPaiement,
  encaissementsJour,
};
