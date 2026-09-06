const { getCurrentUser } = require('../utils/requestContext');

/**
 * Plugin de schéma Mongoose — cloisonnement par pays (section 3.9, 4.3).
 *
 * Appliqué à chaque modèle portant un champ `pays_id`, il :
 *  - restreint automatiquement find/findOne/countDocuments/aggregate à la liste
 *    des pays autorisés de l'utilisateur courant (lu depuis le contexte de requête,
 *    voir utils/requestContext.js), sauf si l'utilisateur a une portée globale ;
 *  - refuse à l'écriture (pre save/validate) la création d'un document dont le
 *    pays_id ne fait pas partie des pays autorisés de l'utilisateur courant.
 *
 * Cette double application (lecture + écriture) constitue la deuxième ligne de
 * défense derrière le middleware Express `scopePays` (défense en profondeur,
 * section 4.3) : même un appel de service qui oublierait le filtre reste protégé.
 */
function paysScopePlugin(schema, options = {}) {
  const field = (options && options.field) || 'pays_id';

  function applyScopeToQuery() {
    const user = getCurrentUser();
    if (!user || user.porteeGlobale) return; // pas de contexte (seed/CLI/tests) ou accès global
    const filter = this.getFilter ? this.getFilter() : this._conditions;
    if (filter && filter[field] !== undefined) return; // filtre déjà explicite (ex. lookup par id)
    this.where({ [field]: { $in: user.paysAutorises || [] } });
  }

  schema.pre(['find', 'findOne', 'findOneAndUpdate', 'countDocuments'], function preFind() {
    applyScopeToQuery.call(this);
  });

  schema.pre('aggregate', function preAggregate() {
    const user = getCurrentUser();
    if (!user || user.porteeGlobale) return;
    this.pipeline().unshift({ $match: { [field]: { $in: user.paysAutorises || [] } } });
  });

  schema.pre('validate', function preValidate(next) {
    const user = getCurrentUser();
    if (!user || user.porteeGlobale || !this.isNew) return next();
    if (this[field] === undefined || this[field] === null) return next();
    const autorises = (user.paysAutorises || []).map(String);
    if (!autorises.includes(String(this[field]))) {
      return next(new Error("Pays non autorisé pour l'utilisateur courant"));
    }
    return next();
  });
}

module.exports = paysScopePlugin;
