const Commande = require('../models/Commande');
const Produit = require('../models/Produit');
const Pays = require('../models/Pays');
const StockMouvement = require('../models/StockMouvement');
const ApiError = require('../utils/ApiError');
const { sum, toDecimal, toDecimal128, multiply } = require('../utils/money');
const withTransaction = require('../utils/withTransaction');
const clientService = require('./client.service');

function mouvementsReservation(commande, utilisateurId) {
  return commande.lignes.map((ligne) => ({
    produit_id: ligne.produit_id,
    variante_id: ligne.variante_id,
    pays_id: commande.pays_id,
    type: 'reservation',
    quantite: -ligne.quantite,
    reference_commande_id: commande._id,
    commentaire: `Réservation à la confirmation de la commande ${commande.numero}`,
    saisi_par: utilisateurId,
  }));
}

/**
 * Numéro de commande lisible par pays (ex. CI-2026-000123) — section 3.5.
 * Le compteur est incrémenté atomiquement ($inc) sur le document Pays lui-même
 * (parametres.compteurs_commandes.<annee>) pour rester correct sous écriture
 * concurrente, sans introduire de 20e collection dédiée à la seule séquence.
 */
async function genererNumero(paysId) {
  const annee = new Date().getFullYear();
  const chemin = `parametres.compteurs_commandes.${annee}`;
  const pays = await Pays.findByIdAndUpdate(
    paysId,
    { $inc: { [chemin]: 1 } },
    { new: true }
  );
  if (!pays) throw ApiError.notFound('Pays introuvable');
  const sequence = pays.parametres?.compteurs_commandes?.[annee] || 1;
  return `${pays.code}-${annee}-${String(sequence).padStart(6, '0')}`;
}

async function construireLigne(ligneInput, paysId) {
  const produit = await Produit.findById(ligneInput.produit_id);
  if (!produit) throw ApiError.notFound(`Produit introuvable : ${ligneInput.produit_id}`);
  const variante = produit.variantes.id(ligneInput.variante_id);
  if (!variante) throw ApiError.notFound('Variante introuvable pour ce produit');

  const prixPays = variante.prix_pays
    .filter((p) => String(p.pays_id) === String(paysId) && p.actif && p.date_debut_validite <= new Date())
    .sort((a, b) => b.date_debut_validite - a.date_debut_validite)[0];
  if (!prixPays) throw ApiError.badRequest("Aucun prix actif pour cette variante dans le pays de la commande");

  const quantite = ligneInput.quantite || 1;
  const prixUnitaire = toDecimal(prixPays.prix);
  const sousTotal = multiply(prixUnitaire, quantite);

  return {
    produit_id: produit._id,
    variante_id: variante._id,
    couleur_choisie: ligneInput.couleur_choisie || variante.couleur,
    detail_variante: ligneInput.detail_variante,
    personnalisation: ligneInput.personnalisation || [],
    quantite,
    prix_unitaire_applique: toDecimal128(prixUnitaire),
    devise_id: prixPays.devise_id,
    sous_total: toDecimal128(sousTotal),
  };
}

/**
 * Résout le client de la commande : soit un client_id déjà connu (usage API
 * direct), soit — cas normal de la saisie rapide (retour V0.1) — les champs
 * téléphone/nom/adresse fournis inline, auto-créés ou retrouvés par téléphone.
 */
async function resoudreClient(data) {
  if (data.client_id) return data.client_id;
  if (!data.client || !data.client.telephone_whatsapp) {
    throw ApiError.badRequest('Numéro de téléphone du client requis');
  }
  const client = await clientService.trouverOuCreer({
    pays_id: data.pays_id,
    telephone_whatsapp: data.client.telephone_whatsapp,
    nom: data.client.nom,
    adresse: data.client.adresse,
  });
  return client._id;
}

/**
 * Création d'une commande (retour V0.1) : la saisie rapide de SANAA enregistre
 * des ventes déjà actées — la commande est directement Confirmée et en
 * fabrication (valeurs par défaut du schéma), ce qui déclenche ici même la
 * réservation de stock dans la même transaction que la création (auparavant
 * déclenchée à une transition ultérieure vers Confirmée — voir
 * changerStatutCommande, conservé pour un usage manuel où le statut de
 * création serait explicitement forcé à "Nouvelle").
 */
async function creer(data, req) {
  if (!data.lignes || data.lignes.length === 0) {
    throw ApiError.badRequest('Une commande doit contenir au moins une ligne');
  }

  const clientId = await resoudreClient(data);

  const lignes = [];
  for (const ligneInput of data.lignes) {
    lignes.push(await construireLigne(ligneInput, data.pays_id));
  }

  const total = sum(lignes.map((l) => l.sous_total));
  const reduction = toDecimal(data.reduction || 0);
  const numero = await genererNumero(data.pays_id);

  const paiements = [];
  if (data.avance && toDecimal(data.avance.montant).gt(0)) {
    paiements.push({
      moyen_paiement: data.avance.moyen_paiement,
      type: 'avance',
      montant: toDecimal128(data.avance.montant),
      date_paiement: data.avance.date_paiement || new Date(),
      reference: data.avance.reference,
      saisi_par: req.user.id,
    });
  }

  return withTransaction(async (session) => {
    const documents = await Commande.create(
      [
        {
          numero,
          pays_id: data.pays_id,
          client_id: clientId,
          canal_vente: data.canal_vente,
          campagne_id: data.campagne_id,
          devise_id: lignes[0].devise_id,
          commentaires: data.commentaires,
          cree_par: req.user.id,
          lignes,
          paiements,
          total: toDecimal128(total),
          reduction: toDecimal128(reduction),
          // Permet un usage manuel/API en brouillon si explicitement demandé ;
          // sinon les valeurs par défaut du schéma (Confirmee/En_fabrication)
          // s'appliquent — cas normal de la saisie rapide.
          ...(data.statut_commande ? { statut_commande: data.statut_commande } : {}),
        },
      ],
      { session }
    );
    const commande = documents[0];

    if (commande.statut_commande === 'Confirmee') {
      await StockMouvement.create(mouvementsReservation(commande, req.user.id), { session, ordered: true });
    }

    return avecResteAPayer(commande);
  });
}

async function lister({ pays_id, statut, date_de, date_a, client_id } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (statut) filtre.statut_commande = statut;
  if (client_id) filtre.client_id = client_id;
  if (date_de || date_a) {
    filtre.createdAt = {};
    if (date_de) filtre.createdAt.$gte = new Date(date_de);
    if (date_a) filtre.createdAt.$lte = new Date(date_a);
  }
  return Commande.find(filtre).populate('client_id pays_id').sort({ createdAt: -1 });
}

async function obtenir(id) {
  const commande = await Commande.findById(id).populate('client_id pays_id campagne_id');
  if (!commande) throw ApiError.notFound('Commande introuvable');
  return avecResteAPayer(commande);
}

function avecResteAPayer(commande) {
  const obj = commande.toObject ? commande.toObject() : commande;
  const totalPaiements = sum(obj.paiements.filter((p) => !p.annule).map((p) => p.montant));
  obj.reste_a_payer = toDecimal(obj.total).minus(toDecimal(obj.reduction || 0)).minus(totalPaiements).toFixed(2);
  return obj;
}

async function modifier(id, data) {
  const { lignes, paiements, statut_commande, statut_fabrication, statut_livraison, total, ...champsModifiables } = data;
  const commande = await Commande.findByIdAndUpdate(id, champsModifiables, { new: true, runValidators: true });
  if (!commande) throw ApiError.notFound('Commande introuvable');
  return commande;
}

const TRANSITIONS_VALIDES = {
  Nouvelle: ['Confirmee', 'Annulee', 'Refusee'],
  Confirmee: ['Annulee'],
  Annulee: [],
  Refusee: [],
};

/**
 * Transition de statut_commande (section 6.1). Le passage à Confirmée réserve le
 * stock des lignes de la commande via une transaction multi-documents
 * (Commande + StockMouvement) — section 3.9 : "toute opération qui touche à la
 * fois une commande [et] un mouvement de stock [...] s'exécute dans une
 * transaction MongoDB multi-documents".
 */
async function changerStatutCommande(id, nouveauStatut, req) {
  const commande = await Commande.findById(id);
  if (!commande) throw ApiError.notFound('Commande introuvable');

  if (commande.statut_commande === nouveauStatut) return avecResteAPayer(commande);

  const autorises = TRANSITIONS_VALIDES[commande.statut_commande] || [];
  if (!autorises.includes(nouveauStatut)) {
    throw ApiError.conflict(
      `Transition invalide : ${commande.statut_commande} → ${nouveauStatut}`
    );
  }

  return withTransaction(async (session) => {
    if (nouveauStatut === 'Confirmee') {
      await StockMouvement.create(mouvementsReservation(commande, req.user.id), { session, ordered: true });
    }

    commande.statut_commande = nouveauStatut;
    await commande.save({ session });
    return avecResteAPayer(commande);
  });
}

/**
 * Transition de statut_fabrication (retour V0.1) : horodate le jalon atteint
 * et, lorsque la fabrication est marquée Terminée, fait automatiquement
 * progresser la livraison à "Recue_en_pays" — la réception des bijoux
 * terminés marque de facto leur arrivée en pays dans le flux réel de SANAA.
 * "Erreur" couvre un défaut constaté à la vérification des pièces reçues.
 */
async function changerStatutFabrication(id, nouveauStatut) {
  const commande = await Commande.findById(id);
  if (!commande) throw ApiError.notFound('Commande introuvable');
  if (commande.statut_commande !== 'Confirmee') {
    throw ApiError.conflict('La fabrication ne progresse que sur une commande Confirmée');
  }

  commande.statut_fabrication = nouveauStatut;
  if (nouveauStatut === 'Terminee') {
    commande.date_fabrication_terminee = new Date();
    if (commande.statut_livraison === 'A_expedier') {
      commande.statut_livraison = 'Recue_en_pays';
    }
  } else if (nouveauStatut === 'Erreur') {
    commande.date_fabrication_erreur = new Date();
  }

  await commande.save();
  return commande;
}

/**
 * Transition de statut_livraison (retour V0.1) : horodate le jalon atteint
 * (remise au livreur, livraison confirmée, ou retour/échec) pour que SANAA
 * sache "quand" chaque étape a eu lieu, pas seulement l'état courant.
 */
async function changerStatutLivraison(id, nouveauStatut) {
  const commande = await Commande.findById(id);
  if (!commande) throw ApiError.notFound('Commande introuvable');
  if (commande.statut_commande !== 'Confirmee') {
    throw ApiError.conflict('La livraison ne progresse que sur une commande Confirmée');
  }

  commande.statut_livraison = nouveauStatut;
  if (nouveauStatut === 'En_livraison') commande.date_debut_livraison = new Date();
  else if (nouveauStatut === 'Livree') commande.date_livraison = new Date();
  else if (nouveauStatut === 'Retour_echec') commande.date_retour_echec = new Date();

  await commande.save();
  return commande;
}

/**
 * Enregistrement d'un paiement — opérateur atomique $push (section 3.5, 6.2) pour
 * qu'un ajout concurrent de deux paiements sur la même commande ne s'écrase jamais.
 */
async function enregistrerPaiement(id, data, req) {
  const paiement = {
    moyen_paiement: data.moyen_paiement,
    type: data.type,
    montant: toDecimal128(data.montant),
    date_paiement: data.date_paiement || new Date(),
    reference: data.reference,
    saisi_par: req.user.id,
  };

  const commande = await Commande.findByIdAndUpdate(
    id,
    { $push: { paiements: paiement } },
    { new: true, runValidators: true }
  );
  if (!commande) throw ApiError.notFound('Commande introuvable');
  return avecResteAPayer(commande);
}

async function listerPaiements(id) {
  const commande = await Commande.findById(id);
  if (!commande) throw ApiError.notFound('Commande introuvable');
  return commande.paiements;
}

/**
 * Encaissements du jour (section 8 du cahier de cadrage, section 6.2) — agrège
 * tous les paiements enregistrés à une date donnée pour un pays, répartis par
 * moyen de paiement.
 */
async function encaissementsJour(paysId, date) {
  const jour = date ? new Date(date) : new Date();
  const debut = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate());
  const fin = new Date(debut.getTime() + 24 * 60 * 60 * 1000);

  const commandes = await Commande.find({
    pays_id: paysId,
    'paiements.date_paiement': { $gte: debut, $lt: fin },
  });

  const parMoyen = {};
  let total = toDecimal(0);
  const lignes = [];

  for (const commande of commandes) {
    for (const paiement of commande.paiements) {
      if (paiement.annule) continue;
      if (paiement.date_paiement < debut || paiement.date_paiement >= fin) continue;
      const montant = toDecimal(paiement.montant);
      parMoyen[paiement.moyen_paiement] = (parMoyen[paiement.moyen_paiement] || toDecimal(0)).plus(montant);
      total = total.plus(montant);
      lignes.push({
        commande_numero: commande.numero,
        commande_id: commande._id,
        moyen_paiement: paiement.moyen_paiement,
        type: paiement.type,
        montant: montant.toFixed(2),
        date_paiement: paiement.date_paiement,
      });
    }
  }

  return {
    date: debut,
    total: total.toFixed(2),
    par_moyen_paiement: Object.fromEntries(Object.entries(parMoyen).map(([k, v]) => [k, v.toFixed(2)])),
    paiements: lignes,
  };
}

module.exports = {
  creer,
  lister,
  obtenir,
  modifier,
  changerStatutCommande,
  changerStatutFabrication,
  changerStatutLivraison,
  enregistrerPaiement,
  listerPaiements,
  encaissementsJour,
  avecResteAPayer,
};
