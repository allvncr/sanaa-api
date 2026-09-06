const CampagneMarketing = require('../models/CampagneMarketing');
const MesureMarketing = require('../models/MesureMarketing');
const Commande = require('../models/Commande');
const { sum, toDecimal, toDecimal128 } = require('../utils/money');

async function listerCampagnes({ pays_id } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  return CampagneMarketing.find(filtre).sort({ createdAt: -1 });
}

async function creerCampagne(data) {
  return CampagneMarketing.create(data);
}

async function ajouterMesure(data) {
  return MesureMarketing.findOneAndUpdate(
    { campagne_id: data.campagne_id, date: new Date(data.date) },
    {
      $set: {
        depense: toDecimal128(data.depense || 0),
        impressions: data.impressions || 0,
        clics: data.clics || 0,
        messages: data.messages || 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * CPA / ROAS / bénéfice après publicité (section 5.9) — relie les mesures de
 * campagne aux commandes attribuées (commandes.campagne_id) sur une période.
 */
async function performance({ pays_id, periode_debut, periode_fin }) {
  const filtreCampagne = pays_id ? { pays_id } : {};
  const campagnes = await CampagneMarketing.find(filtreCampagne);

  const resultats = [];
  for (const campagne of campagnes) {
    const filtreMesures = { campagne_id: campagne._id };
    if (periode_debut || periode_fin) {
      filtreMesures.date = {};
      if (periode_debut) filtreMesures.date.$gte = new Date(periode_debut);
      if (periode_fin) filtreMesures.date.$lte = new Date(periode_fin);
    }
    const mesures = await MesureMarketing.find(filtreMesures);
    const depenseTotale = sum(mesures.map((m) => m.depense));
    const messagesTotal = mesures.reduce((acc, m) => acc + (m.messages || 0), 0);

    const filtreCommandes = { campagne_id: campagne._id };
    if (periode_debut || periode_fin) {
      filtreCommandes.createdAt = {};
      if (periode_debut) filtreCommandes.createdAt.$gte = new Date(periode_debut);
      if (periode_fin) filtreCommandes.createdAt.$lte = new Date(periode_fin);
    }
    const commandes = await Commande.find(filtreCommandes);
    const caAttribue = sum(commandes.map((c) => c.total));

    const cpa = commandes.length > 0 ? depenseTotale.div(commandes.length) : toDecimal(0);
    const roas = depenseTotale.gt(0) ? caAttribue.div(depenseTotale) : toDecimal(0);
    const beneficeApresPub = caAttribue.minus(depenseTotale);

    resultats.push({
      campagne_id: campagne._id,
      campagne: campagne.campagne,
      plateforme: campagne.plateforme,
      depense_totale: depenseTotale.toFixed(2),
      messages: messagesTotal,
      commandes_attribuees: commandes.length,
      ca_attribue: caAttribue.toFixed(2),
      cpa: cpa.toFixed(2),
      roas: roas.toFixed(2),
      benefice_apres_pub: beneficeApresPub.toFixed(2),
    });
  }

  return resultats;
}

module.exports = { listerCampagnes, creerCampagne, ajouterMesure, performance };
