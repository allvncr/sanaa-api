/**
 * Transforme les entrées brutes du journal d'activité d'une commande (instantanés
 * avant/après complets) en évènements lisibles : "qui a fait quoi, quand".
 * Fonctions pures — les libellés produits/clients sont passés en paramètre.
 */

const LIBELLES_STATUT = {
  statut_commande: {
    Nouvelle: 'Nouvelle', Confirmee: 'Confirmée', Annulee: 'Annulée', Refusee: 'Refusée',
  },
  statut_fabrication: {
    A_produire: 'À produire', En_fabrication: 'En fabrication', Terminee: 'Terminée', Erreur: 'Erreur',
  },
  statut_livraison: {
    A_expedier: 'À expédier', Recue_en_pays: 'Reçue en pays', En_livraison: 'En livraison',
    Livree: 'Livrée', Retour_echec: 'Retour / échec',
  },
};

const LIBELLES_CHAMP = {
  statut_commande: 'Statut de la commande',
  statut_fabrication: 'Fabrication',
  statut_livraison: 'Livraison',
  total: 'Total',
  reduction: 'Réduction',
  commentaires: 'Commentaires',
  canal_vente: "Canal d'acquisition",
};

const str = (v) => (v === undefined || v === null ? '' : String(v));
const id = (v) => (v === undefined || v === null ? '' : String(v));

function montant(v) {
  const n = Number(str(v) || 0);
  if (Number.isNaN(n)) return str(v);
  const [entier, dec] = n.toFixed(2).split('.');
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return dec === '00' ? groupe : `${groupe},${dec}`;
}

function texteOuTiret(v) {
  const s = str(v).trim();
  return s || '—';
}

function personnalisation(ligne) {
  return (ligne.personnalisation || [])
    .map((p) => str(p.texte).trim())
    .filter(Boolean)
    .join(' / ');
}

function decrireLigne(ligne, produitsParId) {
  const produit = produitsParId.get(id(ligne.produit_id));
  const nom = produit ? produit.nom : 'Produit';
  const parts = [nom];
  if (ligne.couleur_choisie) parts.push(ligne.couleur_choisie);
  if (ligne.detail_variante) parts.push(`(${ligne.detail_variante})`);
  let texte = `${parts.join(' ')} ×${ligne.quantite}`;
  const perso = personnalisation(ligne);
  if (perso) texte += ` — « ${perso} »`;
  return texte;
}

function diffLignes(avant = [], apres = [], produitsParId) {
  const changements = [];
  const avantParId = new Map(avant.map((l) => [id(l._id), l]));
  const apresParId = new Map(apres.map((l) => [id(l._id), l]));

  for (const l of apres) {
    if (!avantParId.has(id(l._id))) changements.push(`Ligne ajoutée : ${decrireLigne(l, produitsParId)}`);
  }
  for (const l of avant) {
    if (!apresParId.has(id(l._id))) changements.push(`Ligne retirée : ${decrireLigne(l, produitsParId)}`);
  }
  for (const l of apres) {
    const ancienne = avantParId.get(id(l._id));
    if (!ancienne) continue;
    const details = [];
    if (Number(ancienne.quantite) !== Number(l.quantite)) details.push(`quantité ${ancienne.quantite} → ${l.quantite}`);
    if (str(ancienne.couleur_choisie) !== str(l.couleur_choisie)) {
      details.push(`couleur « ${texteOuTiret(ancienne.couleur_choisie)} » → « ${texteOuTiret(l.couleur_choisie)} »`);
    }
    if (str(ancienne.detail_variante) !== str(l.detail_variante)) {
      details.push(`précision « ${texteOuTiret(ancienne.detail_variante)} » → « ${texteOuTiret(l.detail_variante)} »`);
    }
    if (personnalisation(ancienne) !== personnalisation(l)) {
      details.push(`personnalisation « ${texteOuTiret(personnalisation(ancienne))} » → « ${texteOuTiret(personnalisation(l))} »`);
    }
    if (details.length) {
      changements.push(`Ligne modifiée (${decrireLigne(ancienne, produitsParId).split(' — ')[0]}) : ${details.join(', ')}`);
    }
  }
  return changements;
}

function diffPaiements(avant = [], apres = []) {
  const changements = [];
  const avantParId = new Map(avant.map((p) => [id(p._id), p]));
  for (const p of apres) {
    const ancien = avantParId.get(id(p._id));
    if (!ancien) {
      changements.push(`Paiement enregistré : ${montant(p.montant)} (${p.moyen_paiement}${p.type === 'avance' ? ', avance' : ''})`);
    } else if (!ancien.annule && p.annule) {
      changements.push(`Paiement annulé : ${montant(p.montant)} (${p.moyen_paiement})`);
    }
  }
  return changements;
}

function valeurChamp(champ, valeur) {
  if (LIBELLES_STATUT[champ]) return LIBELLES_STATUT[champ][valeur] || texteOuTiret(valeur);
  if (champ === 'total' || champ === 'reduction') return montant(valeur);
  return texteOuTiret(valeur);
}

/**
 * Liste de changements {champ, libelle, avant, apres, detail} entre deux
 * instantanés d'une commande (vue "modification").
 */
function diffCommande(avant, apres, { produitsParId, clientsParId }) {
  const changements = [];

  for (const champ of ['statut_commande', 'statut_fabrication', 'statut_livraison', 'canal_vente', 'reduction', 'commentaires']) {
    const a = champ === 'reduction' ? Number(str(avant[champ]) || 0) : str(avant[champ]);
    const b = champ === 'reduction' ? Number(str(apres[champ]) || 0) : str(apres[champ]);
    if (a !== b) {
      changements.push({
        champ,
        libelle: LIBELLES_CHAMP[champ],
        avant: valeurChamp(champ, avant[champ]),
        apres: valeurChamp(champ, apres[champ]),
      });
    }
  }

  if (id(avant.client_id) !== id(apres.client_id)) {
    const nom = (cid) => {
      const c = clientsParId.get(id(cid));
      return c ? c.nom || c.telephone_whatsapp || '—' : '—';
    };
    changements.push({ champ: 'client_id', libelle: 'Client', avant: nom(avant.client_id), apres: nom(apres.client_id) });
  }

  const lignes = diffLignes(avant.lignes, apres.lignes, produitsParId);
  if (lignes.length) changements.push({ champ: 'lignes', libelle: 'Produits', detail: lignes });

  // Le total est une conséquence des lignes/réduction : affiché en dernier.
  if (Number(str(avant.total) || 0) !== Number(str(apres.total) || 0)) {
    changements.push({ champ: 'total', libelle: LIBELLES_CHAMP.total, avant: montant(avant.total), apres: montant(apres.total) });
  }

  const paiements = diffPaiements(avant.paiements, apres.paiements);
  if (paiements.length) changements.push({ champ: 'paiements', libelle: 'Paiements', detail: paiements });

  return changements;
}

/**
 * Évènement présentable pour une entrée du journal ; null si la modification
 * n'a rien de visible (ex. simple mise à jour d'horodatage).
 */
function construireEvenement(entree, contexte) {
  const utilisateur = entree.utilisateur_id
    ? { _id: entree.utilisateur_id._id || entree.utilisateur_id, nom: entree.utilisateur_id.nom || null }
    : null;
  const base = { _id: entree._id, action: entree.action, date: entree.date, utilisateur };

  if (entree.action === 'creation') {
    const apres = entree.apres || {};
    return {
      ...base,
      resume: 'Commande créée',
      changements: [
        {
          champ: 'lignes',
          libelle: 'Produits',
          detail: (apres.lignes || []).map((l) => decrireLigne(l, contexte.produitsParId)),
        },
        { champ: 'total', libelle: LIBELLES_CHAMP.total, avant: null, apres: montant(apres.total) },
      ],
    };
  }

  if (entree.action === 'suppression') {
    return { ...base, resume: 'Commande supprimée', changements: [] };
  }

  const changements = diffCommande(entree.avant || {}, entree.apres || {}, contexte);
  if (changements.length === 0) return null;

  const champs = changements.map((c) => c.champ);
  let resume = 'Commande modifiée';
  if (changements.every((c) => c.champ.startsWith('statut_'))) resume = 'Changement de statut';
  else if (champs.length === 1 && champs[0] === 'paiements') resume = 'Paiement';
  return { ...base, resume, changements };
}

const LIBELLES_CLIENT = {
  nom: 'Nom du client',
  telephone_whatsapp: 'Téléphone',
  adresse: 'Adresse',
  notes: 'Notes client',
};

/**
 * Évènement issu du journal du CLIENT de la commande (nom, adresse, téléphone
 * édités depuis la fiche commande) ; null si aucun de ces champs n'a changé.
 */
function construireEvenementClient(entree) {
  if (entree.action !== 'modification') return null;
  const avant = entree.avant || {};
  const apres = entree.apres || {};
  const changements = Object.keys(LIBELLES_CLIENT)
    .filter((champ) => str(avant[champ]) !== str(apres[champ]))
    .map((champ) => ({
      champ,
      libelle: LIBELLES_CLIENT[champ],
      avant: texteOuTiret(avant[champ]),
      apres: texteOuTiret(apres[champ]),
    }));
  if (changements.length === 0) return null;
  const utilisateur = entree.utilisateur_id
    ? { _id: entree.utilisateur_id._id || entree.utilisateur_id, nom: entree.utilisateur_id.nom || null }
    : null;
  return { _id: entree._id, action: 'modification', date: entree.date, utilisateur, resume: 'Informations client modifiées', changements };
}

module.exports = { construireEvenement, construireEvenementClient, diffCommande, montant };
