const Role = require('../models/Role');
const ApiError = require('../utils/ApiError');

/**
 * Un utilisateur à portée pays (ex. Administrateur pays) ne doit jamais voir
 * ni pouvoir créer un rôle à portée globale (section 4.2, 4.4) — sans quoi
 * il pourrait s'attribuer, ou attribuer à un autre compte, les pleins
 * pouvoirs du Super administrateur.
 */
async function lister(req) {
  const filtre = req.user.porteeGlobale ? {} : { portee: { $ne: 'global' } };
  return Role.find(filtre).sort({ nom: 1 });
}

async function creer(data, req) {
  if (!req.user.porteeGlobale && data.portee === 'global') {
    throw ApiError.forbidden('Seul un utilisateur à portée globale peut créer un rôle à portée globale');
  }
  return Role.create(data);
}

module.exports = { lister, creer };
