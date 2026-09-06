// Retour V0.1 (SANAA) : les moyens de paiement ne sont plus configurés
// librement pays par pays — un pays reçoit systématiquement ces quatre options
// à sa création. "Mobile Money" sert de catégorie générique pour tout opérateur
// autre que Wave/Orange Money (MTN, Moov, Airtel, M-Pesa…), qui restent
// distingués car très utilisés en Côte d'Ivoire notamment.
const MOYENS_PAIEMENT_STANDARD = ['Wave', 'Orange Money', 'Espèces', 'Mobile Money'];

function construireMoyensPaiementStandard() {
  return MOYENS_PAIEMENT_STANDARD.map((nom) => ({ nom, actif: true }));
}

module.exports = { MOYENS_PAIEMENT_STANDARD, construireMoyensPaiementStandard };
