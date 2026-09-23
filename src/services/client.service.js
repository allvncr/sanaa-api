const Client = require('../models/Client');
const Commande = require('../models/Commande');
const ApiError = require('../utils/ApiError');
const { sum, toDecimal } = require('../utils/money');

const LIMITE_DEFAUT = 20;
const LIMITE_MAX = 100;

/** Liste des clients, paginée (écran Clients). */
async function lister({ pays_id, q, page, limite } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (q) filtre.$or = [{ nom: new RegExp(q, 'i') }, { telephone_whatsapp: new RegExp(q, 'i') }];

  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(LIMITE_MAX, Math.max(1, Number(limite) || LIMITE_DEFAUT));
  const [items, total] = await Promise.all([
    Client.find(filtre).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l),
    Client.countDocuments(filtre),
  ]);
  return { items, meta: { page: p, limite: l, total } };
}

async function creer(data) {
  return Client.create(data);
}

/**
 * Retour V0.1 : la saisie rapide de commande n'exige plus de rechercher/créer
 * un client à part — le numéro de téléphone (au sein d'un même pays) sert de
 * clé d'identification, le nom n'étant pas systématiquement conservé. Si le
 * client existe déjà, ses informations manquantes (nom, adresse) sont
 * complétées mais rien n'est jamais écrasé silencieusement.
 */
async function trouverOuCreer({ pays_id, telephone_whatsapp, nom, adresse }) {
  if (!telephone_whatsapp) {
    // Pas de téléphone fourni : impossible de dédoublonner, on crée un client dédié.
    return Client.create({ pays_id, telephone_whatsapp, nom, adresse });
  }

  const existant = await Client.findOne({ pays_id, telephone_whatsapp });
  if (!existant) {
    return Client.create({ pays_id, telephone_whatsapp, nom, adresse });
  }

  const miseAJour = {};
  if (nom && !existant.nom) miseAJour.nom = nom;
  if (adresse && !existant.adresse) miseAJour.adresse = adresse;
  if (Object.keys(miseAJour).length > 0) {
    Object.assign(existant, miseAJour);
    await existant.save();
  }
  return existant;
}

async function modifier(id, data) {
  const client = await Client.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!client) throw ApiError.notFound('Client introuvable');
  return client;
}

/**
 * Historique de commandes d'un client, avec indicateurs calculés à la volée par
 * agrégation (section 3.4) : nombre de commandes, montant dépensé, dernière commande.
 */
async function historiqueCommandes(clientId) {
  const client = await Client.findById(clientId);
  if (!client) throw ApiError.notFound('Client introuvable');

  const commandes = await Commande.find({ client_id: clientId }).sort({ createdAt: -1 });
  const montantTotal = sum(commandes.map((c) => c.total));
  const derniere = commandes[0] || null;

  return {
    client,
    commandes,
    indicateurs: {
      nombre_commandes: commandes.length,
      montant_depense: montantTotal.toFixed(2),
      derniere_commande: derniere ? derniere.createdAt : null,
    },
  };
}

module.exports = { lister, creer, modifier, trouverOuCreer, historiqueCommandes };
