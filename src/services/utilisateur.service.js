const Utilisateur = require('../models/Utilisateur');
const Role = require('../models/Role');
const ApiError = require('../utils/ApiError');

const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 100;

/** Liste des utilisateurs, paginée (écran Utilisateurs). */
async function lister(req) {
  const filtre = {};
  if (!req.user.porteeGlobale) filtre.pays_autorises = { $in: req.user.paysAutorises };

  const p = Math.max(1, Number(req.query.page) || 1);
  const l = Math.min(LIMITE_MAX, Math.max(1, Number(req.query.limite) || LIMITE_DEFAUT));
  const [items, total] = await Promise.all([
    Utilisateur.find(filtre)
      .populate('role_id')
      .populate('pays_autorises')
      .sort({ nom: 1 })
      .skip((p - 1) * l)
      .limit(l),
    Utilisateur.countDocuments(filtre),
  ]);
  return { items, meta: { page: p, limite: l, total } };
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

/**
 * Suppression définitive d'un compte — refusée si le compte a déjà laissé une
 * trace (commandes, livraisons, dépenses, stock, journal d'activité), pour ne
 * jamais casser l'attribution de l'historique existant. `modifier(id, { actif:
 * false })` reste la voie pour désactiver un compte qui a un historique.
 */
async function supprimer(id, req) {
  if (String(req.user.id) === String(id)) {
    throw ApiError.forbidden('Vous ne pouvez pas supprimer votre propre compte');
  }

  const utilisateur = await Utilisateur.findById(id).populate('role_id');
  if (!utilisateur) throw ApiError.notFound('Utilisateur introuvable');

  if (!req.user.porteeGlobale && utilisateur.role_id && utilisateur.role_id.portee === 'global') {
    throw ApiError.forbidden('Vous ne pouvez pas supprimer un compte à portée globale');
  }

  const [Commande, Livraison, Depense, StockMouvement, JournalActivite] = [
    require('../models/Commande'),
    require('../models/Livraison'),
    require('../models/Depense'),
    require('../models/StockMouvement'),
    require('../models/JournalActivite'),
  ];

  const verifications = [
    { modele: Commande, champ: 'cree_par', libelle: 'des commandes créées' },
    { modele: Livraison, champ: 'cree_par', libelle: 'des livraisons planifiées' },
    { modele: Livraison, champ: 'livree_par', libelle: 'des livraisons confirmées' },
    { modele: Depense, champ: 'valide_par', libelle: 'des dépenses validées' },
    { modele: StockMouvement, champ: 'saisi_par', libelle: 'des mouvements de stock' },
    { modele: JournalActivite, champ: 'utilisateur_id', libelle: "des actions dans le journal d'activité" },
  ];

  for (const { modele, champ, libelle } of verifications) {
    const existe = await modele.exists({ [champ]: id });
    if (existe) {
      throw ApiError.conflict(
        `Suppression impossible : ${libelle} sont déjà rattachées à ce compte. Désactivez-le plutôt (modifier → actif = false).`
      );
    }
  }

  await Utilisateur.deleteOne({ _id: id });
  return { supprime: true };
}

module.exports = { lister, creer, modifier, attribuerPays, supprimer };
