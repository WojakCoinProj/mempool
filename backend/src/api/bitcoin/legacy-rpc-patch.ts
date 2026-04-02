/**
 * Pre-Bitcoin Core ~0.16 RPC (e.g. Wojakcoin): getblock(hash, 2) is invalid; only boolean verbose is accepted.
 * getrawtransaction second argument must be integer 0/1, not boolean.
 */
import config from '../../config';

const bitcoin = require('../../rpc-api/index');
const Client = bitcoin.Client;

let applied = false;

function applyPatches(): void {
  if (applied) {
    return;
  }
  applied = true;

  const origGetBlock = Client.prototype.getBlock;
  Client.prototype.getBlock = function (hash: string, verbosity?: boolean | number) {
    if (verbosity === 2) {
      return legacyGetBlockVerbose2(this, origGetBlock, hash);
    }
    if (verbosity === 0) {
      return origGetBlock.call(this, hash, false);
    }
    if (verbosity === 1) {
      return origGetBlock.call(this, hash, true);
    }
    // Single-arg getblock(hash) — do not pass undefined or JSON-RPC may send invalid types
    if (verbosity === undefined) {
      return origGetBlock.call(this, hash);
    }
    return origGetBlock.call(this, hash, verbosity);
  };

  const origGetRawTransaction = Client.prototype.getRawTransaction;
  Client.prototype.getRawTransaction = function (txid: string, verbose?: boolean | number, blockhash?: string) {
    let v: boolean | number | undefined = verbose;
    if (verbose === true) {
      v = 1;
    } else if (verbose === false) {
      v = 0;
    }
    if (blockhash !== undefined) {
      return origGetRawTransaction.call(this, txid, v, blockhash);
    }
    return origGetRawTransaction.call(this, txid, v);
  };
}

async function legacyGetBlockVerbose2(client: any, orig: any, hash: string): Promise<any> {
  const block = await orig.call(client, hash, true);
  if (!block || !Array.isArray(block.tx)) {
    return block;
  }
  if (block.tx.length === 0) {
    return block;
  }
  if (typeof block.tx[0] !== 'string') {
    return orig.call(client, hash, 2);
  }
  const txs = await Promise.all(
    block.tx.map((txid: string) => client.getRawTransaction(txid, true))
  );
  return { ...block, tx: txs };
}

if (config.MEMPOOL.LEGACY_GETBLOCK) {
  applyPatches();
}
