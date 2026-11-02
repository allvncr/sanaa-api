/**
 * Crée (ou remet à jour) uniquement le rôle « Auditeur » : lecture seule sur
 * toutes les données, tous pays. N'utilise pas le seed complet, qui réécrirait
 * aussi les permissions des autres rôles.
 *
 * Usage (depuis backend/) :
 *   node scripts/creer-role-auditeur.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const env = require('../src/config/env');
const Role = require('../src/models/Role');
const { ROLES_PAR_DEFAUT } = require('../src/utils/permissions');

async function main() {
  const definition = ROLES_PAR_DEFAUT.find((r) => r.nom === 'Auditeur');
  await mongoose.connect(env.mongodbUri);
  const existant = await Role.findOne({ nom: definition.nom });
  const role = await Role.findOneAndUpdate({ nom: definition.nom }, definition, { upsert: true, new: true });
  console.log(`${existant ? 'Rôle mis à jour' : 'Rôle créé'} : ${role.nom} (${role.permissions.length} permissions, portée ${role.portee})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
