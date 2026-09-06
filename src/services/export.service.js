const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Commande = require('../models/Commande');
const Produit = require('../models/Produit');
const Pays = require('../models/Pays');
const ExportModel = require('../models/Export');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');
const {
  buildExportFileName,
  buildUsineFileName,
  buildExportSousDossier,
} = require('../utils/fileNaming');
const { sum, toDecimal } = require('../utils/money');

// Reproduit la mise en forme du classeur SANAA actuel (retour V0.1) : police
// Microsoft YaHei taille 14 dans tout le fichier, en-têtes en gras centrées
// avec retour à la ligne — voir les fichiers d'exemple fournis par SANAA.
const POLICE_CLASSEUR = { name: 'Microsoft YaHei', size: 14, color: { argb: 'FF000000' } };
const STYLE_ENTETE = {
  font: { ...POLICE_CLASSEUR, bold: true },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
};

// Colonnes de spécification produit, communes aux exports usine ET interne
// (l'usine ne travaillant qu'en chinois) — ordre et intitulés reproduits à
// l'identique du classeur SANAA actuel.
const COLONNES_PRODUIT_ZH = [
  { header: '编号', key: 'numero_ligne', width: 10 },
  { header: '定制信息', key: 'personnalisation', width: 75 },
  { header: '宝石材质', key: 'couleur', width: 29.44 },
  { header: '字体', key: 'police', width: 19.33 },
  { header: '模型', key: 'modele', width: 28.33 },
];

function bornesJour(date) {
  const jour = date ? new Date(date) : new Date();
  const debut = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate());
  const fin = new Date(debut.getTime() + 24 * 60 * 60 * 1000);
  return { debut, fin };
}

async function commandesDuJour(filtre, date) {
  const { debut, fin } = bornesJour(date);
  return Commande.find({ ...filtre, createdAt: { $gte: debut, $lt: fin } }).populate('client_id');
}

/**
 * Modèle (chinois) et couleur (chinoise) d'une ligne — retour V0.1 : le nom
 * chinois du produit (nom_zh) et de la couleur de la variante (couleur_zh)
 * sont saisis une fois au catalogue et réutilisés dans tous les exports,
 * l'usine ne travaillant qu'en chinois. Si la traduction n'a pas encore été
 * renseignée, la cellule est signalée (fond orangé) plutôt que d'envoyer du
 * français à l'usine sans que personne ne s'en aperçoive.
 */
async function specificationLigne(ligne) {
  const produit = await Produit.findById(ligne.produit_id);
  const variante = produit ? produit.variantes.id(ligne.variante_id) : null;
  const modele = produit ? produit.nom_zh : '';
  const couleur = variante ? variante.couleur_zh : '';
  const personnalisation = (ligne.personnalisation || []).map((p) => p.texte).filter(Boolean).join(', ');
  const police = (ligne.personnalisation || []).map((p) => p.police).find(Boolean) || '';
  return {
    modele: modele || '',
    modeleManquant: !modele,
    couleur: couleur || ligne.couleur_choisie || '',
    couleurManquante: !couleur,
    personnalisation,
    police,
  };
}

function appliquerPolicesCellules(feuille) {
  feuille.eachRow((row) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!cell.font) cell.font = POLICE_CLASSEUR;
    });
  });
}

function signalerTraductionManquante(cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4B4' } };
}

async function ecrireClasseur(cheminFichier) {
  const dossier = path.dirname(cheminFichier);
  fs.mkdirSync(dossier, { recursive: true });
}

async function prochaineVersion(filtreVersion) {
  const versionPrecedente = await ExportModel.findOne(filtreVersion).sort({ version: -1 });
  return versionPrecedente ? versionPrecedente.version + 1 : 1;
}

/**
 * Export interne (équipe SANAA) — un pays donné, un jour donné. Reprend les
 * colonnes chinoises de spécification produit (identiques à l'usine) suivies
 * des colonnes de suivi commercial (section 7.1), dans l'organisation de
 * fichiers actuelle de SANAA (Marque/<année>/<mois>/JJ-MM-AAAA[-CODE].xlsx).
 */
async function genererExportInterne(paysId, date, utilisateurId) {
  const pays = await Pays.findById(paysId);
  if (!pays) throw ApiError.notFound('Pays introuvable');

  const commandes = await commandesDuJour({ pays_id: paysId }, date);
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet('Feuil1');

  feuille.columns = [
    ...COLONNES_PRODUIT_ZH,
    { header: 'Ncommande', key: 'ncommande', width: 21 },
    { header: 'Avance', key: 'avance', width: 32.55 },
    { header: 'Prix', key: 'prix', width: 22 },
    { header: 'reste', key: 'reste', width: 30.33 },
    { header: 'Numero', key: 'numero_tel', width: 38.55 },
    { header: 'Adresse', key: 'adresse', width: 47.55 },
  ];
  feuille.getRow(1).eachCell((cell) => Object.assign(cell, STYLE_ENTETE));

  let numeroLigne = 0;
  for (const commande of commandes) {
    const totalPaye = sum(commande.paiements.filter((p) => !p.annule).map((p) => p.montant));
    for (const ligne of commande.lignes) {
      numeroLigne += 1;
      const spec = await specificationLigne(ligne);
      const numeroExcel = numeroLigne + 1; // +1 : la ligne 1 est l'en-tête
      const ligneExcel = feuille.addRow({
        numero_ligne: numeroLigne,
        personnalisation: spec.personnalisation,
        couleur: spec.couleur,
        police: spec.police,
        modele: spec.modele,
        ncommande: commande.numero,
        avance: toDecimal(totalPaye).toNumber(),
        prix: toDecimal(ligne.sous_total).toNumber(),
        // reste = Prix - Avance, formule live (colonnes H et G de cette même
        // ligne) plutôt qu'une valeur figée, comme dans le classeur SANAA actuel.
        reste: { formula: `H${numeroExcel}-G${numeroExcel}` },
        numero_tel: commande.client_id ? commande.client_id.telephone_whatsapp : '',
        adresse: commande.client_id ? commande.client_id.adresse : '',
      });
      ligneExcel.getCell('numero_ligne').font = { ...POLICE_CLASSEUR, bold: true };
      ligneExcel.getCell('ncommande').font = { ...POLICE_CLASSEUR, bold: true };
      if (spec.modeleManquant) signalerTraductionManquante(ligneExcel.getCell('modele'));
      if (spec.couleurManquante) signalerTraductionManquante(ligneExcel.getCell('couleur'));
    }
  }

  appliquerPolicesCellules(feuille);

  const nomFichier = buildExportFileName({ date: date || new Date(), pays });
  const sousDossier = buildExportSousDossier(date || new Date());
  const version = await prochaineVersion({ pays_id: paysId, date_export: bornesJour(date).debut, type: 'interne' });
  const nomFichierVersionne = version > 1 ? nomFichier.replace('.xlsx', `-v${version}.xlsx`) : nomFichier;
  const cheminFichier = path.join(env.exportsDir, sousDossier, nomFichierVersionne);

  await ecrireClasseur(cheminFichier);
  await workbook.xlsx.writeFile(cheminFichier);

  return ExportModel.create({
    pays_id: paysId,
    date_export: bornesJour(date).debut,
    type: 'interne',
    version,
    nom_fichier: nomFichierVersionne,
    chemin_fichier: cheminFichier,
    genere_par: utilisateurId,
  });
}

/**
 * Export usine (retour V0.1) : l'usine fabrique pour tous les pays à la fois,
 * donc CE fichier combine les commandes de tous les pays d'un même jour en un
 * seul classeur — JJ-MM-AAAA(Usine).xlsx, sans code pays — plutôt qu'un
 * fichier par pays. Colonnes strictement limitées à la spécification produit
 * en chinois (section 7.1 : aucune donnée financière ou personnelle).
 * Réservé à la portée globale (super administrateur) puisqu'il mélange tous
 * les pays sans distinction.
 */
async function genererExportUsine(date, req) {
  if (!req.user.porteeGlobale) {
    throw ApiError.forbidden("Seul un utilisateur à portée globale peut générer l'export usine (il combine tous les pays)");
  }

  const commandes = await commandesDuJour({}, date);
  const workbook = new ExcelJS.Workbook();
  const feuille = workbook.addWorksheet('Feuil1');
  feuille.columns = COLONNES_PRODUIT_ZH;
  feuille.getRow(1).eachCell((cell) => Object.assign(cell, STYLE_ENTETE));

  let numeroLigne = 0;
  for (const commande of commandes) {
    for (const ligne of commande.lignes) {
      numeroLigne += 1;
      const spec = await specificationLigne(ligne);
      const ligneExcel = feuille.addRow({
        numero_ligne: numeroLigne,
        personnalisation: spec.personnalisation,
        couleur: spec.couleur,
        police: spec.police,
        modele: spec.modele,
      });
      ligneExcel.getCell('numero_ligne').font = { ...POLICE_CLASSEUR, bold: true };
      if (spec.modeleManquant) signalerTraductionManquante(ligneExcel.getCell('modele'));
      if (spec.couleurManquante) signalerTraductionManquante(ligneExcel.getCell('couleur'));
    }
  }

  appliquerPolicesCellules(feuille);

  const nomFichier = buildUsineFileName({ date: date || new Date() });
  const sousDossier = buildExportSousDossier(date || new Date());
  const version = await prochaineVersion({ pays_id: null, date_export: bornesJour(date).debut, type: 'usine' });
  const nomFichierVersionne = version > 1 ? nomFichier.replace('.xlsx', `-v${version}.xlsx`) : nomFichier;
  const cheminFichier = path.join(env.exportsDir, sousDossier, nomFichierVersionne);

  await ecrireClasseur(cheminFichier);
  await workbook.xlsx.writeFile(cheminFichier);

  return ExportModel.create({
    pays_id: null,
    date_export: bornesJour(date).debut,
    type: 'usine',
    version,
    nom_fichier: nomFichierVersionne,
    chemin_fichier: cheminFichier,
    genere_par: req.user.id,
  });
}

async function lister({ pays_id, date_de, date_a, type } = {}) {
  const filtre = {};
  if (pays_id) filtre.pays_id = pays_id;
  if (type) filtre.type = type;
  if (date_de || date_a) {
    filtre.date_export = {};
    if (date_de) filtre.date_export.$gte = new Date(date_de);
    if (date_a) filtre.date_export.$lte = new Date(date_a);
  }
  return ExportModel.find(filtre).populate('pays_id genere_par').sort({ date_export: -1, version: -1 });
}

async function obtenir(id) {
  const exp = await ExportModel.findById(id);
  if (!exp) throw ApiError.notFound('Export introuvable');
  return exp;
}

module.exports = { genererExportInterne, genererExportUsine, lister, obtenir };
