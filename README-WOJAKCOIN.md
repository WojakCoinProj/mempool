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
