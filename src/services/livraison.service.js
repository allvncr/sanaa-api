const Livraison = require('../models/Livraison');
const Commande = require('../models/Commande');
const ApiError = require('../utils/ApiError');
const commandeService = require('./commande.service');

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;

function verifierJour(jour, libelle = 'Date') {
  if (!FORMAT_JOUR.test(String(jour || '')) || Number.isNaN(new Date(`${jour}T00:00:00Z`).getTime())) {
    throw ApiError.badRequest(`${libelle} invalide (format attendu : AAAA-MM-JJ)`);
  }
}

const POPULATE_COMMANDE = {
  path: 'commande_id',
  populate: [
    { path: 'client_id', select: 'nom telephone_whatsapp adresse' },
    { path: 'pays_id', select: 'code nom' },
    { path: 'lignes.produit_id', select: 'nom' },
  ],
};

function formater(livraison) {
  const c = livraison.commande_id;
  const base = { _id: livraison._id, jour: livraison.jour, createdAt: livraison.createdAt };
  // Commande supprimée depuis : l'entrée reste visible pour pouvoir être retirée.
  if (!c || !c.numero) return { ...base, commande: null };

  const obj = commandeService.avecResteAPayer(c);
  return {
    ...base,
    commande: {
      _id: obj._id,
      numero: obj.numero,
      pays: obj.pays_id ? obj.pays_id.code : null,
      statut_commande: obj.statut_commande,
      statut_livraison: obj.statut_livraison,
      total: String(obj.total),
      reduction: String(obj.reduction || 0),
      reste_a_payer: obj.reste_a_payer,
      client: obj.client_id
        ? {
            nom: obj.client_id.nom,
            telephone_whatsapp: obj.client_id.telephone_whatsapp,
            adresse: obj.client_id.adresse,
          }
        : null,
      lignes: obj.lignes.map((l) => ({
        produit: l.produit_id && l.produit_id.nom ? l.produit_id.nom : 'Produit',
        couleur: l.couleur_choisie,
        detail: l.detail_variante,
        quantite: l.quantite,
        personnalisation: (l.personnalisation || []).map((p) => p.texte).filter(Boolean).join(' / '),
      })),
    },
  };
}

/** Livraisons prévues entre deux jours inclus (grille du calendrier), triées par jour. */
async function lister({ du, au, pays_id, commande_id } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (commande_id) filtre.commande_id = commande_id;
  if (du || au) {
    filtre.jour = {};
    if (du) {
      verifierJour(du, 'Date de début');
      filtre.jour.$gte = du;
    }
    if (au) {
      verifierJour(au, 'Date de fin');
      filtre.jour.$lte = au;
    }
  }
  const livraisons = await Livraison.find(filtre).populate(POPULATE_COMMANDE).sort({ jour: 1, createdAt: 1 });
  return livraisons.map(formater);
}

/**
 * Prévoit la livraison d'une commande un jour donné. Une commande annulée/refusée ne
 * se livre pas ; une même commande ne peut figurer qu'une fois par jour. Retourne aussi
 * les autres jours où elle est déjà prévue, pour que l'écran puisse le signaler.
 */
async function planifier({ commande_id, jour }, req) {
  verifierJour(jour);
  if (!commande_id) throw ApiError.badRequest('Commande requise');

  const commande = await Commande.findById(commande_id);
  if (!commande) throw ApiError.notFound('Commande introuvable');
  if (['Annulee', 'Refusee'].includes(commande.statut_commande)) {
    throw ApiError.conflict('Une commande annulée ou refusée ne peut pas être planifiée en livraison');
  }
  // Une commande ne se planifie en livraison qu'une fois fabriquée et reçue en pays
  // (retour V0.1) : avant, il n'y a rien à livrer physiquement.
  if (commande.statut_fabrication !== 'Terminee' || commande.statut_livraison !== 'Recue_en_pays') {
    throw ApiError.conflict(
      'Cette commande ne peut être planifiée en livraison que lorsque sa fabrication est Terminée et qu\'elle est Reçue en pays'
    );
  }

  const autres = await Livraison.find({ commande_id: commande._id, jour: { $ne: jour } })
    .select('jour')
    .sort({ jour: 1 });

  let livraison;
  try {
    livraison = await Livraison.create({
      commande_id: commande._id,
      pays_id: commande.pays_id,
      jour,
      cree_par: req.user.id,
    });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('Cette commande est déjà prévue en livraison ce jour-là');
    throw err;
  }

  const complete = await Livraison.findById(livraison._id).populate(POPULATE_COMMANDE);
  return { ...formater(complete), autres_jours: autres.map((a) => a.jour) };
}

/** Retire une livraison du calendrier (report ou livraison non effectuée). */
async function retirer(id) {
  const livraison = await Livraison.findById(id);
  if (!livraison) throw ApiError.notFound('Livraison introuvable');
  // findOneAndDelete (et non deleteOne d'instance) pour que le journal d'activité
  // enregistre la suppression et son auteur.
  await Livraison.findOneAndDelete({ _id: livraison._id, pays_id: livraison.pays_id });
  return { _id: livraison._id, jour: livraison.jour };
}

module.exports = { lister, planifier, retirer };
