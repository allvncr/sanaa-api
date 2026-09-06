const asyncHandler = require('../utils/asyncHandler');
const { sendList, sendOne } = require('../utils/apiResponse');
const deviseService = require('../services/devise.service');
const roleService = require('../services/role.service');

const listerDevises = asyncHandler(async (req, res) => sendList(res, await deviseService.lister()));
const creerDevise = asyncHandler(async (req, res) => sendOne(res, await deviseService.creer(req.body), 201));

const listerTaux = asyncHandler(async (req, res) => sendList(res, await deviseService.listerTaux(req.query)));
const ajouterTaux = asyncHandler(async (req, res) =>
  sendOne(res, await deviseService.ajouterTaux(req.body, req.user.id), 201)
);

const listerMoyensPaiement = asyncHandler(async (req, res) => {
  const Pays = require('../models/Pays');
  const pays = await Pays.findById(req.query.pays_id);
  if (!pays) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Pays introuvable' } });
  sendList(res, pays.moyens_paiement);
});

const listerRoles = asyncHandler(async (req, res) => sendList(res, await roleService.lister()));
const creerRole = asyncHandler(async (req, res) => sendOne(res, await roleService.creer(req.body), 201));

module.exports = {
  listerDevises,
  creerDevise,
  listerTaux,
  ajouterTaux,
  listerMoyensPaiement,
  listerRoles,
  creerRole,
};
