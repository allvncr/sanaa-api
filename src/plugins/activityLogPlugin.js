const { getCurrentUser } = require('../utils/requestContext');

/**
 * Plugin de schéma Mongoose — journal d'activité automatique (section 2.6, 2.2, 3.8).
 *
 * Alimente la collection `journal_activite` à chaque création/modification/suppression
 * sur les entités sensibles, via les hooks de schéma Mongoose (pre/post save,
 * findOneAndUpdate, findOneAndDelete) plutôt qu'en dupliquant cet appel dans chaque
 * service. `entite` prend le nom du modèle Mongoose (ex. "Commande").
 *
 * Le modèle JournalActivite est résolu paresseusement (require différé) pour éviter
 * une dépendance circulaire au chargement des modèles.
 */
function activityLogPlugin(schema, options = {}) {
  const entite = options.entite;
  if (!entite) throw new Error('activityLogPlugin requiert options.entite');
  // Champs sensibles jamais écrits dans le journal (ex. hash de mot de passe),
  // même si l'instance Mongoose les porte en mémoire malgré `select:false`.
  const champsExclus = options.exclure || [];

  function JournalActivite() {
    return require('../models/JournalActivite');
  }

  function currentUserId() {
    const user = getCurrentUser();
    return user ? user.id : undefined;
  }

  function nettoyer(obj) {
    if (!obj || champsExclus.length === 0) return obj;
    const copie = { ...obj };
    for (const champ of champsExclus) delete copie[champ];
    return copie;
  }

  async function ecrire({ action, entite_id, avant, apres, pays_id }) {
    avant = nettoyer(avant);
    apres = nettoyer(apres);
    try {
      await JournalActivite().create({
        utilisateur_id: currentUserId(),
        action,
        entite,
        entite_id,
        avant,
        apres,
        pays_id,
        date: new Date(),
      });
    } catch (err) {
      // Le journal ne doit jamais faire échouer l'opération métier qu'il observe.
      // eslint-disable-next-line no-console
      console.error(`[journal_activite] échec d'écriture pour ${entite}:`, err.message);
    }
  }

  schema.pre('save', async function preSave() {
    if (!this.isNew) {
      const original = await this.constructor.findById(this._id).lean();
      this.$locals.avant = original || undefined;
    }
  });

  schema.post('save', function postSave(doc) {
    const action = this.$locals.avant ? 'modification' : 'creation';
    ecrire({
      action,
      entite_id: doc._id,
      avant: this.$locals.avant,
      apres: doc.toObject ? doc.toObject() : doc,
      pays_id: doc.pays_id,
    });
  });

  schema.pre('findOneAndUpdate', async function preFOU() {
    const original = await this.model.findOne(this.getQuery()).lean();
    this._avant = original || undefined;
  });

  schema.post('findOneAndUpdate', function postFOU(doc) {
    if (!doc) return;
    ecrire({
      action: 'modification',
      entite_id: doc._id,
      avant: this._avant,
      apres: doc.toObject ? doc.toObject() : doc,
      pays_id: doc.pays_id,
    });
  });

  schema.post(['findOneAndDelete', 'findOneAndRemove'], function postDelete(doc) {
    if (!doc) return;
    ecrire({
      action: 'suppression',
      entite_id: doc._id,
      avant: doc.toObject ? doc.toObject() : doc,
      apres: undefined,
      pays_id: doc.pays_id,
    });
  });
}

module.exports = activityLogPlugin;
