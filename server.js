const app = require('./src/app');
const connectDB = require('./src/config/db');
const env = require('./src/config/env');
const logger = require('./src/utils/logger');

async function start() {
  await connectDB();
  app.listen(env.port, env.host, () => {
    logger.info(`SANAA API démarrée sur http://${env.host}:${env.port} (${env.nodeEnv})`);
  });
}

start().catch((err) => {
  logger.error(err);
  process.exit(1);
});
