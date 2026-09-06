// Nomenclature et organisation des exports — section 7.2, ajustées en retour
// V0.1 pour reproduire l'organisation réelle de SANAA (dossier Marque/<année>/
// <Mois en français>/, partagé par les exports interne et usine d'un même mois).
const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateComponents(date) {
  const d = new Date(date);
  return { jj: pad2(d.getDate()), mm: pad2(d.getMonth() + 1), aaaa: d.getFullYear(), mois: d.getMonth() };
}

/**
 * Sous-dossier d'un export, reproduisant l'organisation OneDrive actuelle de
 * SANAA : <année>/<Mois en français>/ — commun aux exports interne et usine
 * d'un même mois, quel que soit le pays.
 */
function buildExportSousDossier(date) {
  const { aaaa, mois } = dateComponents(date);
  return `${aaaa}/${MOIS_FR[mois]}`;
}

/**
 * Export interne : JJ-MM-AAAA[-CODEPAYS].xlsx — le suffixe est omis uniquement
 * pour le pays marqué `est_pays_historique_sans_suffixe`.
 */
function buildExportFileName({ date, pays }) {
  const { jj, mm, aaaa } = dateComponents(date);
  const suffixPays = pays.est_pays_historique_sans_suffixe ? '' : `-${pays.code}`;
  return `${jj}-${mm}-${aaaa}${suffixPays}.xlsx`;
}

/**
 * Export usine : JJ-MM-AAAA(Usine).xlsx — jamais de code pays, l'usine
 * fabriquant pour tous les pays à la fois (voir export.service.js).
 */
function buildUsineFileName({ date }) {
  const { jj, mm, aaaa } = dateComponents(date);
  return `${jj}-${mm}-${aaaa}(Usine).xlsx`;
}

module.exports = { buildExportFileName, buildUsineFileName, buildExportSousDossier, MOIS_FR };
