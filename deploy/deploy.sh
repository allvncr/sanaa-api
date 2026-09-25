#!/usr/bin/env bash
# Redéploiement manuel — à lancer sur le VPS (pas en local) après un `git push`
# sur l'un des deux dépôts, ou les deux. Usage :
#   ./deploy.sh            -> backend + frontend
#   ./deploy.sh backend    -> backend seul
#   ./deploy.sh frontend   -> frontend seul
set -euo pipefail

BASE=/var/www/sanaa
CIBLE="${1:-all}"

deployer_backend() {
  echo "== Backend =="
  cd "$BASE/backend"
  git pull --ff-only
  npm ci --omit=dev
  pm2 reload deploy/ecosystem.config.js --env production
}

deployer_frontend() {
  echo "== Frontend =="
  cd "$BASE/frontend"
  git pull --ff-only
  npm ci
  npm run build
  # rien à redémarrer : Nginx sert directement dist/ (déjà à jour après le build)
}

case "$CIBLE" in
  backend) deployer_backend ;;
  frontend) deployer_frontend ;;
  all) deployer_backend; deployer_frontend ;;
  *) echo "Usage: $0 [backend|frontend|all]"; exit 1 ;;
esac

echo "Déploiement terminé."
