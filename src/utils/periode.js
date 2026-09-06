// Résolution des filtres de période du dashboard (retour V0.1) : présets
// Année/Mois/Semaine/Jour/Plage personnalisée, chacun avec sa période de
// comparaison "N-1" correspondante (sauf la plage personnalisée, qui n'a pas
// de période précédente évidente).

function debutJour(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
function finJour(date) {
  return new Date(debutJour(date).getTime() + 24 * 60 * 60 * 1000 - 1);
}
// Semaine calendaire du lundi au dimanche.
function debutSemaine(date) {
  const d = debutJour(date);
  const decalage = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - decalage);
  return d;
}
function finSemaine(date) {
  return new Date(debutSemaine(date).getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
}
function debutMois(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function finMois(date) {
  return new Date(new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - 1);
}
function debutAnnee(date) {
  return new Date(date.getFullYear(), 0, 1);
}
function finAnnee(date) {
  return new Date(new Date(date.getFullYear() + 1, 0, 1).getTime() - 1);
}

/**
 * @param {'jour'|'semaine'|'mois'|'annee'|'personnalise'|undefined} type
 * @param {{date?: string, periode_debut?: string, periode_fin?: string}} options
 * @returns {{debut: Date, fin: Date, precedent: {debut: Date, fin: Date} | null}}
 */
function resoudrePeriode(type, { date, periode_debut, periode_fin } = {}) {
  const ref = date ? new Date(date) : new Date();

  switch (type) {
    case 'jour': {
      const veille = new Date(ref.getTime() - 24 * 60 * 60 * 1000);
      return {
        debut: debutJour(ref),
        fin: finJour(ref),
        precedent: { debut: debutJour(veille), fin: finJour(veille) },
      };
    }
    case 'semaine': {
      const semainePrecedente = new Date(ref.getTime() - 7 * 24 * 60 * 60 * 1000);
      return {
        debut: debutSemaine(ref),
        fin: finSemaine(ref),
        precedent: { debut: debutSemaine(semainePrecedente), fin: finSemaine(semainePrecedente) },
      };
    }
    case 'mois': {
      const moisPrecedent = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
      return {
        debut: debutMois(ref),
        fin: finMois(ref),
        precedent: { debut: debutMois(moisPrecedent), fin: finMois(moisPrecedent) },
      };
    }
    case 'annee': {
      const anneePrecedente = new Date(ref.getFullYear() - 1, 0, 1);
      return {
        debut: debutAnnee(ref),
        fin: finAnnee(ref),
        precedent: { debut: debutAnnee(anneePrecedente), fin: finAnnee(anneePrecedente) },
      };
    }
    case 'personnalise':
      return {
        debut: periode_debut ? new Date(periode_debut) : debutMois(ref),
        fin: periode_fin ? new Date(periode_fin) : finJour(ref),
        precedent: null,
      };
    default:
      // Rétrocompatibilité : comportement historique (30 derniers jours ou
      // plage explicite) si aucun préset n'est fourni.
      return {
        debut: periode_debut ? new Date(periode_debut) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        fin: periode_fin ? new Date(periode_fin) : new Date(),
        precedent: null,
      };
  }
}

module.exports = { resoudrePeriode, debutJour, finJour, debutSemaine, finSemaine, debutMois, finMois, debutAnnee, finAnnee };
