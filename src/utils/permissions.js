// Référentiel des permissions granulaires module × action — section 4.2.
// Utilisé pour valider les tableaux `permissions` des rôles et pour documenter
// les permissions attendues sur chaque route (section 5).
const PERMISSIONS = {
  pays: ['voir', 'creer', 'modifier', 'supprimer'],
  utilisateurs: ['voir', 'creer', 'modifier', 'desactiver', 'attribuer_pays', 'supprimer'],
  catalogue: ['voir', 'creer', 'modifier', 'supprimer', 'desactiver', 'definir_prix_pays'],
  clients: ['voir', 'creer', 'modifier'],
  commandes: ['voir', 'creer', 'modifier', 'modifier_prix_manuellement', 'changer_statut', 'annuler', 'supprimer'],
  livraisons: ['voir', 'planifier', 'livrer'],
  paiements: ['voir', 'enregistrer', 'annuler'],
  stock: ['voir', 'ajuster', 'transferer'],
  fournisseurs: ['voir', 'gerer'],
  depenses: ['voir', 'creer', 'valider', 'supprimer'],
  marketing: ['voir', 'gerer'],
  exports: ['generer', 'telecharger', 'regenerer'],
  dashboard: ['voir_pays', 'voir_global', 'comparer_pays'],
  journal_activite: ['voir'],
  // Tableau « À traiter aujourd'hui » : réservé au Super administrateur pour
  // l'instant (retour du 09/10/2026).
  a_traiter: ['voir'],
  parametres: ['gerer_taux_change', 'gerer_moyens_paiement'],
};

const ALL_PERMISSIONS = Object.entries(PERMISSIONS).flatMap(([module, actions]) =>
  actions.map((action) => `${module}:${action}`)
);

const ROLES_PAR_DEFAUT = [
  {
    nom: 'Super administrateur',
    portee: 'global',
    permissions: ALL_PERMISSIONS,
  },
  {
    nom: 'Administrateur pays',
    portee: 'pays',
    permissions: ALL_PERMISSIONS.filter(
      (p) =>
        !['pays:creer', 'pays:supprimer', 'catalogue:supprimer', 'parametres:gerer_taux_change', 'a_traiter:voir'].includes(p)
    ),
  },
  {
    nom: 'Gestionnaire',
    portee: 'pays',
    permissions: [
      'commandes:voir', 'commandes:creer', 'commandes:modifier', 'commandes:changer_statut',
      'paiements:voir', 'paiements:enregistrer',
      'livraisons:voir', 'livraisons:planifier', 'livraisons:livrer',
      'clients:voir', 'clients:creer', 'clients:modifier',
      'catalogue:voir', 'stock:voir', 'stock:ajuster',
      'exports:generer', 'exports:telecharger',
    ],
  },
  {
    nom: 'Comptable',
    portee: 'pays',
    permissions: [
      'paiements:voir', 'paiements:enregistrer', 'paiements:annuler',
      'depenses:voir', 'depenses:creer', 'depenses:valider', 'depenses:supprimer',
      'exports:generer', 'exports:telecharger', 'exports:regenerer',
      'dashboard:voir_pays', 'commandes:voir', 'clients:voir', 'livraisons:voir',
    ],
  },
  {
    nom: 'Marketing',
    portee: 'pays',
    permissions: ['marketing:voir', 'marketing:gerer', 'dashboard:voir_pays'],
  },
  {
    // Rôle dédié (retour V0.1, 26/09/2026) : accès uniquement à ses livraisons
    // du jour, écran mobile dédié hors AppShell (voir router frontend) — jamais
    // les écrans commandes/dashboard/etc. Ne peut ni planifier ni retirer une
    // livraison (ça reste au gestionnaire), seulement marquer livrée/échec.
    nom: 'Livreur',
    portee: 'pays',
    permissions: ['livraisons:voir', 'livraisons:livrer'],
  },
];

module.exports = { PERMISSIONS, ALL_PERMISSIONS, ROLES_PAR_DEFAUT };
