const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const Utilisateur = require('../models/Utilisateur');

const MAX_TENTATIVES = 5;
const VERROUILLAGE_MINUTES = 15;

function signAccessToken(utilisateur) {
  return jwt.sign({ sub: String(utilisateur._id) }, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpires,
  });
}

function signRefreshToken(utilisateur) {
  return jwt.sign({ sub: String(utilisateur._id), typ: 'refresh' }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshExpires,
  });
}

async function login(email, motDePasse) {
  const utilisateur = await Utilisateur.findOne({ email: email.toLowerCase() })
    .select('+mot_de_passe_hash +tentatives_echouees +verrouille_jusqu_a')
    .populate('role_id');

  if (!utilisateur || !utilisateur.actif) throw ApiError.unauthorized('Identifiants invalides');

  if (utilisateur.verrouille_jusqu_a && utilisateur.verrouille_jusqu_a > new Date()) {
    throw ApiError.forbidden('Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard.');
  }

  const ok = await utilisateur.verifierMotDePasse(motDePasse);
  if (!ok) {
    utilisateur.tentatives_echouees = (utilisateur.tentatives_echouees || 0) + 1;
    if (utilisateur.tentatives_echouees >= MAX_TENTATIVES) {
      utilisateur.verrouille_jusqu_a = new Date(Date.now() + VERROUILLAGE_MINUTES * 60 * 1000);
      utilisateur.tentatives_echouees = 0;
    }
    await utilisateur.save();
    throw ApiError.unauthorized('Identifiants invalides');
  }

  utilisateur.tentatives_echouees = 0;
  utilisateur.verrouille_jusqu_a = undefined;
  utilisateur.derniere_connexion = new Date();

  const accessToken = signAccessToken(utilisateur);
  const refreshToken = signRefreshToken(utilisateur);
  utilisateur.refresh_token_hash = await bcrypt.hash(refreshToken, 10);
  await utilisateur.save();

  return { accessToken, refreshToken, utilisateur: toPublicUser(utilisateur) };
}

async function refresh(refreshToken) {
  if (!refreshToken) throw ApiError.unauthorized('Refresh token manquant');
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.jwt.refreshSecret);
  } catch (err) {
    throw ApiError.unauthorized('Refresh token invalide ou expiré');
  }

  const utilisateur = await Utilisateur.findById(payload.sub).select('+refresh_token_hash').populate('role_id');
  if (!utilisateur || !utilisateur.actif || !utilisateur.refresh_token_hash) {
    throw ApiError.unauthorized('Session invalide');
  }

  const valide = await bcrypt.compare(refreshToken, utilisateur.refresh_token_hash);
  if (!valide) throw ApiError.unauthorized('Session invalide');

  const accessToken = signAccessToken(utilisateur);
  return { accessToken };
}

async function logout(utilisateurId) {
  await Utilisateur.findByIdAndUpdate(utilisateurId, { $unset: { refresh_token_hash: 1 } });
}

function toPublicUser(utilisateur) {
  return {
    id: utilisateur._id,
    nom: utilisateur.nom,
    email: utilisateur.email,
    role: { id: utilisateur.role_id._id, nom: utilisateur.role_id.nom, portee: utilisateur.role_id.portee },
    permissions: utilisateur.role_id.permissions,
    pays_autorises: utilisateur.pays_autorises,
  };
}

async function me(utilisateurId) {
  const utilisateur = await Utilisateur.findById(utilisateurId).populate('role_id').populate('pays_autorises');
  if (!utilisateur) throw ApiError.notFound('Utilisateur introuvable');
  return toPublicUser(utilisateur);
}

module.exports = { login, refresh, logout, me, toPublicUser };
