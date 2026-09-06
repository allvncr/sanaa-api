const ApiError = require('../utils/ApiError');

/**
 * Validation systématique des payloads entrants avec Joi (section 2.6), en
 * complément de la validation de schéma Mongoose qui reste la source de vérité
 * finale (section 2.1).
 */
function validate(schema, source = 'body') {
  return function validateMiddleware(req, res, next) {
    const { error, value } = schema.validate(req[source], { abortEarly: false, stripUnknown: true });
    if (error) {
      return next(ApiError.badRequest('Payload invalide', error.details.map((d) => d.message)));
    }
    req[source] = value;
    return next();
  };
}

module.exports = validate;
