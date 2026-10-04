const Commande = require('../models/Commande');
const ApiError = require('../utils/ApiError');
const { toDecimal, sum } = require('../utils/money');

// Message volontairement identique pour "commande introuvable" et "téléphone
// incorrect" : un point de suivi public ne doit jamais confirmer qu'un numéro
// de commande existe à quelqu'un qui ne connaît pas aussi le téléphone du
// client. Les numéros de commande sont séquentiels (CI-2026-000148...) donc
// triviaux à deviner ; le téléphone est la seule vraie barrière ici.
const MESSAGE_INTROUVABLE = "Aucune commande ne correspond à ce numéro et ce téléphone. Vérifiez les deux informations.";

const seulsChiffres = (s) => String(s || '').replace(/\D/g, '');

/**
 * Un même champ téléphone client peut contenir plusieurs numéros séparés par
 * "/" (saisie historique, ex. couple partageant une commande) — on compare
 * les 6 derniers chiffres de chaque candidat plutôt qu'une égalité stricte,
 * pour rester tolérant à l'indicatif pays ou aux espaces/tirets de saisie.
 */
function telephoneCorrespond(telephoneClient, telephoneSaisi) {
  const saisi = seulsChiffres(telephoneSaisi);
  if (saisi.length < 4) return false;
  const suffixeSaisi = saisi.slice(-6);
  return String(telephoneClient || '')
    .split('/')
    .map(seulsChiffres)
    .filter(Boolean)
    .some((candidat) => candidat.slice(-6) === suffixeSaisi || candidat.slice(-4) === saisi.slice(-4));
}

// Délais moyens communiqués au client (retour V0.1, 29/09/2026) — utilisés pour
// estimer les jalons non encore atteints ; dès qu'un jalon est réellement
// atteint, sa date réelle horodatée prend le pas sur l'estimation.
const UN_JOUR_MS = 24 * 60 * 60 * 1000;
const JOURS_FABRICATION = 7;
const JOURS_TRANSIT = 7;

function ajouterJours(date, jours) {
  return new Date(date.getTime() + jours * UN_JOUR_MS);
}

// Jamais de livraison le dimanche : si le jour estimé tombe un dimanche, on le
// décale au lundi suivant.
function prochainJourLivrable(date) {
  const d = new Date(date);
  if (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d;
}

const LIBELLES_FABRICATION = {
  A_produire: 'À produire',
  En_fabrication: 'En fabrication',
  Terminee: 'Terminée',
  Erreur: 'Erreur constatée',
};
const LIBELLES_LIVRAISON = {
  A_expedier: 'À expédier',
  Recue_en_pays: 'Reçue en pays',
  En_livraison: 'En livraison',
  Livree: 'Livrée',
  Retour_echec: 'Retour / échec de livraison',
};

/**
 * Réduit les trois statuts internes (commande/fabrication/livraison) à un
 * parcours unique et lisible pour le client — il n'a pas à comprendre le
 * modèle de données interne, juste "où en est mon bijou".
 */
function construireEtapes(commande) {
  if (['Annulee', 'Refusee'].includes(commande.statut_commande)) {
    return {
      probleme: commande.statut_commande === 'Annulee' ? 'Cette commande a été annulée.' : 'Cette commande a été refusée.',
      etapes: [],
    };
  }

  const fabricationAtteinte = { A_produire: 1, En_fabrication: 1, Terminee: 2, Erreur: 0 }[commande.statut_fabrication] || 0;
  const livraisonRang = { A_expedier: 0, Recue_en_pays: 1, En_livraison: 2, Livree: 3, Retour_echec: 0 }[commande.statut_livraison] || 0;

  // Chaque estimation part de la meilleure date connue à ce stade (réelle si le
  // jalon précédent est atteint, sinon déjà elle-même une estimation) — la chaîne
  // se resserre au fur et à mesure que les vraies dates arrivent.
  const dateFabricationTerminee = commande.date_fabrication_terminee || ajouterJours(commande.createdAt, JOURS_FABRICATION);
  const dateRecueEnPays = commande.date_recue_en_pays || ajouterJours(dateFabricationTerminee, JOURS_TRANSIT);
  const dateLivraisonEstimee = commande.date_livraison || prochainJourLivrable(ajouterJours(dateRecueEnPays, 1));

  const etapes = [
    { cle: 'confirmee', libelle: 'Commande confirmée', atteinte: true, date: commande.createdAt, date_estimee: null },
    {
      cle: 'fabrication_terminee',
      libelle: 'Fabrication terminée',
      atteinte: fabricationAtteinte >= 2,
      date: fabricationAtteinte >= 2 ? commande.date_fabrication_terminee : null,
      date_estimee: fabricationAtteinte >= 2 ? null : dateFabricationTerminee,
    },
    {
      cle: 'recue_en_pays',
      libelle: 'Reçue en pays',
      atteinte: livraisonRang >= 1,
      date: livraisonRang >= 1 ? commande.date_recue_en_pays : null,
      date_estimee: livraisonRang >= 1 ? null : dateRecueEnPays,
    },
    {
      cle: 'en_livraison',
      libelle: 'En livraison',
      atteinte: livraisonRang >= 2,
      date: livraisonRang >= 2 ? commande.date_debut_livraison : null,
      date_estimee: livraisonRang >= 2 ? null : dateLivraisonEstimee,
    },
    {
      cle: 'livree',
      libelle: 'Livrée',
      atteinte: livraisonRang >= 3,
      date: livraisonRang >= 3 ? commande.date_livraison : null,
      date_estimee: livraisonRang >= 3 ? null : dateLivraisonEstimee,
    },
  ];

  let probleme = null;
  if (commande.statut_fabrication === 'Erreur') {
    probleme = 'Un défaut a été constaté à la réception de votre bijou : nous vous recontactons pour la suite.';
  } else if (commande.statut_livraison === 'Retour_echec') {
    probleme = 'La livraison a rencontré un problème (absence, retour...) : nous vous recontactons pour la suite.';
  }

  return { probleme, etapes };
}

/**
 * Suivi public d'une commande — accessible sans compte, avec numéro de
 * commande + téléphone du client comme seule vérification. Le téléphone saisi
 * est déjà la preuve que l'on parle au client lui-même, donc on lui confirme
 * ses propres coordonnées (nom, téléphone, adresse de livraison) et le détail
 * de personnalisation de son bijou (retour V0.1, 29/09/2026), puis (02/10/2026)
 * le détail financier de SA commande : prix, avance(s) déjà versée(s) et reste
 * à payer à la livraison. Jamais les paiements annulés ni qui les a saisis.
 */
async function suivre(numero, telephoneSaisi) {
  const numeroNormalise = String(numero || '').trim().toUpperCase();
  if (!numeroNormalise || !telephoneSaisi) throw ApiError.notFound(MESSAGE_INTROUVABLE);

  const commande = await Commande.findOne({ numero: numeroNormalise })
    .populate('client_id', 'nom telephone_whatsapp adresse')
    .populate('devise_id', 'symbole code')
    .populate('pays_id', 'frais_livraison')
    .populate('lignes.produit_id', 'nom');
  if (!commande) throw ApiError.notFound(MESSAGE_INTROUVABLE);

  const telephoneClient = commande.client_id ? commande.client_id.telephone_whatsapp : '';
  if (!telephoneCorrespond(telephoneClient, telephoneSaisi)) throw ApiError.notFound(MESSAGE_INTROUVABLE);

  const { probleme, etapes } = construireEtapes(commande);

  const paiementsValides = commande.paiements.filter((p) => !p.annule);
  const avance = sum(paiementsValides.map((p) => p.montant));
  const reduction = toDecimal(commande.reduction || 0);
  const totalNet = toDecimal(commande.total).minus(reduction);
  const reste = totalNet.minus(toDecimal(commande.ajustement_livraison || 0)).minus(avance);
  const devise = commande.devise_id ? commande.devise_id.symbole || commande.devise_id.code : '';
  // Frais de livraison du pays : dus en plus du solde, jusqu'à la livraison.
  // Un client qui a payé le bijou + les frais d'avance a un surplus : ce sont ses
  // frais de livraison déjà réglés, à déduire de ce qu'il reste à prévoir.
  const surplus = reste.isNegative() ? reste.negated().toNumber() : 0;
  const fraisStandard = Number(commande.pays_id && commande.pays_id.frais_livraison) || 0;
  const fraisLivraison = commande.statut_livraison === 'Livree' ? 0 : Math.max(0, fraisStandard - surplus);
  const resteNumber = reste.isNegative() ? 0 : reste.toNumber();

  return {
    numero: commande.numero,
    creee_le: commande.createdAt,
    statut_fabrication_libelle: LIBELLES_FABRICATION[commande.statut_fabrication],
    statut_livraison_libelle: LIBELLES_LIVRAISON[commande.statut_livraison],
    probleme,
    etapes,
    client: commande.client_id
      ? {
          nom: commande.client_id.nom,
          telephone_whatsapp: commande.client_id.telephone_whatsapp,
          adresse: commande.client_id.adresse,
        }
      : null,
    finances: {
      devise,
      total: toDecimal(commande.total).toNumber(),
      reduction: reduction.toNumber(),
      total_net: totalNet.toNumber(),
      avance: avance.toNumber(),
      reste_a_payer: resteNumber,
      frais_livraison: fraisLivraison,
      frais_regles: surplus,
      a_prevoir_livraison: resteNumber + fraisLivraison,
      paiements: paiementsValides.map((p) => ({
        date: p.date_paiement,
        montant: toDecimal(p.montant).toNumber(),
        type: p.type,
        moyen: p.moyen_paiement,
      })),
    },
    articles: commande.lignes.map((l) => ({
      produit: l.produit_id && l.produit_id.nom ? l.produit_id.nom : 'Bijou personnalisé',
      couleur: l.couleur_choisie || undefined,
      detail: l.detail_variante || undefined,
      quantite: l.quantite,
      prix_unitaire: toDecimal(l.prix_unitaire_applique).toNumber(),
      sous_total: toDecimal(l.sous_total).toNumber(),
      personnalisation: (l.personnalisation || []).map((p) => p.texte).filter(Boolean).join(' / ') || undefined,
    })),
  };
}

module.exports = { suivre };
