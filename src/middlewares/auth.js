const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const requestContext = require('../utils/requestContext');
const Utilisateur = require('../models/Utilisateur');

/**
 * Authentification par JWT (section 2.6, 4.4). Le rôle et les pays autorisés sont
 * revalidés depuis la base à chaque requête sensible plutôt que lus uniquement
 * depuis le jeton, afin qu'une modification de droits par le super administrateur
 * prenne effet immédiatement (section 4.4).
 */
const authentifier = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.jwt.accessSecret);
  } catch (err) {
    throw ApiError.unauthorized('Jeton invalide ou expiré');
  }

  const utilisateur = await Utilisateur.findById(payload.sub).populate('role_id');
  if (!utilisateur || !utilisateur.actif) throw ApiError.unauthorized('Compte inactif ou introuvable');

  const porteeGlobale = utilisateur.role_id.portee === 'global';
  const userContext = {
    id: String(utilisateur._id),
    nom: utilisateur.nom,
    email: utilisateur.email,
    role: utilisateur.role_id.nom,
    permissions: utilisateur.role_id.permissions,
    porteeGlobale,
    paysAutorises: (utilisateur.pays_autorises || []).map(String),
  };

  req.user = userContext;
  // Le contexte est ouvert pour le reste de la chaîne asynchrone de la requête :
  // les plugins Mongoose (scoping pays, journal d'activité) le lisent depuis là.
  requestContext.run({ user: userContext }, () => next());
});

module.exports = authentifier;
