# Deploy SpareFit to the production server

Server: the shared DigitalOcean droplet (Ubuntu 24.04, nginx, Postgres 16 on localhost, Node 22) that also runs the other Progryss apps under PM2. Domain: `https://sparefit.progryss.com` (DNS and the Let's Encrypt certificate are in place; nginx forwards to port 3006).

| What | Where |
| --- | --- |
| Code (git clone) | `/var/www/sparefit.progryss.com/html` |
| Settings | `/var/www/sparefit.progryss.com/html/.env` (owner-only) |
| PM2 config | `/var/www/sparefit.progryss.com/ecosystem.config.cjs` (outside the repo) |
| Uploaded files, backups, reports | `/var/lib/sparefit/storage` |
| Processes | PM2: `sparefit-web` (port 3006) and `sparefit-worker` (jobs), both run as the `sparefit` user |

Run every command as **root** on the server unless it says `sudo -u sparefit`. No credentials are written in this file.

## Status (first deployment, 2026-10-16)

| Step | Status |
| --- | --- |
| Before you start (hardening, 4 GB, backups) | **open** (recommended) |
| 1 Code, user, folders | ✅ done |
| 2 Database | ✅ done |
| 3 Settings, install, build, migrate | ✅ done |
| 4 PM2 (web + worker) | ✅ done: both online, 0 restarts |
| 4d PM2 log rotation | open (recommended) |
| 5 nginx | ✅ done: `https://sparefit.progryss.com` → 200, `/backoffice` sign-in works |
| 6 Backoffice plans | open: set the real plans, one Free |
| 7 Release the Shopify config | ✅ done (after renaming the dev app's handle, see step 7) |
| 8 First test on a dev store | open |
| 9 Daily database backup | open |

## Problems we hit and how they were solved

| Where | Problem | Fix (already in the steps below) |
| --- | --- | --- |
| Step 1 | Private repo: the server needs GitHub access | `ssh -T git@github.com` as root answered `Hi progryss!` (an account key, not a deploy key), so root clones and pulls, then `chown` gives the files to `sparefit`. A per-repo deploy key would be safer. |
| Step 1 | Code went into `html/`, not `app/` as first planned | `html/` is the code folder everywhere in this guide |
| Step 4 | `Interpreter bun is NOT AVAILABLE in PATH` for the worker | PM2 runs any `.ts` script with Bun, even with `interpreter: "node"`. The worker starts through `node_modules/tsx/dist/cli.mjs` with `scripts/worker.ts` as its argument |
| Step 5 | The old nginx file pointed `root` at the code folder, had `www.` and no forwarding headers or timeouts | Whole file replaced (backup in `/root/sparefit.nginx.bak`) |
| Step 7 | `app_handle: App handle must be unique` when releasing production | The dev app already had the handle `sparefit`. The dev app was renamed to `sparefit-dev` (`shopify.app.dev.toml`) and released first (`npm run deploy:dev`); then the production release worked. Production keeps `sparefit`; the local `.env` uses `SHOPIFY_APP_HANDLE=sparefit-dev` |

---

## Before you start (recommended)

- Change the root password; log in with an SSH key, then set `PermitRootLogin prohibit-password` and `PasswordAuthentication no` in `/etc/ssh/sshd_config` and run `systemctl reload ssh` (keep your session open until a key login works); `apt install fail2ban`.
- Resize the droplet to 4 GB RAM or more (it has 2 GB and already swaps) and turn on DigitalOcean backups.
- Apply updates: `apt upgrade`, then `reboot`.

---

## Step 1 — Code, user and folders ✅ done

The repo is private. Check root's GitHub access first:

```bash
ssh -T git@github.com     # "Hi progryss!" = account key: root can clone every repo of the account
```


```bash
id sparefit || adduser --system --group --home /var/www/sparefit.progryss.com sparefit
cd /var/www/sparefit.progryss.com
git clone git@github.com:progryss/SpareFit-Parts-Finder.git html     # root's GitHub key
rm -f html/hello.js
mkdir -p /var/lib/sparefit/storage
chown -R sparefit:sparefit /var/www/sparefit.progryss.com /var/lib/sparefit
git config --global --add safe.directory /var/www/sparefit.progryss.com/html
```

## Step 2 — Database ✅ done

Password: letters and digits only.

```bash
sudo -u postgres psql -c "CREATE ROLE sparefit LOGIN PASSWORD 'YOUR_DB_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE sparefit OWNER sparefit;"
```

## Step 3 — Settings, install, build, migrate ✅ done

```bash
sudo -u sparefit nano /var/www/sparefit.progryss.com/html/.env
chmod 600 /var/www/sparefit.progryss.com/html/.env
```

`.env` contents (no quotes, no spaces around `=`):

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3006
SHOPIFY_API_KEY=<client id from shopify.app.toml>
SHOPIFY_API_SECRET=<client secret from the Partner Dashboard>
SHOPIFY_APP_URL=https://sparefit.progryss.com
SCOPES=read_products,write_app_proxy,read_themes,write_files
SHOPIFY_APP_HANDLE=sparefit
DATABASE_URL=postgresql://sparefit:YOUR_DB_PASSWORD@localhost:5432/sparefit?connection_limit=10
PROXY_MAX_QUERIES=6
STORAGE_DRIVER=local
STORAGE_DIR=/var/lib/sparefit/storage
JOBS_INLINE=false
BACKOFFICE_EMAIL=<your email>
BACKOFFICE_PASSWORD=<12+ characters>
PRIVACY_POLICY_URL=<public privacy policy URL>
```

Leave out `SHOPIFY_BILLING_TEST`, `JOBS_SCHEDULES`, `PGBOSS_SCHEMA` and `TUNNEL_URL`. There is no `SUPPORT_EMAIL` or `HELP_CENTER_URL` (support is the in-app chat). Optional: `APP_STORE_URL` (once approved), `LOG_SLOW_MS` (default 3000).

```bash
cd /var/www/sparefit.progryss.com/html
sudo -u sparefit npm ci
sudo -u sparefit npm run build
sudo -u sparefit npm run setup      # ends with "All migrations have been successfully applied."
```

Never run `prisma migrate reset` or `prisma migrate dev` on the server.

---

## Step 4 — Start SpareFit with PM2 ✅ done

### 4a. Create the PM2 config (paste the whole block)

```bash
cat > /var/www/sparefit.progryss.com/ecosystem.config.cjs <<'EOF'
const dir = "/var/www/sparefit.progryss.com/html";
module.exports = {
  apps: [
    {
      name: "sparefit-web",
      cwd: dir,
      script: "node_modules/@react-router/serve/bin.js",
      args: "./build/server/index.js",
      node_args: "--env-file=.env",
      uid: "sparefit",
      gid: "sparefit",
      max_memory_restart: "600M",
    },
    {
      name: "sparefit-worker",
      cwd: dir,
      script: "node_modules/tsx/dist/cli.mjs",
      args: "scripts/worker.ts",
      node_args: "--env-file=.env",
      uid: "sparefit",
      gid: "sparefit",
      max_memory_restart: "700M",
    },
  ],
};
EOF
```

`--env-file=.env` loads the settings (the web process doesn't read `.env` by itself). The worker starts through tsx's own `.mjs` file: PM2 runs any `.ts` script with Bun ("Interpreter bun is NOT AVAILABLE"), even with `interpreter: "node"`.

### 4b. Start both and save the list (so they come back after a reboot)

```bash
pm2 start /var/www/sparefit.progryss.com/ecosystem.config.cjs
pm2 save
```

### 4c. Check

```bash
pm2 ls
curl -sI http://127.0.0.1:3006/ | head -1
```

Expected: `sparefit-web` and `sparefit-worker` are **online**, and curl prints **`HTTP/1.1 200 OK`**.

If one is `errored` or curl prints nothing:

```bash
pm2 logs sparefit-web --lines 40 --nostream
pm2 logs sparefit-worker --lines 40 --nostream
```

### 4d. Log rotation (open; recommended, helps every app on the server: the PM2 logs were 653 MB)

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 7
```

---

## Step 5 — nginx ✅ done

Back up the current file, then replace it with the full config below (paste the whole block as root):

```bash
cp /etc/nginx/sites-available/sparefit.progryss.com /root/sparefit.nginx.bak

cat > /etc/nginx/sites-available/sparefit.progryss.com <<'EOF'
server {
    server_name sparefit.progryss.com;

    # CSV uploads pass through the app (it allows up to 100 MB)
    client_max_body_size 110m;

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        # "Delete all", "Remove duplicates" and field changes can take minutes
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        proxy_request_buffering off;
    }

    listen 443 ssl; # managed by Certbot
    listen [::]:443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/sparefit.progryss.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/sparefit.progryss.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}

server {
    listen 80;
    listen [::]:80;
    server_name sparefit.progryss.com;
    return 301 https://$host$request_uri;
}
EOF

nginx -t && systemctl reload nginx
curl -sI https://sparefit.progryss.com/ | head -1
```

Expected: `nginx -t` says "test is successful" and curl prints **`HTTP/2 200`** (no longer 502). If `nginx -t` fails, put the old file back: `cp /root/sparefit.nginx.bak /etc/nginx/sites-available/sparefit.progryss.com && systemctl reload nginx`.

What changed: `www.` removed (the app has one URL), the `root`/`index` lines removed (everything goes to the app; nginx never serves files from the code folder), forwarding headers added, 300 s timeouts, 110 MB uploads. Don't add `X-Frame-Options` or `Content-Security-Policy` here: the app sets them itself for the Shopify admin.

---

## Step 6 — Backoffice plans (open)

1. Open `https://sparefit.progryss.com/backoffice` and sign in with `BACKOFFICE_EMAIL` / `BACKOFFICE_PASSWORD`.
2. Set the real plans. **Keep one plan marked Free** (the review notes rely on it).
3. Enter exactly the same plans and prices in the Partner Dashboard listing.

## Step 7 — Release the Shopify config ✅ done (on your Mac, not the server)

```bash
npm run config:check      # "shopify.app.toml is ready."
npm run deploy:prod       # app config, webhooks, app proxy, theme extension → "Yes, release this new version"
npm run config:which      # must still say shopify.app.dev.toml
```

Only after the server answers 200 (step 5).

**App handles:** each Shopify app needs its own handle. Production uses `sparefit` (`shopify.app.toml`, server `.env` `SHOPIFY_APP_HANDLE=sparefit`); the dev app uses `sparefit-dev` (`shopify.app.dev.toml`, local `.env` `SHOPIFY_APP_HANDLE=sparefit-dev`). The first production release failed with "App handle must be unique" because the dev app still held `sparefit`; the fix was `npm run deploy:dev` with the new dev handle, then the production release again. If a handle ever changes, change `SHOPIFY_APP_HANDLE` in that environment too (billing returns to `/apps/{handle}/…`) and restart.

## Step 8 — First test (open)

Use a development store without the dev app installed.

1. Install the production app (Partner Dashboard › SpareFit › install on a store) → onboarding opens; pick a store type.
2. `Backoffice › Stores` lists the store.
3. Search setup › Import `.claude/launch/reviewer-sample.csv` → it reaches "Done" (the worker is running).
4. Theme editor: turn on the SpareFit app embed, add the search block → a storefront search shows results; a product page shows the fits badge.
5. Plans: choose a paid plan → Shopify's charge approval page → approve → back on Plans with the plan and trial; switch back to the free plan.
6. Uninstall and reinstall → the app opens again with the setup kept.
7. `Backoffice › Logs` shows no errors.

## Step 9 — Daily database backup (open)

```bash
cat > /etc/cron.d/sparefit-backup <<'EOF'
30 2 * * * postgres pg_dump -Fc sparefit > /var/backups/sparefit-$(date +\%F).dump && find /var/backups -name 'sparefit-*.dump' -mtime +14 -delete
EOF
```

Keeps 14 days of dumps in `/var/backups`. Restore (with both processes stopped): `pg_restore -d sparefit --clean /var/backups/sparefit-<date>.dump`.

---

## Updating later

```bash
cd /var/www/sparefit.progryss.com/html
git pull
chown -R sparefit:sparefit /var/www/sparefit.progryss.com/html
sudo -u sparefit npm ci
sudo -u sparefit npm run build
sudo -u sparefit npm run setup
pm2 restart sparefit-web sparefit-worker
```

Server first; then `npm run deploy:prod` on your Mac, only when a TOML file or `extensions/` changed.

## Everyday commands

| To… | Run |
| --- | --- |
| Status | `pm2 ls` |
| Restart | `pm2 restart sparefit-web sparefit-worker` |
| Stop | `pm2 stop sparefit-web sparefit-worker` |
| Logs | `pm2 logs sparefit-web --lines 50` (Ctrl+C to exit) |
| App errors, warnings, slow requests | `https://sparefit.progryss.com/backoffice/logs` |
| Memory | `free -h`, `pm2 ls` (mem column) |
| Upload disk use | `du -sh /var/lib/sparefit/storage` |
| Certificate | `certbot certificates` (renews automatically) |
