# Grocy Kitchen — a Grocy-backed Kitchen for Oikos

Replaces Oikos's native Kitchen (Meals / Recipes / Shopping) with a single Kitchen
module backed by a real [Grocy](https://grocy.info) server. Grocy stays the single
source of truth, so **grocy-android**, Barcode Buddy and every other Grocy add-on
keep working — Oikos becomes the family-facing pane of glass.

**Tabs:** Stock · Shopping · Recipes · Meal Plan · Products

| Tab | What you can do |
|---|---|
| Stock | View stock, purchase/add, consume, open, inventory-correct |
| Shopping | Multiple shopping lists, add/check/delete items, add-missing-from-recipes, clear |
| Recipes | CRUD recipes + ingredients, fulfillment check, consume, add missing to list |
| Meal Plan | Weekly plan CRUD backed by Grocy's meal_plan |
| Products | CRUD products, locations, quantity units, product groups |

## How it works

Oikos modules are frontend-only, so the integration has two halves:

1. **`server/routes/grocy.js`** — a server-side proxy mounted at `/api/v1/grocy`.
   It inherits Oikos's global auth + CSRF on `/api/v1` and injects the Grocy API
   key server-side (the key never reaches the browser). No new npm dependencies —
   it uses Node's global `fetch`.
2. **`modules/grocy-kitchen/`** — a standard Oikos module (drop-in folder) that
   renders the five tabs and reuses Oikos's own modal, sub-tabs, html-escape and
   toast helpers, so it looks and feels native.

Three tiny core-file changes fold it into the existing Kitchen navigation:

| File | Change |
|---|---|
| `server/index.js` | 2 lines: import + `app.use('/api/v1/grocy', grocyRouter)` |
| `public/router.js` | redirect legacy `/meals` · `/recipes` · `/shopping` routes to `/m/grocy-kitchen?tab=…` |
| `public/utils/kitchen-tabs.js` | Kitchen nav button targets the module route |

Diffs for the core files are in [`patches/`](patches/).

## Requirements

- A running Grocy server (tested with Grocy 4.x) reachable from the Oikos container
- A Grocy API key (Grocy → user menu → *Manage API keys*; use a dedicated key)
- Two env vars on Oikos: `GROCY_URL`, `GROCY_API_KEY` (optional `GROCY_TIMEOUT_MS`)

> If Oikos and Grocy are on different Docker networks, point `GROCY_URL` at the
> host IP + published port (e.g. `http://192.168.1.10:9283`), not the container name.

## Install

### Method A — run this branch from source (or build your own image)

Everything is already integrated in-tree on this branch:

```bash
git clone -b feat/grocy-kitchen https://github.com/joshuawowk/oikos
cd oikos
cp .env.example .env        # set GROCY_URL + GROCY_API_KEY (and the usual secrets)
docker compose up -d --build   # or: npm install && npm start
```

### Method B — overlay a stock Oikos image (no rebuild)

For existing deployments of the prebuilt image. Bind-mounts the proxy, the three
patched core files and the module over `/app/...` via `docker-compose.override.yml`:

```bash
git clone -b feat/grocy-kitchen https://github.com/joshuawowk/oikos
cd oikos/integrations/grocy-kitchen
./install.sh /docker/oikos        # path to YOUR stack dir (with docker-compose.yml)
```

Then set `GROCY_URL` + `GROCY_API_KEY` in the stack's `.env` and `docker compose up -d`.
The script backs up anything it replaces (`*.bak.<timestamp>`; module backups go to
`module-backups/`, never inside `modules/`).

**Version caveat:** the pre-patched core files match the upstream commit this branch
is based on. If your image is significantly newer, use Method C for the core files.

### Method C — apply the patches to a newer tree

Apply the three diffs to your tree, then copy in the two self-contained pieces:

```bash
git apply integrations/grocy-kitchen/patches/server-index.js.patch
git apply integrations/grocy-kitchen/patches/public-router.js.patch
git apply integrations/grocy-kitchen/patches/public-utils-kitchen-tabs.js.patch
cp <this-branch>/server/routes/grocy.js   server/routes/grocy.js
cp -r <this-branch>/modules/grocy-kitchen modules/grocy-kitchen
```

The three diffs are small and commented; if a patch doesn't apply cleanly the
intent is easy to re-create by hand.

## Uninstall (Method B)

```bash
cd /docker/oikos
rm docker-compose.override.yml          # drops all overlay mounts
rm -rf modules/grocy-kitchen custom/{grocy.js,index.js,router.js,kitchen-tabs.js}
docker compose up -d
```

Oikos's native Kitchen returns; Grocy is untouched.

## Notes & limitations

- The proxy also exposes `/chores` endpoints (`GET /chores`, `POST /chores/:id/execute`)
  for future use; chores/batteries/equipment have no UI tab yet.
- Labels are English-only for now (not wired into Oikos i18n).
- Row actions use buttons (no swipe gestures).
- The module id is `grocy-kitchen` with `menu.show: false` — it intentionally does
  not add its own nav entry; the existing Kitchen button routes to it.
