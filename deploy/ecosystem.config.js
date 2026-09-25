// Configuration PM2 — fait tourner le backend "à plein temps" (redémarrage
// auto en cas de crash, au reboot du serveur via `pm2 startup` + `pm2 save`).
// Usage : cd /var/www/sanaa/backend && pm2 start deploy/ecosystem.config.js --env production
module.exports = {
  apps: [
    {
      name: 'sanaa-backend',
      script: 'server.js',
      cwd: __dirname + '/..',
      instances: 1, // VPS M = 4 vCore ; on pourrait passer en mode "cluster" plus tard si besoin
      exec_mode: 'fork',
      env_production: { NODE_ENV: 'production' }, // les autres variables viennent du .env (dotenv)
      max_memory_restart: '400M',
      out_file: '/var/log/sanaa/backend.out.log',
      error_file: '/var/log/sanaa/backend.error.log',
      time: true,
    },
  ],
};
