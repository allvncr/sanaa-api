/**
 * Normalise les numéros de téléphone des clients existants (retour du
 * 20/10/2026 : "0769706445" et "07 69 70 64 45" = même client) et fusionne les
 * doublons créés par ces variantes de saisie (même pays + même numéro).
 *
 * Fusion : le client le plus ancien est conservé, ses champs vides (nom,
 * adresse, ville, notes) sont complétés par ceux des doublons, les commandes
 * des doublons lui sont rattachées, puis les doublons sont supprimés.
 *
 * Usage (depuis backend/) :
 *   node scripts/normaliser-telephones.js            # simulation, n'écrit rien
 *   node scripts/normaliser-telephones.js --appliquer
 */
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const { normaliserTelephone } = require('../src/utils/telephone');

const appliquer = process.argv.includes('--appliquer');
const CHAMPS_A_COMPLETER = ['nom', 'adresse', 'ville', 'notes'];

async function main() {
  await mongoose.connect(env.mongodbUri);
  const clients = mongoose.connection.collection('clients');
  const commandes = mongoose.connection.collection('commandes');

  const tous = await clients.find({}).sort({ createdAt: 1, _id: 1 }).toArray();
  const groupes = new Map();
  let aReecrire = 0;
  for (const c of tous) {
    const tel = normaliserTelephone(c.telephone_whatsapp);
    c._tel = tel;
    if (tel !== c.telephone_whatsapp) aReecrire += 1;
    if (!tel) continue; // sans numéro : jamais dédoublonné
    const cle = `${c.pays_id}|${tel}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(c);
  }

  let fusions = 0;
  let commandesRattachees = 0;
  for (const membres of groupes.values()) {
    if (membres.length < 2) continue;
    const [garde, ...doublons] = membres;
    const complements = {};
    for (const champ of CHAMPS_A_COMPLETER) {
      if (garde[champ]) continue;
      const source = doublons.find((d) => d[champ]);
      if (source) complements[champ] = source[champ];
    }
    const ids = doublons.map((d) => d._id);
    const nb = await commandes.countDocuments({ client_id: { $in: ids } });
    fusions += doublons.length;
    commandesRattachees += nb;
    console.log(`Fusion ${garde._tel} : garde ${garde._id} (${garde.nom || 'sans nom'}), absorbe ${doublons.length} doublon(s) et ${nb} commande(s)`);
    if (appliquer) {
      if (nb) await commandes.updateMany({ client_id: { $in: ids } }, { $set: { client_id: garde._id } });
      if (Object.keys(complements).length) await clients.updateOne({ _id: garde._id }, { $set: complements });
      await clients.deleteMany({ _id: { $in: ids } });
    }
  }

  if (appliquer) {
    for (const c of tous) {
      if (c._tel !== c.telephone_whatsapp && c._tel !== '' && !groupesDoublonSupprime(groupes, c)) {
        await clients.updateOne({ _id: c._id }, { $set: { telephone_whatsapp: c._tel } });
      }
    }
  }

  console.log(`\n${tous.length} clients examinés · ${aReecrire} numéros à réécrire · ${fusions} doublon(s) fusionné(s) · ${commandesRattachees} commande(s) rattachée(s)`);
  console.log(appliquer ? 'Modifications appliquées.' : 'Simulation : rien n\'a été modifié (ajouter --appliquer pour exécuter).');
  await mongoose.disconnect();
}

// Un doublon fusionné a déjà été supprimé : inutile de le réécrire.
function groupesDoublonSupprime(groupes, client) {
  const membres = groupes.get(`${client.pays_id}|${client._tel}`);
  return Boolean(membres && membres.length > 1 && membres[0]._id !== client._id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
