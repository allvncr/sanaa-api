const Commande = require('../models/Commande');
const ApiError = require('../utils/ApiError');

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

  const etapes = [
    { cle: 'confirmee', libelle: 'Commande confirmée', atteinte: true, date: commande.createdAt },
    { cle: 'fabrication_terminee', libelle: 'Fabrication terminée', atteinte: fabricationAtteinte >= 2, date: commande.date_fabrication_terminee },
    { cle: 'recue_en_pays', libelle: 'Reçue en pays', atteinte: livraisonRang >= 1, date: null },
    { cle: 'en_livraison', libelle: 'En livraison', atteinte: livraisonRang >= 2, date: commande.date_debut_livraison },
    { cle: 'livree', libelle: 'Livrée', atteinte: livraisonRang >= 3, date: commande.date_livraison },
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
 * commande + téléphone du client comme seule vérification. Ne renvoie jamais
 * de données financières (total, paiements, reste à payer), l'adresse
 * complète du client, ni le texte des personnalisations gravées : seulement
 * ce qui sert à répondre à "où en est ma commande".
 */
async function suivre(numero, telephoneSaisi) {
  const numeroNormalise = String(numero || '').trim().toUpperCase();
  if (!numeroNormalise || !telephoneSaisi) throw ApiError.notFound(MESSAGE_INTROUVABLE);

  const commande = await Commande.findOne({ numero: numeroNormalise })
    .populate('client_id', 'telephone_whatsapp')
    .populate('lignes.produit_id', 'nom');
  if (!commande) throw ApiError.notFound(MESSAGE_INTROUVABLE);

  const telephoneClient = commande.client_id ? commande.client_id.telephone_whatsapp : '';
  if (!telephoneCorrespond(telephoneClient, telephoneSaisi)) throw ApiError.notFound(MESSAGE_INTROUVABLE);

  const { probleme, etapes } = construireEtapes(commande);

  return {
    numero: commande.numero,
    creee_le: commande.createdAt,
    statut_fabrication_libelle: LIBELLES_FABRICATION[commande.statut_fabrication],
    statut_livraison_libelle: LIBELLES_LIVRAISON[commande.statut_livraison],
    probleme,
    etapes,
    articles: commande.lignes.map((l) => ({
      produit: l.produit_id && l.produit_id.nom ? l.produit_id.nom : 'Bijou personnalisé',
      couleur: l.couleur_choisie || undefined,
      quantite: l.quantite,
    })),
  };
}

module.exports = { suivre };
