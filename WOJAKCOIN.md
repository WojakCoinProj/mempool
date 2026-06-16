# WojakCoin Explorer (mempool fork)

A fork of [mempool/mempool](https://github.com/mempool/mempool) adapted to run as a
block explorer for **WojakCoin (WJK)** — a legacy, pre-SegWit Bitcoin Core fork
(P2PKH only, `W`-prefixed addresses, 2-minute blocks, 100 WJK initial subsidy).

The `mainnet` slot is repurposed as WojakCoin, so the rest of mempool stays
largely unchanged.

## Architecture

- **Backend** runs in `esplora` mode:
  - block / mempool / fee data from the local **WojakCore** node RPC
  - address / tx / block data from the WojakCoin esplora API (`https://api.wojakcoin.cash`)
  - indexing data in **MariaDB**
- **Frontend** (Angular) is served against that backend, with esplora paths
  proxied to the WojakCoin esplora.

## Requirements / toolchain

- **Node 22** (Angular CLI rejects newer; build with `node@22`)
- **MariaDB 10.11** (12.x breaks mempool's migrations on a foreign-key `ALTER`)
- Rust toolchain (for `rust-gbt`, built automatically on backend install)
- A synced WojakCore node with `txindex=1`

## Configuration

Copy the sample configs and fill in your node/DB details (these files are
git-ignored so secrets never land in the repo):

```
backend/mempool-config.json        # CORE_RPC -> local WojakCore, BACKEND=esplora, DATABASE -> MariaDB
frontend/mempool-frontend-config.json
```

Key backend settings: `MEMPOOL.NETWORK=mainnet`, `MEMPOOL.BACKEND=esplora`,
`ESPLORA.REST_API_URL=https://api.wojakcoin.cash`, `CORE_RPC` pointing at the
local node, Lightning / Maxmind / fiat / acceleration disabled.

## Run

```sh
# MariaDB
brew services start mariadb@10.11

# backend (:8999)
export PATH="$(brew --prefix node@22)/bin:$HOME/.cargo/bin:$PATH"
cd backend  && npm install && npm run build && npm start

# frontend (:4200) — proxies /api/v1 -> backend, /api -> WojakCoin esplora
cd frontend && npm install && npm run start:local-esplora
```

## WojakCoin-specific changes

- **`backend/src/api/bitcoin/bitcoin-client.ts`** — compatibility shims for the
  old Core RPC: `getblock` verbose is a boolean (verbosity-2 emulated by fetching
  txs), `getrawtransaction` verbose is an integer, `getmempoolentry` derived from
  `getrawmempool true`, and missing block fields (`weight=size*4`, etc.) filled in.
- **`backend/src/api/blocks.ts`** — `$getBlockStats` computed from transactions
  (WojakCore has no `getblockstats`).
- **`backend/src/api/bitcoin/esplora-api.ts`** — `$getRawMempool` handles the
  WojakCoin electrs paginated `/mempool/txids` response.
- **Frontend** — WJK address validation (`regex.utils.ts`, `address-utils.ts`),
  WJK ticker (`amount`/`amount-selector`/`btc` components), title/branding
  (`seo.service.ts`), and correct halving economics (100 WJK initial subsidy,
  210k-block halving, 2-minute blocks, 42M max supply) in `difficulty*` and
  `app.constants.ts`.

## Upstream

Based on mempool/mempool. To pull upstream changes:

```sh
git remote add upstream https://github.com/mempool/mempool.git
git fetch upstream && git merge upstream/master
```
