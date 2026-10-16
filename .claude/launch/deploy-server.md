# Deploy SpareFit to the production server

Server: the shared DigitalOcean droplet (Ubuntu 24.04, nginx, Postgres 16 on localhost, Node 22) that also runs the other Progryss apps. Domain: `https://sparefit.progryss.com` (DNS and the Let's Encrypt certificate are already in place; nginx forwards to port 3006).

SpareFit runs as **two systemd services under its own `sparefit` user**: the web process and the job worker. systemd restarts them on failure and at boot, and their output goes to journald, which is rotated automatically. No credentials are written in this file: you choose them on the server.

State on 2026-10-16 (read-only review): `/var/www/sparefit.progryss.com` holds only a test `html/hello.js`, nothing listens on 3006 (the site answers 502), and there is no `sparefit` database yet. GitHub `main` is behind the local repo: push first.

## 0. Before you start

1. **Server hardening** (shared server, being brute-forced over SSH):
   - Change the root password.
   - Log in with an SSH key, then set `PermitRootLogin prohibit-password` and `PasswordAuthentication no` in `/etc/ssh/sshd_config`, and run `systemctl reload ssh`. Keep your current session open until a new key login works.
   - `apt install fail2ban` (the default sshd jail is enough).
   - Apply the pending updates and reboot: `apt upgrade`, then `reboot`.
2. **Memory:** the droplet has 2 GB and already swaps. Resize it to **4 GB or more** before SpareFit goes live (DigitalOcean › Droplet › Resize, CPU and RAM only).
3. **Backups:** turn on DigitalOcean droplet backups (step 8 adds a daily database dump too).
4. **Local repo:** run `npm run test:review`, then `git push`. The server pulls from GitHub.

## 1. User, folders and code

```bash
# A user for the app, without a login shell
adduser --system --group --home /var/www/sparefit.progryss.com sparefit

cd /var/www/sparefit.progryss.com
rm -rf html                                   # the test hello.js
mkdir -p /var/lib/sparefit/storage            # import uploads, backups and reports (kept outside the code)
chown -R sparefit:sparefit /var/www/sparefit.progryss.com /var/lib/sparefit
```

The repository is private. Give the server read access with a deploy key:

```bash
sudo -u sparefit ssh-keygen -t ed25519 -N "" -f /var/www/sparefit.progryss.com/.ssh/id_ed25519
cat /var/www/sparefit.progryss.com/.ssh/id_ed25519.pub
# GitHub › progryss/SpareFit-Parts-Finder › Settings › Deploy keys › Add (read only)

sudo -u sparefit git clone git@github.com:progryss/SpareFit-Parts-Finder.git /var/www/sparefit.progryss.com/app
```

The code now lives in `/var/www/sparefit.progryss.com/app`.

## 2. Database

Choose a strong password (letters and digits only, so it needs no escaping in the URL).

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE sparefit LOGIN PASSWORD 'CHOOSE_A_PASSWORD';
CREATE DATABASE sparefit OWNER sparefit;
SQL
```

The `sparefit` role owns its database, so migrations and the job queue (pg-boss creates its own schema) work. Postgres listens on localhost only; nothing else changes.

## 3. Environment file

Create `/var/www/sparefit.progryss.com/app/.env` (owner-only):

```bash
sudo -u sparefit touch /var/www/sparefit.progryss.com/app/.env
chmod 600 /var/www/sparefit.progryss.com/app/.env
sudo -u sparefit nano /var/www/sparefit.progryss.com/app/.env
```

Contents. One `KEY=value` per line, **no quotes and no spaces around `=`** (systemd reads this file):

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3006

# Shopify (production app: Partner Dashboard › SpareFit › Client credentials)
SHOPIFY_API_KEY=<client id, same as client_id in shopify.app.toml>
SHOPIFY_API_SECRET=<client secret>
SHOPIFY_APP_URL=https://sparefit.progryss.com
SCOPES=read_products,write_app_proxy,read_themes,write_files
SHOPIFY_APP_HANDLE=sparefit

# Database. The server's Postgres allows 100 connections for all apps together:
# keep SpareFit's pool small (web 10 + worker 10).
DATABASE_URL=postgresql://sparefit:CHOOSE_A_PASSWORD@localhost:5432/sparefit?connection_limit=10
PROXY_MAX_QUERIES=6

# Files on this server's disk
STORAGE_DRIVER=local
STORAGE_DIR=/var/lib/sparefit/storage

# Jobs run in the separate worker service
JOBS_INLINE=false

# Backoffice (/backoffice). Password 12+ characters.
BACKOFFICE_EMAIL=<your email>
BACKOFFICE_PASSWORD=<a long password>

# Public landing page links
PRIVACY_POLICY_URL=<public privacy policy URL>
APP_STORE_URL=<App Store listing URL, once approved>
```

Leave these out in production: `SHOPIFY_BILLING_TEST` (it's ignored in production anyway), `JOBS_SCHEDULES`, `PGBOSS_SCHEMA` and `TUNNEL_URL`. Optional: `LOG_SLOW_MS` (default 3000).

There is no `SUPPORT_EMAIL` or `HELP_CENTER_URL` setting: in-app support is the live chat (`app/components/SupportChat.tsx`).

## 4. Install, build and migrate

```bash
cd /var/www/sparefit.progryss.com/app
sudo -u sparefit npm ci          # all dependencies: the build needs vite, the worker runs with tsx
sudo -u sparefit npm run build
sudo -u sparefit npm run setup   # prisma generate + migrate deploy (Prisma reads .env itself)
```

`npm run setup` applies every migration to the new database. It never resets data. (Never run `prisma migrate reset` or `prisma migrate dev` on the server.)

## 5. systemd services

`/etc/systemd/system/sparefit-web.service`:

```ini
[Unit]
Description=SpareFit web
After=network.target postgresql.service
Requires=postgresql.service

[Service]
User=sparefit
Group=sparefit
WorkingDirectory=/var/www/sparefit.progryss.com/app
EnvironmentFile=/var/www/sparefit.progryss.com/app/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/sparefit-worker.service`: the same file with these two lines changed:

```ini
Description=SpareFit worker
ExecStart=/usr/bin/npm run worker
```

Start both:

```bash
systemctl daemon-reload
systemctl enable --now sparefit-web sparefit-worker
systemctl status sparefit-web sparefit-worker --no-pager
curl -sI http://127.0.0.1:3006/ | head -1      # HTTP/1.1 200 OK
```

## 6. nginx

Replace the `location /` block in `/etc/nginx/sites-available/sparefit.progryss.com`, and drop `www.` (the app has one URL; Shopify uses only `SHOPIFY_APP_URL`). The 443 server block becomes:

```nginx
server {
    server_name sparefit.progryss.com;

    # CSV uploads go through the app (local storage): the app allows up to 100 MB
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
        # Delete all, Remove duplicates and field changes run in the request
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        # Uploads stream straight to the app
        proxy_request_buffering off;
    }

    listen 443 ssl; # managed by Certbot
    listen [::]:443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/sparefit.progryss.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/sparefit.progryss.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot
}
```

In the port-80 block, also change `server_name` to `sparefit.progryss.com` and remove the `www` `if` block. Then:

```bash
nginx -t && systemctl reload nginx
curl -sI https://sparefit.progryss.com/ | head -1     # 200, no longer 502
```

Don't add `X-Frame-Options` or a `Content-Security-Policy` header in nginx: the app sets `frame-ancestors` per shop itself, and a second header would break the app inside the Shopify admin.

## 7. Shopify and the backoffice

1. Open `https://sparefit.progryss.com/backoffice`, sign in, and set the real plans. **Keep one plan marked Free** (the review notes rely on it). Then enter exactly the same plans and prices in the Partner Dashboard listing.
2. On your Mac: `npm run config:check`, then `npm run deploy:prod`. This releases the app config, webhooks, app proxy and theme extension to the production app. Afterwards, `npm run config:which` must still say the dev config.
3. Install the production app on a development store and open it: onboarding should appear, and `Backoffice › Stores` should list the store.

## 8. Daily database backup

`/etc/cron.d/sparefit-backup`:

```cron
# Daily dump at 02:30, kept 14 days
30 2 * * * postgres pg_dump -Fc sparefit > /var/backups/sparefit-$(date +\%F).dump && find /var/backups -name 'sparefit-*.dump' -mtime +14 -delete
```

Imported files live in `/var/lib/sparefit/storage`; the DigitalOcean droplet backup covers them. To restore a dump: `pg_restore -d sparefit --clean /var/backups/sparefit-<date>.dump` (with both services stopped).

## 9. Updating later

```bash
cd /var/www/sparefit.progryss.com/app
sudo -u sparefit git pull
sudo -u sparefit npm ci
sudo -u sparefit npm run build
sudo -u sparefit npm run setup
systemctl restart sparefit-web sparefit-worker
```

Server first; then `npm run deploy:prod` from your Mac, only when a TOML file or `extensions/` changed (README › Release).

## 10. Checks and logs

| Check | Command or place |
| --- | --- |
| Services running | `systemctl status sparefit-web sparefit-worker` |
| App output | `journalctl -u sparefit-web -f` and `journalctl -u sparefit-worker -f` |
| Errors, warnings, slow requests | `https://sparefit.progryss.com/backoffice/logs` |
| Jobs running (imports, catalog sync) | an import in the app reaches "Done"; worker log shows the job |
| Memory | `free -h`; `systemctl status` shows each service's memory |
| Disk for uploads | `du -sh /var/lib/sparefit/storage` |
| Certificate | `certbot certificates` (renews automatically) |
