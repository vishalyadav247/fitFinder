# SpareFit – Parts Finder

A Shopify app that adds a "find products that fit" search (Year / Make / Model style, with any fields) to a store.

Stack: React Router, Polaris web components, Prisma + PostgreSQL, pg-boss jobs, theme app extension.
Specs, prototype and launch docs live in `.claude/` (`.claude/archive/` holds the original proposal and build plan).

## Requirements

- Node.js 22.12 or later
- Docker (local PostgreSQL)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started)

## First-time setup

```bash
npm install                                # install dependencies
cp .env.example .env                       # then fill in the values
docker run --name sparefit-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sparefit \
  -p 5432:5432 -v sparefit-pgdata:/var/lib/postgresql/data -d postgres:16
npm run setup                              # generate Prisma client and apply migrations
npm run config:dev                         # make the dev app the CLI default
```

## Apps and config files

| File                   | App         |
| ---------------------- | ----------- |
| `shopify.app.toml`     | Production  |
| `shopify.app.dev.toml` | Development |

```bash
npm run config:which                       # show the active config
npm run config:dev                         # switch the default to dev (normal state)
npm run config:prod                        # switch the default to production
npm run config:check                       # production TOML filled in and matches dev
npm run info:dev                           # dev app details from Shopify
npm run info:prod                          # production app details from Shopify
npm run deploy:dev                         # release config and extensions to the dev app
npm run deploy:prod                        # release config and extensions to production
```

## Workflow: local → production

### 1. Start

```bash
npm run config:which                       # active app config, must say shopify.app.dev.toml
npm run dev:tunnel                         # starts Postgres, tunnel and the dev app
```

### 2. Work (only when needed)

```bash
npx prisma migrate dev --name <change>     # after editing prisma/schema.prisma
npm run build:theme                        # after editing storefront-src/
```

Scopes / webhooks / app proxy: edit `shopify.app.dev.toml` **and** `shopify.app.toml`.

### 3. Check

```bash
npm run typecheck                          # TypeScript types
npm run lint                               # code style and common mistakes
npm test                                   # unit tests
npm run test:e2e                           # full app on local Postgres
npm run build                              # production build
npm run build:theme -- --check             # storefront assets rebuilt and under size limit
npm run config:check                       # production TOML filled in and matches dev
```

### 4. Commit

```bash
git add -A                                 # stage all changes
git commit -m "<message>"                  # save a commit
git push                                   # send to the remote repo
```

### 5. Release (in this order)

```bash
# 1. deploy the server to production hosting, wait until live (runs migrations)
npm run deploy:prod                        # 2. only if a TOML or extensions/ changed
npm run info:prod                          # 3. check the production app, then open it on a store
```

## Rules

- Keep the CLI default on dev. After `npm run config:prod`, run `npm run config:dev`.
- Server before `deploy:prod`, never the other way round.
- Never edit a committed migration; create a new one.
- The production API secret goes only in the production server's environment, never in a TOML file.
