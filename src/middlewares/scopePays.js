const ApiError = require('../utils/ApiError');

/**
 * Middleware Express — première ligne de défense du cloisonnement par pays
 * (section 4.3, point 2). Vérifie que le ou les pays demandés dans la requête
 * (query, params ou corps) font bien partie des pays autorisés de l'utilisateur
 * courant, et rejette la requête (403) sinon. Un super administrateur (portée
 * globale) n'est jamais restreint.
 *
 * Complète — sans le remplacer — le filtrage automatique appliqué par
 * `paysScopePlugin` au niveau des requêtes Mongoose.
 */
function scopePays(...champs) {
  const listeChamps = champs.length ? champs : ['pays_id'];

  return function scopePaysMiddleware(req, res, next) {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.porteeGlobale) return next();

    const valeursDemandees = [];
    for (const champ of listeChamps) {
      const valeur = req.query[champ] ?? req.params[champ] ?? req.body?.[champ];
      if (valeur !== undefined) {
        if (Array.isArray(valeur)) valeursDemandees.push(...valeur);
        else valeursDemandees.push(valeur);
      }
    }

    if (valeursDemandees.length === 0) return next(); // filtré ensuite par le plugin Mongoose

    const nonAutorise = valeursDemandees.some((v) => !req.user.paysAutorises.includes(String(v)));
    if (nonAutorise) {
      return next(ApiError.forbidden("Vous n'avez pas accès à ce pays"));
    }
    return next();
  };
}

module.exports = scopePays;
