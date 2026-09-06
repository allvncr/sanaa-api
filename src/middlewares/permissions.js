const ApiError = require('../utils/ApiError');

/**
 * Vérifie que l'utilisateur courant porte la permission "module:action" requise
 * (section 4.2, 4.3). À utiliser après `authentifier` sur chaque route sensible.
 */
function requirePermission(permission) {
  return function permissionMiddleware(req, res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.permissions.includes(permission)) return next();
    return next(ApiError.forbidden(`Permission requise : ${permission}`));
  };
}

module.exports = requirePermission;
