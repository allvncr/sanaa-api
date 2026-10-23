require('./config/mongooseSerialization'); // avant tout require de modèle (voir commentaire du fichier)
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const env = require('./config/env');
const routes = require('./routes');
const { notFoundHandler, errorHandler } = require('./middlewares/errorHandler');
const logger = require('./utils/logger');

const app = express();

// Derrière Nginx (1 saut) : sans ça, tous les visiteurs apparaissent en
// 127.0.0.1 et les limiteurs de débit (connexion, suivi client, exports) sont
// partagés entre tous les utilisateurs. Valeur réglable via TRUST_PROXY.
app.set('trust proxy', env.trustProxy);

app.use(helmet());
// app.use(
//   cors({
//     origin(origin, callback) {
//       // Pas d'en-tête Origin (ex. requête serveur-à-serveur, curl) : autorisé.
//       if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
//       return callback(new Error(`Origine non autorisée par CORS : ${origin}`));
//     },
//     credentials: true,
//   })
// );
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'sanaa-backend' }));

app.use('/api/v1', routes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
