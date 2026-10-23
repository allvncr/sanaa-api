require('dotenv').config();

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 4000,
  // Écoute locale uniquement par défaut : en production l'API n'est joignable
  // que via Nginx (127.0.0.1:4000). Un hébergeur sans reverse proxy local
  // (Render) définit HOST=0.0.0.0.
  host: process.env.HOST || '127.0.0.1',
  trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : 1,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sanaa',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpires: process.env.JWT_REFRESH_EXPIRES || '30d',
  },
  deviseReferenceGlobale: process.env.DEVISE_REFERENCE_GLOBALE || 'XOF',
  // Liste séparée par des virgules (déploiement : dev local + frontend en
  // production peuvent coexister, ex. "http://localhost:5173,https://sanaa.vercel.app").
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()),
  exportsDir: process.env.EXPORTS_DIR || './storage/exports',
};
