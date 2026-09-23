const mongoose = require('mongoose');
const Commande = require('../models/Commande');
const Produit = require('../models/Produit');
const Pays = require('../models/Pays');
const StockMouvement = require('../models/StockMouvement');
const ApiError = require('../utils/ApiError');
const { sum, toDecimal, toDecimal128, multiply } = require('../utils/money');
const withTransaction = require('../utils/withTransaction');
const Client = require('../models/Client');
const JournalActivite = require('../models/JournalActivite');
const { construireEvenement, construireEvenementClient } = require('../utils/commandeHistorique');
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

  if (data.avance && toDecimal(data.avance.montant || 0).gt(0) && !String(data.avance.moyen_paiement || '').trim()) {
    throw ApiError.badRequest("Indiquez le moyen de paiement de l'avance (Wave, Orange Money, Espèces…)");
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

const echapperRegex = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Liste des commandes. `q` cherche dans le numéro, le nom/téléphone du client et
 * les prénoms gravés (pour retrouver une commande déjà saisie) ; `cree_par`
 * filtre sur l'utilisateur qui a saisi la commande.
 */
async function lister({
  pays_id, statut, statut_fabrication, statut_livraison, date_de, date_a, client_id, q, cree_par, limite,
} = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (statut) filtre.statut_commande = statut;
  if (statut_fabrication) filtre.statut_fabrication = statut_fabrication;
  if (statut_livraison) filtre.statut_livraison = statut_livraison;
  if (client_id) filtre.client_id = client_id;
  if (cree_par) filtre.cree_par = cree_par;
  if (date_de || date_a) {
    filtre.createdAt = {};
    if (date_de) filtre.createdAt.$gte = new Date(date_de);
    if (date_a) {
      const fin = new Date(date_a);
      // Une date seule (yyyy-MM-dd) désigne la journée entière : la fin est incluse.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(date_a))) fin.setUTCHours(23, 59, 59, 999);
      filtre.createdAt.$lte = fin;
    }
  }

  const recherche = q && String(q).trim();
  if (recherche) {
    const regex = new RegExp(echapperRegex(recherche), 'i');
    const clients = await Client.find({
      ...(pays_id ? { pays_id } : {}),
      $or: [{ nom: regex }, { telephone_whatsapp: regex }],
    }).select('_id');
    filtre.$or = [
      { numero: regex },
      { client_id: { $in: clients.map((c) => c._id) } },
      { 'lignes.personnalisation.texte': regex },
    ];
  }

  const requete = Commande.find(filtre).populate('client_id pays_id').populate('cree_par', 'nom').sort({ createdAt: -1 });
  const max = Number(limite);
  return max > 0 ? requete.limit(max) : requete;
}

/**
 * Utilisateurs ayant saisi au moins une commande (dans le périmètre visible),
 * pour alimenter le filtre « Saisi par » sans exiger la permission utilisateurs:voir.
 */
async function createurs({ pays_id } = {}) {
  const Utilisateur = require('../models/Utilisateur');
  const match = { cree_par: { $ne: null } };
  if (pays_id) match.pays_id = new mongoose.Types.ObjectId(pays_id);
  const groupes = await Commande.aggregate([{ $match: match }, { $group: { _id: '$cree_par', total: { $sum: 1 } } }]);
  const utilisateurs = await Utilisateur.find({ _id: { $in: groupes.map((g) => g._id) } }).select('nom');
  const totaux = new Map(groupes.map((g) => [String(g._id), g.total]));
  return utilisateurs
    .map((u) => ({ _id: u._id, nom: u.nom, total: totaux.get(String(u._id)) }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

async function obtenir(id) {
  const commande = await Commande.findById(id).populate('client_id pays_id campagne_id')
    .populate('cree_par', 'nom')
    .populate('lignes.produit_id', 'nom nom_zh');
  if (!commande) throw ApiError.notFound('Commande introuvable');
  return avecResteAPayer(commande);
}

function avecResteAPayer(commande) {
  const obj = commande.toObject ? commande.toObject() : commande;
  const totalPaiements = sum(obj.paiements.filter((p) => !p.annule).map((p) => p.montant));
  obj.reste_a_payer = toDecimal(obj.total).minus(toDecimal(obj.reduction || 0)).minus(totalPaiements).toFixed(2);
  return obj;
}

/**
 * Ajuste la réservation de stock d'une commande Confirmée après une modification
 * de ses lignes : le journal de stock étant append-only, on n'édite jamais les
 * mouvements existants — on ajoute la différence (quantité en plus = nouvelle
 * réservation, quantité en moins = libération).
 */
function mouvementsAjustement(commande, anciennesLignes, utilisateurId, motif) {
  const cle = (l) => `${l.produit_id}|${l.variante_id}`;
  const deltas = new Map();
  for (const l of anciennesLignes) {
    deltas.set(cle(l), { produit_id: l.produit_id, variante_id: l.variante_id, delta: -l.quantite });
  }
  for (const l of commande.lignes) {
    const entree = deltas.get(cle(l)) || { produit_id: l.produit_id, variante_id: l.variante_id, delta: 0 };
    entree.delta += l.quantite;
    deltas.set(cle(l), entree);
  }
  return [...deltas.values()]
    .filter((d) => d.delta !== 0)
    .map((d) => ({
      produit_id: d.produit_id,
      variante_id: d.variante_id,
      pays_id: commande.pays_id,
      type: 'reservation',
      quantite: -d.delta,
      reference_commande_id: commande._id,
      commentaire: `${motif} ${commande.numero}`,
      saisi_par: utilisateurId,
    }));
}

/**
 * Reconstruit les lignes après édition : une ligne conservée (même _id, même
 * variante) garde son prix figé à la création ; une ligne nouvelle ou dont le
 * produit/la variante a changé reprend le prix catalogue actif du pays. Aucun
 * prix n'est jamais saisi à la main (les écarts se traduisent par la réduction).
 */
async function reconstruireLignes(lignesInput, commande) {
  const existantes = new Map(commande.lignes.map((l) => [String(l._id), l]));
  const lignes = [];
  for (const input of lignesInput) {
    const existante = input._id ? existantes.get(String(input._id)) : null;
    const memeVariante =
      existante &&
      String(existante.produit_id) === String(input.produit_id) &&
      String(existante.variante_id) === String(input.variante_id);

    if (memeVariante) {
      const quantite = input.quantite || 1;
      const prix = toDecimal(existante.prix_unitaire_applique);
      lignes.push({
        _id: existante._id,
        produit_id: existante.produit_id,
        variante_id: existante.variante_id,
        couleur_choisie: input.couleur_choisie || existante.couleur_choisie,
        detail_variante: input.detail_variante || undefined,
        personnalisation: (input.personnalisation || []).map((p, i) => ({ ...p, position: i })),
        quantite,
        prix_unitaire_applique: existante.prix_unitaire_applique,
        devise_id: existante.devise_id,
        sous_total: toDecimal128(multiply(prix, quantite)),
      });
    } else {
      const ligne = await construireLigne(input, commande.pays_id);
      ligne.personnalisation = ligne.personnalisation.map((p, i) => ({ ...p, position: i }));
      lignes.push(ligne);
    }
  }
  return lignes;
}

/**
 * Modification des détails d'une commande depuis sa fiche : client (nom, adresse,
 * téléphone), canal, commentaires, réduction et lignes (produit, variante,
 * quantité, précision, personnalisation). Statuts et paiements gardent leurs
 * flux dédiés. Toute modification est tracée par le journal d'activité.
 */
async function modifier(id, data, req) {
  const commande = await Commande.findById(id);
  if (!commande) throw ApiError.notFound('Commande introuvable');

  const anciennesLignes = commande.lignes.map((l) => ({
    produit_id: l.produit_id,
    variante_id: l.variante_id,
    quantite: l.quantite,
  }));
  let lignesModifiees = false;

  if (data.lignes !== undefined) {
    if (['Annulee', 'Refusee'].includes(commande.statut_commande)) {
      throw ApiError.conflict('Les produits d\'une commande annulée ou refusée ne peuvent plus être modifiés');
    }
    if (!Array.isArray(data.lignes) || data.lignes.length === 0) {
      throw ApiError.badRequest('Une commande doit contenir au moins une ligne');
    }
    commande.lignes = await reconstruireLignes(data.lignes, commande);
    commande.total = toDecimal128(sum(commande.lignes.map((l) => l.sous_total)));
    lignesModifiees = true;
  }

  if (data.reduction !== undefined) {
    const reduction = toDecimal(data.reduction || 0);
    if (reduction.lt(0)) throw ApiError.badRequest('La réduction ne peut pas être négative');
    commande.reduction = toDecimal128(reduction);
  }
  if (toDecimal(commande.reduction || 0).gt(toDecimal(commande.total))) {
    throw ApiError.badRequest('La réduction ne peut pas dépasser le total de la commande');
  }

  if (data.canal_vente !== undefined) commande.canal_vente = data.canal_vente;
  if (data.commentaires !== undefined) commande.commentaires = data.commentaires;

  if (data.client) {
    const { nom, adresse, telephone_whatsapp } = data.client;
    const actuel = await Client.findById(commande.client_id);
    const nouveauTel = telephone_whatsapp ? String(telephone_whatsapp).trim() : '';
    if (nouveauTel && (!actuel || nouveauTel !== (actuel.telephone_whatsapp || ''))) {
      // Autre numéro = autre client : retrouvé (ou créé) par téléphone dans le pays.
      const client = await clientService.trouverOuCreer({
        pays_id: commande.pays_id,
        telephone_whatsapp: nouveauTel,
        nom,
        adresse,
      });
      commande.client_id = client._id;
    } else if (actuel) {
      if (nom !== undefined) actuel.nom = nom;
      if (adresse !== undefined) actuel.adresse = adresse;
      if (actuel.isModified()) await actuel.save();
    }
  }

  await withTransaction(async (session) => {
    if (lignesModifiees && commande.statut_commande === 'Confirmee') {
      const mouvements = mouvementsAjustement(
        commande,
        anciennesLignes,
        req && req.user && req.user.id,
        'Modification de la commande'
      );
      if (mouvements.length) await StockMouvement.create(mouvements, { session, ordered: true });
    }
    await commande.save({ session });
  });

  return obtenir(id);
}

/**
 * Suppression définitive d'une commande, réservée à `commandes:supprimer`.
 * - le stock réservé est libéré par des mouvements compensatoires (journal de
 *   stock append-only, jamais de suppression de mouvements) ;
 * - une commande avec paiements enregistrés exige une confirmation explicite ;
 * - l'instantané complet de la commande est conservé dans le journal
 *   d'activité (entrée « suppression » avec l'auteur), car la suppression
 *   d'instance n'est pas interceptée par activityLogPlugin.
 */
async function supprimer(id, { confirmerPaiements = false } = {}, req) {
  const commande = await Commande.findById(id);
  if (!commande) throw ApiError.notFound('Commande introuvable');

  const paiementsActifs = commande.paiements.filter((p) => !p.annule);
  if (paiementsActifs.length > 0 && !confirmerPaiements) {
    const montantTotal = sum(paiementsActifs.map((p) => p.montant)).toFixed(2);
    throw ApiError.conflict(
      `Cette commande contient ${paiementsActifs.length} paiement(s) (${montantTotal}) : confirmez pour la supprimer avec ses paiements`
    );
  }

  const reserves = await StockMouvement.aggregate([
    { $match: { reference_commande_id: commande._id, type: 'reservation' } },
    {
      $group: {
        _id: { produit_id: '$produit_id', variante_id: '$variante_id' },
        net: { $sum: '$quantite' },
      },
    },
  ]);

  await withTransaction(async (session) => {
    const liberations = reserves
      .filter((r) => r.net !== 0)
      .map((r) => ({
        produit_id: r._id.produit_id,
        variante_id: r._id.variante_id,
        pays_id: commande.pays_id,
        type: 'reservation',
        quantite: -r.net,
        reference_commande_id: commande._id,
        commentaire: `Libération suite à la suppression de la commande ${commande.numero}`,
        saisi_par: req && req.user && req.user.id,
      }));
    if (liberations.length) await StockMouvement.create(liberations, { session, ordered: true });

    // Écrit avant la suppression et dans la même transaction : pas de suppression sans trace.
    await JournalActivite.create(
      [
        {
          utilisateur_id: req && req.user && req.user.id,
          action: 'suppression',
          entite: 'Commande',
          entite_id: commande._id,
          avant: commande.toObject(),
          pays_id: commande.pays_id,
          date: new Date(),
        },
      ],
      { session }
    );
    await commande.deleteOne({ session });
  });

  return { _id: commande._id, numero: commande.numero };
}

/**
 * « Qui a fait quoi, quand » sur une commande : évènements du journal d'activité
 * (création, modifications, statuts, paiements) avec l'auteur et le détail des
 * champs changés, du plus récent au plus ancien.
 */
async function historique(id) {
  const commande = await Commande.findById(id).select('numero cree_par createdAt pays_id client_id').populate('cree_par', 'nom');
  if (!commande) throw ApiError.notFound('Commande introuvable');
  const commandeClientId = commande.client_id;

  const entrees = await JournalActivite.find({ entite: 'Commande', entite_id: commande._id })
    .populate('utilisateur_id', 'nom')
    .sort({ date: -1 })
    .lean();

  // Résolution unique des libellés référencés par les instantanés (produits, clients).
  const produitIds = new Set();
  const clientIds = new Set([String(commandeClientId)]);
  for (const e of entrees) {
    for (const snap of [e.avant, e.apres]) {
      if (!snap) continue;
      if (snap.client_id) clientIds.add(String(snap.client_id));
      (snap.lignes || []).forEach((l) => l.produit_id && produitIds.add(String(l.produit_id)));
    }
  }
  const [produits, clients] = await Promise.all([
    Produit.find({ _id: { $in: [...produitIds] } }).select('nom').lean(),
    Client.find({ _id: { $in: [...clientIds] } }).select('nom telephone_whatsapp').lean(),
  ]);
  const contexte = {
    produitsParId: new Map(produits.map((p) => [String(p._id), p])),
    clientsParId: new Map(clients.map((c) => [String(c._id), c])),
  };

  const evenements = entrees.map((e) => construireEvenement(e, contexte)).filter(Boolean);

  // Les informations client (nom, adresse, téléphone) vivent sur le client : leurs
  // modifications faites par un utilisateur sont rattachées à la trace de la commande.
  const entreesClient = await JournalActivite.find({
    entite: 'Client',
    entite_id: { $in: [...clientIds] },
    action: 'modification',
    utilisateur_id: { $ne: null },
  })
    .populate('utilisateur_id', 'nom')
    .sort({ date: -1 })
    .lean();
  entreesClient.forEach((e) => {
    const evenement = construireEvenementClient(e);
    if (evenement) evenements.push(evenement);
  });
  evenements.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Commandes antérieures au journal : on retombe sur cree_par/createdAt.
  const creation = evenements.find((e) => e.action === 'creation');
  const createur = creation && creation.utilisateur
    ? creation.utilisateur
    : commande.cree_par
      ? { _id: commande.cree_par._id, nom: commande.cree_par.nom }
      : null;
  if (!creation) {
    evenements.push({
      _id: `creation-${commande._id}`,
      action: 'creation',
      date: commande.createdAt,
      utilisateur: createur,
      resume: 'Commande créée',
      changements: [],
    });
  } else if (!creation.utilisateur && createur) {
    creation.utilisateur = createur;
  }

  const derniere = evenements.find((e) => e.action === 'modification');
  return {
    cree_par: createur,
    cree_le: creation ? creation.date : commande.createdAt,
    derniere_modification: derniere ? { utilisateur: derniere.utilisateur, date: derniere.date } : null,
    evenements,
  };
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

const STATUTS_FABRICATION = ['A_produire', 'En_fabrication', 'Terminee', 'Erreur'];
const STATUTS_LIVRAISON = ['A_expedier', 'Recue_en_pays', 'En_livraison', 'Livree', 'Retour_echec'];

/**
 * Modification groupée du statut de fabrication et/ou de livraison sur plusieurs
 * commandes à la fois (écran liste des commandes, sélection multiple). Seuls ces
 * deux statuts sont modifiables en lot — jamais le statut de commande, les lignes
 * ou les paiements, qui restent un changement par commande. Chaque commande passe
 * par les mêmes fonctions que le changement individuel (mêmes horodatages, mêmes
 * règles, même trace dans le journal d'activité) ; une commande en échec (ex. pas
 * encore Confirmée) n'empêche pas les autres d'être traitées.
 */
async function modifierStatutsEnLot({ ids, statut_fabrication, statut_livraison } = {}) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw ApiError.badRequest('Aucune commande sélectionnée');
  }
  if (!statut_fabrication && !statut_livraison) {
    throw ApiError.badRequest('Choisissez un statut de fabrication et/ou de livraison à appliquer');
  }
  if (statut_fabrication && !STATUTS_FABRICATION.includes(statut_fabrication)) {
    throw ApiError.badRequest('Statut de fabrication invalide');
  }
  if (statut_livraison && !STATUTS_LIVRAISON.includes(statut_livraison)) {
    throw ApiError.badRequest('Statut de livraison invalide');
  }

  const reussies = [];
  const echecs = [];
  for (const id of ids) {
    try {
      if (statut_fabrication) await changerStatutFabrication(id, statut_fabrication);
      if (statut_livraison) await changerStatutLivraison(id, statut_livraison);
      reussies.push(id);
    } catch (err) {
      echecs.push({ id, message: err.message || 'Échec' });
    }
  }
  return { reussies: reussies.length, echecs };
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
  createurs,
  modifier,
  supprimer,
  historique,
  changerStatutCommande,
  changerStatutFabrication,
  changerStatutLivraison,
  modifierStatutsEnLot,
  enregistrerPaiement,
  listerPaiements,
  encaissementsJour,
  avecResteAPayer,
};
