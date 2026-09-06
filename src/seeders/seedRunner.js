const logger = require('../utils/logger');
const { ROLES_PAR_DEFAUT } = require('../utils/permissions');
const { construireMoyensPaiementStandard } = require('../utils/moyensPaiementStandard');

const Devise = require('../models/Devise');
const Pays = require('../models/Pays');
const Role = require('../models/Role');
const Utilisateur = require('../models/Utilisateur');
const CategorieDepense = require('../models/CategorieDepense');
const Categorie = require('../models/Categorie');

// Devises courantes en Afrique de l'Ouest/Centrale et au-delà (retour V0.1 :
// SANAA veut pouvoir facturer/comparer au-delà des trois pays de lancement)
// + les deux devises de référence internationales.
async function seedDevises() {
  const devises = [
    { code: 'XOF', nom: 'Franc CFA (UEMOA)', symbole: 'F CFA', decimales: 0 },
    { code: 'XAF', nom: 'Franc CFA (CEMAC)', symbole: 'FCFA', decimales: 0 },
    { code: 'CDF', nom: 'Franc congolais', symbole: 'FC', decimales: 0 },
    { code: 'NGN', nom: 'Naira nigérian', symbole: '₦', decimales: 2 },
    { code: 'GHS', nom: 'Cedi ghanéen', symbole: 'GH₵', decimales: 2 },
    { code: 'GNF', nom: 'Franc guinéen', symbole: 'FG', decimales: 0 },
    { code: 'MAD', nom: 'Dirham marocain', symbole: 'DH', decimales: 2 },
    { code: 'TND', nom: 'Dinar tunisien', symbole: 'DT', decimales: 3 },
    { code: 'EGP', nom: 'Livre égyptienne', symbole: 'E£', decimales: 2 },
    { code: 'KES', nom: 'Shilling kényan', symbole: 'KSh', decimales: 2 },
    { code: 'ZAR', nom: 'Rand sud-africain', symbole: 'R', decimales: 2 },
    { code: 'USD', nom: 'Dollar américain', symbole: '$', decimales: 2 },
    { code: 'EUR', nom: 'Euro', symbole: '€', decimales: 2 },
  ];
  const resultats = {};
  for (const d of devises) {
    resultats[d.code] = await Devise.findOneAndUpdate({ code: d.code }, d, { upsert: true, new: true });
  }
  return resultats;
}

// Moyens de paiement standardisés (retour V0.1) : les 4 mêmes options pour
// tout pays, plus de configuration libre à la création — voir
// utils/moyensPaiementStandard.js et pays.service.js.
async function seedPays(devises) {
  const pays = [
    {
      code: 'CI',
      nom: "Côte d'Ivoire",
      devise_locale_id: devises.XOF._id,
      est_pays_historique_sans_suffixe: true,
      moyens_paiement: construireMoyensPaiementStandard(),
    },
    {
      code: 'BN',
      nom: 'Bénin',
      devise_locale_id: devises.XOF._id,
      moyens_paiement: construireMoyensPaiementStandard(),
    },
    {
      code: 'RDC',
      nom: 'République démocratique du Congo',
      devise_locale_id: devises.CDF._id,
      moyens_paiement: construireMoyensPaiementStandard(),
    },
  ];
  const resultats = [];
  for (const p of pays) {
    resultats.push(await Pays.findOneAndUpdate({ code: p.code }, p, { upsert: true, new: true }));
  }
  return resultats;
}

async function seedRoles() {
  const resultats = {};
  for (const r of ROLES_PAR_DEFAUT) {
    resultats[r.nom] = await Role.findOneAndUpdate({ nom: r.nom }, r, { upsert: true, new: true });
  }
  return resultats;
}

async function seedSuperAdmin(roles) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@sanaa.com';
  const motDePasse = process.env.SEED_ADMIN_PASSWORD || 'Sanaa2026!';
  const existant = await Utilisateur.findOne({ email });
  if (existant) {
    logger.info(`Compte super administrateur déjà présent : ${email}`);
    return existant;
  }
  const mot_de_passe_hash = await Utilisateur.hasherMotDePasse(motDePasse);
  const utilisateur = await Utilisateur.create({
    nom: 'Super Administrateur SANAA',
    email,
    mot_de_passe_hash,
    role_id: roles['Super administrateur']._id,
    pays_autorises: [],
    actif: true,
  });
  logger.info(`Compte super administrateur créé : ${email} / ${motDePasse} (à changer après la première connexion)`);
  return utilisateur;
}

// "Marketing" scindé en canaux distincts (retour V0.1) : SANAA veut comparer
// la dépense publicitaire Facebook vs TikTok vs le reste.
async function seedCategoriesDepenses() {
  const noms = [
    'Publicité Facebook',
    'Publicité TikTok',
    'Autres canaux de publicité',
    'Production',
    'Packaging',
    'Logistique',
    'Salaires',
    'Divers',
  ];
  for (const nom of noms) {
    await CategorieDepense.findOneAndUpdate({ nom }, { nom }, { upsert: true });
  }
}

// Les 5 collections de départ demandées par SANAA — la liste reste modifiable
// ensuite depuis l'écran Catalogue global (retour V0.1).
async function seedCategoriesProduits() {
  const noms = ['Colliers', 'Bracelets', 'Bagues', "Boucles d'oreilles", 'Porte-clés'];
  for (const nom of noms) {
    await Categorie.findOneAndUpdate({ nom }, { nom }, { upsert: true });
  }
}

/**
 * Retour V0.1 : SANAA a explicitement demandé une base vidée de toute donnée
 * de démonstration ("vide la base de donnée sauf le user") avant la mise en
 * ligne. Seuls les rôles et le compte super administrateur sont donc créés par
 * défaut — indispensables pour pouvoir se connecter — le reste (devises, pays,
 * collections, catégories de dépenses) se configure ensuite depuis l'app elle-
 * même (écrans Pays / Paramètres / Catalogue / Dépenses), qui savent déjà tout
 * créer. Les données de référence/démonstration restent disponibles à la
 * demande via SEED_DEMO_DATA=true (utile en développement local).
 */
async function seedRunner() {
  const roles = await seedRoles();
  await seedSuperAdmin(roles);

  if (process.env.SEED_DEMO_DATA === 'true') {
    const devises = await seedDevises();
    const pays = await seedPays(devises);
    await seedCategoriesDepenses();
    await seedCategoriesProduits();
    logger.info('Seed terminé (avec données de démonstration).');
    return { devises, pays, roles };
  }

  logger.info('Seed terminé (rôles + compte administrateur uniquement — SEED_DEMO_DATA=true pour les données de démonstration).');
  return { roles };
}

module.exports = seedRunner;
