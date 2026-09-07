const Utilisateur = require('../models/Utilisateur');
const Role = require('../models/Role');
const ApiError = require('../utils/ApiError');

async function lister(req) {
  const filtre = {};
  if (!req.user.porteeGlobale) filtre.pays_autorises = { $in: req.user.paysAutorises };
  return Utilisateur.find(filtre).populate('role_id').populate('pays_autorises').sort({ nom: 1 });
}

/**
 * Empêche un utilisateur à portée pays (ex. Administrateur pays) de créer ou
 * de promouvoir un compte vers un rôle à portée globale — sinon il pourrait
 * s'octroyer, ou octroyer à quelqu'un d'autre, les pleins pouvoirs du Super
 * administrateur (section 4.2, 4.4).
 */
async function refuserPromotionGlobale(roleId, req) {
  if (req.user.porteeGlobale || !roleId) return;
  const role = await Role.findById(roleId);
  if (role && role.portee === 'global') {
    throw ApiError.forbidden("Seul un utilisateur à portée globale peut attribuer un rôle à portée globale");
  }
}

async function creer(data, req) {
  await refuserPromotionGlobale(data.role_id, req);
  const mot_de_passe_hash = await Utilisateur.hasherMotDePasse(data.mot_de_passe);
  const { mot_de_passe, ...reste } = data;
  const cree = await Utilisateur.create({ ...reste, mot_de_passe_hash });
  // Utilisateur.create() renvoie l'instance en mémoire, qui porte encore
  // mot_de_passe_hash malgré `select:false` (actif seulement sur les requêtes) —
  // on refait donc une lecture pour ne jamais exposer le hash dans la réponse API.
  return Utilisateur.findById(cree._id).populate('role_id').populate('pays_autorises');
}

async function modifier(id, data, req) {
  await refuserPromotionGlobale(data.role_id, req);

  if (!req.user.porteeGlobale) {
    // Un Administrateur pays ne doit pas non plus pouvoir modifier un compte
    // Super administrateur existant (mot de passe, désactivation...), même
    // sans toucher au rôle.
    const cible = await Utilisateur.findById(id).populate('role_id');
    if (cible && cible.role_id && cible.role_id.portee === 'global') {
      throw ApiError.forbidden("Vous ne pouvez pas modifier un compte à portée globale");
    }
  }

  const payload = { ...data };
  if (payload.mot_de_passe) {
    payload.mot_de_passe_hash = await Utilisateur.hasherMotDePasse(payload.mot_de_passe);
    delete payload.mot_de_passe;
  }
  const utilisateur = await Utilisateur.findByIdAndUpdate(id, payload, { new: true, runValidators: true })
    .populate('role_id')
    .populate('pays_autorises');
  if (!utilisateur) throw ApiError.notFound('Utilisateur introuvable');
  return utilisateur;
}

async function attribuerPays(id, paysIds) {
  const utilisateur = await Utilisateur.findByIdAndUpdate(
    id,
    { pays_autorises: paysIds },
    { new: true, runValidators: true }
  ).populate('pays_autorises');
  if (!utilisateur) throw ApiError.notFound('Utilisateur introuvable');
  return utilisateur;
}

module.exports = { lister, creer, modifier, attribuerPays };
