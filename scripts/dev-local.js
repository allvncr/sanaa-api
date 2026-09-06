/**
 * Lance un MongoDB en mémoire (mongodb-memory-server) pour le développement local
 * sans dépendance à une instance MongoDB installée séparément ou à MongoDB Atlas.
 * À réserver au développement : les données ne survivent pas au redémarrage.
 * En recette/production, utiliser une vraie instance MongoDB (Atlas recommandé,
 * voir section 2.7 de l'architecture) via MONGODB_URI dans .env et `npm run dev`.
 */
require('dotenv').config();
const { MongoMemoryServer } = require('mongodb-memory-server');

async function run() {
  const mem = await MongoMemoryServer.create({ instance: { port: 27117, dbName: 'sanaa' } });
  // mem.getUri() sans argument omet le nom de la base (mongoose se rabat alors
  // sur "test") — on le précise explicitement pour que l'URI reste stable et
  // prévisible d'un redémarrage à l'autre.
  process.env.MONGODB_URI = mem.getUri('sanaa');
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  // eslint-disable-next-line no-console
  console.log(`[dev-local] MongoDB en mémoire démarré : ${process.env.MONGODB_URI}`);

  require('../src/config/mongooseSerialization'); // avant tout require de modèle
  const connectDB = require('../src/config/db');
  const seedRunner = require('../src/seeders/seedRunner');
  const app = require('../src/app');
  const env = require('../src/config/env');
  const logger = require('../src/utils/logger');

  await connectDB();
  await seedRunner();
  app.listen(env.port, () => {
    logger.info(`SANAA API (dev local, DB en mémoire) démarrée sur http://localhost:${env.port}`);
  });
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
