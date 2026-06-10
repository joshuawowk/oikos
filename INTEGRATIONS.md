# Household integrations (Grocy Kitchen + Sure Finance)

This branch layers two federation integrations on top of upstream Yuvomi (formerly Oikos) v0.68.3,
deployed on t630 via read-only bind-mounts (no image rebuild):

## Grocy Kitchen (`modules/grocy-kitchen` + `custom/grocy.js`)
- Replaces the native Kitchen (Meals/Recipes/Shopping) with a single Grocy-backed Kitchen module
  (tabs: Stock · Shopping · Recipes · Meal Plan · Products). Grocy stays the single source of
  truth so grocy-android and Barcode Buddy keep working.
- `custom/grocy.js` — server-side proxy at `/api/v1/grocy` (behind Yuvomi auth+CSRF; the Grocy
  API key never reaches the browser). Env: `GROCY_URL`, `GROCY_API_KEY`.
- `custom/router.js` / `custom/kitchen-tabs.js` — rebased onto 0.68.3: legacy `/meals`, `/recipes`,
  `/shopping` routes redirect to `/m/grocy-kitchen?tab=…`; the Kitchen nav button points at the module.

## Sure Finance (`modules/sure-finance` + `custom/sure.js`)
- New Finance module (tabs: Overview · Accounts · Transactions) backed by a running Sure server
  (joshuawowk/sure, a Maybe Finance fork). Net worth / assets / liabilities cards, account list,
  paginated + searchable transactions with add/edit/delete, and a one-click account sync.
- `custom/sure.js` — server-side proxy at `/api/v1/sure` (allow-list, key injected server-side,
  sends `X-Forwarded-Proto: https` because Sure runs with `RAILS_ASSUME_SSL=true`).
  Env: `SURE_URL`, `SURE_API_KEY` (create the key in Sure with scopes `["read_write"]`).

## Core wiring
- `custom/index.js` — upstream `server/index.js` (0.68.3) + 4 lines: import + mount of the two proxies.
- `docker-compose.yml` — image pinned to `ghcr.io/ulsklyc/yuvomi:0.68.3`, the five `custom/`
  bind-mounts, and `BACKUP_DIR` hardcoded to `/backups` (upstream 0.67.6 fix).

## Upgrading upstream
Re-base `custom/index.js`, `custom/router.js`, `custom/kitchen-tabs.js` onto the new upstream
files (the deltas are small and commented with "Grocy Kitchen integration" / sure mounts),
bump the image tag, and re-run the E2E suites before deploying.
