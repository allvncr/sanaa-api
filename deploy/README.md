# Migration Netlify + Render → VPS LWS

Objectif : faire tourner le frontend (Vue) et le backend (Node/Express) de
SANAA sur un seul VPS LWS, en gardant MongoDB Atlas tel quel (aucune migration
de données à faire — seul l'hébergement du code change).

Plan recommandé : **VPS M** (4 vCore, 8 Go RAM, 150 Go NVMe, 4,99 €HT/mois en
promo). Largement suffisant : le backend actuel tient sur l'instance gratuite
de Render, et MongoDB reste sur Atlas (la RAM du VPS ne sert donc qu'à Node,
Nginx et le build du frontend). De la marge pour ajouter plus tard un service
(ex. génération de PDF, tâche planifiée) sans upgrade.

## 0. Ce que je ne peux pas faire à votre place

- Commander/payer le VPS chez LWS (formulaire de paiement).
- Acheter ou transférer un nom de domaine.
- Me connecter en SSH sans que vous m'ayez donné l'accès (IP + utilisateur +
  clé ou mot de passe).

Tout le reste ci-dessous, je peux le faire avec vous une fois que vous avez
l'accès SSH — dites-le-moi et on avance étape par étape.

## 1. Commander le VPS

Sur lws.fr : **VPS M**, image **Ubuntu 22.04 LTS** (pas de panel type
cPanel/Plesk nécessaire — on installera tout à la main, plus léger et plus
sous contrôle). Notez l'IP fournie par LWS à la fin de la commande.

## 2. DNS du domaine

Chez votre registrar (ou dans l'espace LWS si le domaine y est aussi), créer :

| Type | Nom | Valeur |
|---|---|---|
| A | @ | IP du VPS |
| A | www | IP du VPS |

La propagation peut prendre de quelques minutes à quelques heures.

## 3. Premier accès et sécurisation de base

```bash
ssh root@IP_DU_VPS

# utilisateur dédié (ne jamais tourner en root au quotidien)
adduser sanaa
usermod -aG sudo sanaa

# pare-feu : seulement SSH, HTTP, HTTPS
apt update && apt install -y ufw
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable

# reconnexion avec le nouvel utilisateur pour la suite
exit
ssh sanaa@IP_DU_VPS
```

## 4. Outils (Node, PM2, Nginx, certbot, git)

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2

sudo apt install -y certbot python3-certbot-nginx

sudo mkdir -p /var/www/sanaa /var/log/sanaa
sudo chown -R sanaa:sanaa /var/www/sanaa /var/log/sanaa
```

## 5. Récupérer le code

```bash
cd /var/www/sanaa
git clone https://github.com/allvncr/sanaa-api.git backend
git clone https://github.com/allvncr/Sanaa-web-app.git frontend
```

## 6. Configurer le backend

```bash
cd /var/www/sanaa/backend
npm ci --omit=dev
cp deploy/.env.production.example .env
nano .env   # coller MONGODB_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET
            # (copier les valeurs EXACTES depuis Render > sanaa-api > Environment
            # — ne pas en régénérer, sinon tous les utilisateurs connectés
            # seraient déconnectés) et CORS_ORIGIN=https://votre-domaine.com

pm2 start deploy/ecosystem.config.js --env production
pm2 save
pm2 startup    # affiche une commande à copier-coller pour démarrer au boot
```

Vérifier que ça tourne : `curl http://127.0.0.1:4000/health` doit répondre
`{"status":"ok", ...}`.

## 7. Configurer le frontend

```bash
cd /var/www/sanaa/frontend
cp .env.production.local.example .env.production.local   # VITE_API_BASE_URL=/api/v1
npm ci
npm run build   # génère dist/, servi ensuite directement par Nginx
```

## 8. Nginx (HTTP d'abord, HTTPS à l'étape suivante)

```bash
sudo cp /var/www/sanaa/backend/deploy/nginx.conf /etc/nginx/sites-available/sanaa
sudo nano /etc/nginx/sites-available/sanaa   # remplacer "votre-domaine.com" par le vrai domaine
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -s /etc/nginx/sites-available/sanaa /etc/nginx/sites-enabled/sanaa
sudo nginx -t && sudo systemctl reload nginx
```

À ce stade, `http://votre-domaine.com` doit déjà afficher l'application (sans
cadenas).

## 9. HTTPS (Let's Encrypt, gratuit, renouvellement automatique)

```bash
sudo certbot --nginx -d votre-domaine.com -d www.votre-domaine.com
```

Certbot modifie automatiquement `/etc/nginx/sites-available/sanaa` pour
ajouter les blocs SSL et la redirection HTTP → HTTPS, et installe le
renouvellement automatique (`certbot renew` via un timer systemd déjà activé
par défaut sur Ubuntu — rien à faire).

## 10. Vérifications avant de couper Netlify/Render

- Se connecter avec un compte réel sur `https://votre-domaine.com`.
- Tester : liste des commandes, création d'une commande, upload d'un import
  Excel, export usine, dashboard.
- Regarder les logs si besoin : `pm2 logs sanaa-backend`.
- Laisser tourner Netlify/Render encore quelques jours en parallèle avant de
  les arrêter (aucun risque : deux frontends peuvent pointer sur la même base
  Atlas en même temps).

## 11. Une fois confiant : arrêter Netlify et Render

- Netlify : Site settings > general > "Delete site" (ou juste ne plus déployer
  dessus si vous préférez garder l'historique).
- Render : supprimer le service `sanaa-api` (sinon il continue à essayer de
  démarrer et peut consommer le quota gratuit pour rien).

## Redéploiements suivants

À chaque fois que du code est poussé sur l'un des deux dépôts (`main`), se
connecter au VPS et lancer :

```bash
bash /var/www/sanaa/backend/deploy/deploy.sh          # backend + frontend
bash /var/www/sanaa/backend/deploy/deploy.sh backend  # backend seul
bash /var/www/sanaa/backend/deploy/deploy.sh frontend # frontend seul
```

(Un déploiement automatique via GitHub Actions/webhook pourra être mis en
place plus tard si le va-et-vient manuel devient pénible — pas nécessaire pour
démarrer.)
