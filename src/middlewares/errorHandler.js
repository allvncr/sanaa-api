const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route inconnue : ${req.method} ${req.originalUrl}`));
}

// Gestion centralisée des erreurs (section 2.2) — format homogène
// { error: { code, message, details } }.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let apiErr = err;

  if (err.name === 'ValidationError') {
    apiErr = ApiError.badRequest('Erreur de validation', Object.values(err.errors).map((e) => e.message));
  } else if (err.code === 11000) {
    apiErr = ApiError.conflict('Valeur en doublon sur un champ unique');
  } else if (!(err instanceof ApiError)) {
    logger.error(err);
    apiErr = new ApiError(500, 'INTERNAL_ERROR', 'Erreur interne du serveur');
  }

  res.status(apiErr.status).json({
    error: { code: apiErr.code, message: apiErr.message, details: apiErr.details },
  });
}

module.exports = { notFoundHandler, errorHandler };
