require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const logger = require('../utils/logger');
const seedRunner = require('./seedRunner');

async function run() {
  await connectDB();
  await seedRunner();
  // Le plugin de journal d'activité écrit en tâche de fond (non bloquant, voir
  // activityLogPlugin.js) : on laisse un court instant pour que ces écritures
  // se terminent avant de couper la connexion, sinon elles échouent en silence.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
