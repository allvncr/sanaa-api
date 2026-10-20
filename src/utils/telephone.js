const SEPARATEUR_NUMEROS = /[/,;]/;

/**
 * Forme canonique d'un champ téléphone (retour du 20/10/2026 : "0769706445" et
 * "07 69 70 64 45" sont le même client). Un champ peut contenir plusieurs
 * numéros séparés par "/" : chacun est réduit à ses chiffres (un "+" initial
 * est conservé) puis ils sont rejoints par " / ".
 */
function normaliserTelephone(valeur) {
  if (valeur === undefined || valeur === null) return valeur;
  return String(valeur)
    .split(SEPARATEUR_NUMEROS)
    .map((n) => {
      const t = n.trim();
      return (t.startsWith('+') ? '+' : '') + t.replace(/\D/g, '');
    })
    .filter((n) => n && n !== '+')
    .join(' / ');
}

const RECHERCHE_TELEPHONE = /^[\d\s.+()\-/]+$/;

/**
 * Expression régulière de recherche par numéro, tolérante aux espaces/points/
 * tirets entre les chiffres (donc aussi pour les fiches anciennes enregistrées
 * avec des espaces). Renvoie null si la saisie ne ressemble pas à un numéro.
 */
function regexRechercheTelephone(saisie) {
  const texte = String(saisie || '').trim();
  if (!RECHERCHE_TELEPHONE.test(texte)) return null;
  const chiffres = texte.replace(/\D/g, '');
  if (!chiffres) return null;
  return new RegExp(chiffres.split('').join('[\\s.\\-]*'));
}

module.exports = { normaliserTelephone, regexRechercheTelephone };
