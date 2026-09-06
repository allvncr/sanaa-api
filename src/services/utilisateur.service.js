const Utilisateur = require('../models/Utilisateur');
const ApiError = require('../utils/ApiError');

async function lister(req) {
  const filtre = {};
  if (!req.user.porteeGlobale) filtre.pays_autorises = { $in: req.user.paysAutorises };
  return Utilisateur.find(filtre).populate('role_id').populate('pays_autorises').sort({ nom: 1 });
}

async function creer(data) {
  const mot_de_passe_hash = await Utilisateur.hasherMotDePasse(data.mot_de_passe);
  const { mot_de_passe, ...reste } = data;
  const cree = await Utilisateur.create({ ...reste, mot_de_passe_hash });
  // Utilisateur.create() renvoie l'instance en mémoire, qui porte encore
  // mot_de_passe_hash malgré `select:false` (actif seulement sur les requêtes) —
  // on refait donc une lecture pour ne jamais exposer le hash dans la réponse API.
  return Utilisateur.findById(cree._id).populate('role_id').populate('pays_autorises');
}

async function modifier(id, data) {
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
