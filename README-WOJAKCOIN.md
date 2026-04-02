# Wojakcoin mempool explorer

This repository is a fork of [mempool](https://github.com/mempool/mempool) configured for **Wojakcoin** using:

- **WojakCore** JSON-RPC (default `rpcport` **20760** in `wojakcoin.conf`)
- **wjk-electrs** (e.g. `/root/wjk-electrs`) Electrum protocol on **50005** — see `--electrum-rpc-addr` in `start-electrs.sh`
- Optionally **electrumx-wojakcoin** on TCP **50101** instead of electrs — set `ELECTRUM_PORT` accordingly

## Architecture

| Service | Role |
|--------|------|
| WojakCore | Mempool, blocks, `getrawtransaction`, `validateaddress`, fee estimates |
| wjk-electrs (or ElectrumX) | Electrum methods for address / scripthash history used when `MEMPOOL.BACKEND` is `electrum` |

The backend uses **`MEMPOOL.BACKEND`: `electrum`**: Electrum talks to electrs; Bitcoin-compatible RPC calls still go to WojakCore.

## Chain / UI notes

- Wojakcoin mainnet uses **P2PKH addresses starting with `W`** and **P2SH with `3`** (same script version byte as Bitcoin). This fork adjusts the mainnet address matcher accordingly and disables bech32 `bc1` matching for mainnet (WojakCore here has no native segwit).
- The large-unit ticker is set via **`NATIVE_ASSET_SYMBOL`** (`WJK` in `production/mempool-frontend-config.wojakcoin.json`); amounts under 1 WJK still show as **sats**.

## WojakCore RPC compatibility

WojakCore predates several Bitcoin Core RPC details. Set **`"MEMPOOL": { "LEGACY_GETBLOCK": true }`** in `mempool-config.json` so that:

- `getblock` uses boolean verbose (and builds “verbosity 2” blocks via `getblock … true` + `getrawtransaction` per tx).
- `getrawtransaction` uses integer `0`/`1` instead of boolean.
- `getblockstats` is missing on older nodes; the backend falls back to **computed** per-block stats when the RPC returns “Method not found”.

## One-command start (local)

From the repo root, after `backend/mempool-config.json` is configured:

```bash
chmod +x ./start-wojakcoin.sh   # once
./start-wojakcoin.sh
```

This installs npm dependencies on first run, builds the backend if needed, starts the API on **:8999**, and runs the Angular dev server (proxies `/api` to the backend). Override **`FRONTEND_PORT`** (default `4200`) or **`SKIP_INSTALL=1`** if dependencies are already installed.

If you see **`Cannot find module 'rxjs'`** from Angular, the frontend `node_modules` is incomplete (e.g. only `rxjs/dist/`). Remove it and reinstall: `cd frontend && rm -rf node_modules && npm ci`. The start script auto-repairs this when `require('rxjs')` fails.

To run the dev UI **without** `npm run ng`, from `frontend/` (with API on **8999**):

```bash
CI=true NG_CLI_ANALYTICS=false NODE_OPTIONS=--max-old-space-size=8192 node ./node_modules/@angular/cli/bin/ng.js serve -c wojakcoin --host 127.0.0.1 --port 4200
```

If **`ng serve` hangs or asks about a port**, another dev server is probably using that port. Stop it (`pkill -f 'ng.js serve'`) or use another `--port`. The repo `start-wojakcoin.sh` scans upward from `FRONTEND_PORT` for a free port automatically.

If you see **`EADDRINUSE :::8999`**, a mempool backend is already running. `start-wojakcoin.sh` reuses a healthy API on **8999** and only starts a new Node process when nothing responds there. To restart the backend, stop the old process first (e.g. find it with `ss -tlnp | grep 8999` or `pkill -f 'mempool-wojakcoin/backend'`).

## Quick start (local backend, no Docker)

1. Run **WojakCore** with `txindex=1` (recommended for full explorer behavior) and RPC enabled.
2. Run **wjk-electrs** with `--electrum-rpc-addr` reachable at `127.0.0.1:50005` and `--daemon-rpc-addr` pointing at WojakCore.
3. Copy and edit backend config:

   ```bash
   cp production/mempool-config.wojakcoin.sample.json backend/mempool-config.json
   # Edit CORE_RPC and ELECTRUM to match your host; set DATABASE_* if using MariaDB.
   ```

4. Install and run the backend (see `backend/README.md`):

   ```bash
   cd backend && npm ci && npm run start
   ```

5. Build the frontend with Wojakcoin settings:

   ```bash
   chmod +x scripts/build-wojakcoin-frontend.sh
   ./scripts/build-wojakcoin-frontend.sh
   ```

   Serve `frontend/dist/mempool` with nginx or your static host, proxying `/api/` to the backend (port **8999** by default).

## Docker

Stock **`mempool/frontend:latest`** does not include this fork’s frontend changes. Build a local image:

```bash
chmod +x scripts/docker-build-wojakcoin-frontend.sh
./scripts/docker-build-wojakcoin-frontend.sh
```

In `docker/docker-compose.wojakcoin.yml`, change the `web` service `image` from `mempool/frontend:latest` to **`wojak-mempool-frontend:latest`**.

RPC credentials for the API container:

```bash
cd docker
cp .env.wojakcoin.example .env
# Edit .env — variables WOJAK_RPC_USER / WOJAK_RPC_PASSWORD
docker compose --env-file .env -f docker-compose.wojakcoin.yml up -d
```

Containers reach your host’s WojakCore and electrs via **`host.docker.internal`** (Linux Docker 20.10+ with `extra_hosts` as in the compose file).

## ElectrumX instead of wjk-electrs

If you use **electrumx-wojakcoin** (`SERVICES=tcp://:50101` in `run-wojakcoin.sh`):

- Set **`ELECTRUM_PORT`** to **50101** (and host as appropriate).
- Keep WojakCore RPC in **`CORE_RPC`**; the mempool backend still requires the node for mempool and raw transactions.

## Pushing your fork

Add your GitHub remote and push:

```bash
git remote add wojak git@github.com:YOUR_USER/mempool-wojakcoin.git
git push -u wojak master
```

Upstream updates: `git fetch origin && git merge origin/master` (resolve conflicts as needed).
