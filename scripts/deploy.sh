#!/usr/bin/env bash
# SpareFit server update: pull the pushed code and run only the steps the change needs.
# Guide: .claude/launch/deploy-server.md › Updating later.
#
#   sudo bash scripts/deploy.sh             pull and deploy (skips steps nothing needs)
#   sudo bash scripts/deploy.sh --dry-run   show what would run, change nothing
#   sudo bash scripts/deploy.sh --force     run every step even without new commits
#
# What it decides from the files changed since the running version:
#   package.json / package-lock.json        → npm ci (+ prisma generate)
#   prisma/schema.prisma                    → prisma generate
#   prisma/migrations/ (and pending in DB)  → prisma migrate deploy
#   app code, config, public files          → npm run build
#   anything the processes run              → pm2 restart web + worker
#   only docs, .claude/, extensions/, TOML  → nothing on the server (theme/config: deploy:prod on your Mac)
#
# Safety: one run at a time (lock); stops if the server copy has local edits; the build runs
# before migrations and restart, and a failed build puts the previous code and build back, so the
# live app keeps working. Migrations are never rolled back (Prisma has no down migrations).
set -Eeuo pipefail

# The pull below can replace this file while bash is still reading it: run from a copy.
if [ -z "${SPAREFIT_DEPLOY_COPY:-}" ]; then
  copy=$(mktemp /tmp/sparefit-deploy.XXXXXX)
  cp "$0" "$copy"
  SPAREFIT_DEPLOY_COPY="$copy" exec bash "$copy" "$@"
fi
trap 'rm -f "$SPAREFIT_DEPLOY_COPY"' EXIT

APP_DIR="${APP_DIR:-/var/www/sparefit.progryss.com/html}"
APP_USER="${APP_USER:-sparefit}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3006}"
PM2_WEB="${PM2_WEB:-sparefit-web}"
PM2_WORKER="${PM2_WORKER:-sparefit-worker}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT}/}"
LOCK="${LOCK:-/tmp/sparefit-deploy.lock}"

DRY=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --force) FORCE=1 ;;
    -h | --help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --dry-run, --force or --help)" >&2
      exit 2
      ;;
  esac
done

# ---------- output ----------
if [ -t 1 ]; then
  B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' D=$'\e[2m' N=$'\e[0m'
else
  B="" G="" Y="" R="" D="" N=""
fi
START=$(date +%s)
step() { echo; echo "${B}▶ $*${N}"; }
ok() { echo "  ${G}✓${N} $*"; }
skip() { echo "  ${D}– skip: $*${N}"; }
warn() { echo "  ${Y}!${N} $*"; }
fail() {
  echo
  echo "${R}✗ $*${N}" >&2
  exit 1
}
SUMMARY=()
note() { SUMMARY+=("$1"); }

# Run a command as the app user (or directly when already that user, e.g. a local test).
as_app() {
  if [ "$(id -un)" = "$APP_USER" ]; then
    "$@"
  else
    sudo -u "$APP_USER" -H "$@"
  fi
}
run() {
  echo "  ${D}\$ $*${N}"
  if [ "$DRY" = 1 ]; then return 0; fi
  "$@"
}
run_app() {
  echo "  ${D}\$ ($APP_USER) $*${N}"
  if [ "$DRY" = 1 ]; then return 0; fi
  (cd "$APP_DIR" && as_app "$@")
}

# ---------- checks ----------
step "Checks"
[ -d "$APP_DIR/.git" ] || fail "$APP_DIR is not a git checkout."
cd "$APP_DIR"
[ -f .env ] || fail "$APP_DIR/.env is missing (deploy-server.md › Step 3)."
command -v pm2 >/dev/null || fail "pm2 is not installed."
id "$APP_USER" >/dev/null 2>&1 || fail "User $APP_USER doesn't exist."
if [ "$(id -u)" != 0 ] && [ "$(id -un)" != "$APP_USER" ]; then
  fail "Run as root (sudo bash scripts/deploy.sh)."
fi

exec 9>"$LOCK"
flock -n 9 || fail "Another deploy is running (lock $LOCK)."

# Git as root works on the app user's files (deploy-server.md › Step 1).
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$APP_DIR" ||
  git config --global --add safe.directory "$APP_DIR"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git status --short --untracked-files=no
  fail "The server copy has local changes. Commit them in the repo instead, or discard them: git -C $APP_DIR checkout -- ."
fi
ok "checkout clean, .env present, pm2 found"

# ---------- pull ----------
step "Pull $BRANCH"
OLD=$(git rev-parse HEAD)
git fetch --quiet origin "$BRANCH"
NEW=$(git rev-parse "origin/$BRANCH")

if [ "$OLD" = "$NEW" ] && [ "$FORCE" = 0 ]; then
  ok "already up to date ($(git log -1 --format='%h %s' "$OLD"))"
  echo "  Nothing to deploy. Use --force to run every step anyway."
  exit 0
fi
if ! git merge-base --is-ancestor "$OLD" "$NEW"; then
  fail "origin/$BRANCH doesn't continue the running version $OLD (history rewritten?). Check by hand."
fi

if [ "$OLD" != "$NEW" ]; then
  echo "  ${OLD:0:7} → ${NEW:0:7}"
  git log --format='    %h %s' "$OLD..$NEW" | head -20
  CHANGED=$(git diff --name-only "$OLD" "$NEW")
else
  CHANGED=""
fi

changed() { printf '%s\n' "$CHANGED" | grep -Eq "$1"; }

# ---------- plan ----------
DEPS=0 GENERATE=0 BUILD=0 RESTART=0 MIGRATE=0 CHECK_DB=0 MAC=0
if [ "$FORCE" = 1 ]; then
  DEPS=1 GENERATE=1 BUILD=1 RESTART=1 CHECK_DB=1
else
  changed '^prisma/migrations/' && CHECK_DB=1
  changed '^(package\.json|package-lock\.json)$' && DEPS=1
  changed '^prisma/schema\.prisma$' && GENERATE=1
  # Files the server runs or builds from: everything except docs, Claude files, the theme
  # extension and its sources, and the app TOML files (released from the Mac).
  RUNTIME=$(printf '%s\n' "$CHANGED" | grep -Ev '^(\.claude/|extensions/|storefront-src/|shopify\.app.*\.toml$|shopify\.web\.toml$|.*\.md$|\.github/|\.vscode/|$)' || true)
  [ -n "$RUNTIME" ] && BUILD=1 && RESTART=1
  [ "$DEPS" = 1 ] && GENERATE=1 && BUILD=1 && RESTART=1
fi
changed '^(extensions/|shopify\.app\.toml$)' && MAC=1

step "Plan"
[ "$DEPS" = 1 ] && echo "  • install dependencies (npm ci)" || skip "dependencies unchanged"
[ "$GENERATE" = 1 ] && echo "  • prisma generate" || skip "database schema unchanged"
[ "$BUILD" = 1 ] && echo "  • build the app" || skip "no app code changed"
[ "$CHECK_DB" = 1 ] && echo "  • migrations: new ones in the code, applied after the build if the database lacks them" || skip "no new migrations"
[ "$RESTART" = 1 ] && echo "  • restart $PM2_WEB and $PM2_WORKER" || skip "nothing the processes run changed"
if [ "$DRY" = 1 ]; then
  echo
  echo "${Y}Dry run: the code was fetched but not pulled; nothing changed.${N}"
  exit 0
fi

# ---------- rollback on a failed step before the restart ----------
BACKUP=""
rollback() {
  local code=$?
  trap - ERR
  echo
  echo "${R}✗ Failed. Putting the previous version back (${OLD:0:7}).${N}" >&2
  git reset --quiet --hard "$OLD" || true
  chown -R "$APP_USER:$APP_USER" "$APP_DIR" 2>/dev/null || true
  if [ "$DEPS" = 1 ]; then
    (cd "$APP_DIR" && as_app npm ci --no-audit --no-fund && as_app npx prisma generate) || true
  fi
  if [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
    rm -rf "$APP_DIR/build" && mv "$BACKUP" "$APP_DIR/build"
  fi
  echo "${Y}The running app was not restarted and still serves ${OLD:0:7}. Fix the error above, push, and run the script again.${N}" >&2
  exit "$code"
}
trap rollback ERR

# ---------- pull for real ----------
if [ "$OLD" != "$NEW" ]; then
  git merge --quiet --ff-only "$NEW"
  ok "code at ${NEW:0:7}"
fi
[ "$(id -u)" = 0 ] && chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------- install ----------
if [ "$DEPS" = 1 ]; then
  step "Install dependencies"
  run_app npm ci --no-audit --no-fund
  note "dependencies installed"
fi

if [ "$GENERATE" = 1 ]; then
  step "Prisma client"
  run_app npx prisma generate
  note "prisma client generated"
fi

# ---------- build (keeps the previous build until it succeeds) ----------
if [ "$BUILD" = 1 ]; then
  step "Build"
  if [ -d build ]; then
    BACKUP="$APP_DIR/.build-previous"
    rm -rf "$BACKUP"
    cp -a build "$BACKUP"
  fi
  run_app npm run build
  [ -f build/server/index.js ] || false
  note "app built"
fi

# ---------- migrations (only when the database has pending ones) ----------
if [ "$CHECK_DB" = 1 ]; then
  step "Migrations"
fi
if [ "$CHECK_DB" = 0 ]; then
  :
elif (cd "$APP_DIR" && as_app npx prisma migrate status >/dev/null 2>&1); then
  skip "database is up to date"
else
  # status also fails when the database can't be reached: deploy then says why.
  run_app npx prisma migrate deploy
  MIGRATE=1
  RESTART=1
  note "migrations applied"
fi

trap - ERR

# ---------- restart ----------
if [ "$RESTART" = 1 ]; then
  step "Restart"
  run pm2 restart "$PM2_WEB" "$PM2_WORKER" --update-env
  run pm2 save --force
  note "processes restarted"

  step "Health check"
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)
    [ "$code" = 200 ] && break
    sleep 1
  done
  if [ "$code" != 200 ]; then
    pm2 logs "$PM2_WEB" --lines 30 --nostream || true
    fail "$HEALTH_URL answers ${code:-nothing} after 30 s. See the log above; previous version: git -C $APP_DIR reset --hard $OLD, then run this script with --force."
  fi
  ok "$HEALTH_URL → 200"
  worker=$(pm2 jlist 2>/dev/null | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const p = JSON.parse(s || "[]").find((x) => x.name === process.argv[1]);
      console.log(p ? p.pm2_env.status : "missing");
    });' "$PM2_WORKER" || echo unknown)
  [ "$worker" = online ] && ok "$PM2_WORKER online" || warn "$PM2_WORKER status: $worker (pm2 logs $PM2_WORKER)"
fi

rm -rf "$APP_DIR/.build-previous"

# ---------- summary ----------
step "Done in $(($(date +%s) - START)) s — running ${NEW:0:7}"
if [ ${#SUMMARY[@]} = 0 ]; then
  echo "  No server step was needed (only docs or theme/config files changed)."
else
  for s in "${SUMMARY[@]}"; do ok "$s"; done
fi
if [ "$MAC" = 1 ]; then
  echo
  warn "Theme extension or shopify.app.toml changed: run ${B}npm run deploy:prod${N} on your Mac to release them."
fi
