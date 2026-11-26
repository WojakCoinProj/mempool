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
    const doCall = (verbosity === 1)
      ? origGetBlock.call(this, hash, true)
      : (verbosity === undefined)
        ? origGetBlock.call(this, hash)
        : origGetBlock.call(this, hash, verbosity);

    return doCall.then((block: any) => {
      if (block && typeof block === 'object') {
        if (block.weight === undefined && block.size !== undefined) {
          block.weight = block.size * 4;
        }
        if (block.nTx === undefined && Array.isArray(block.tx)) {
          block.nTx = block.tx.length;
        }
        if (block.strippedsize === undefined && block.size !== undefined) {
          block.strippedsize = block.size;
        }
      }
      return block;
    });
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
  // Non-SegWit chains don't return weight/vsize/nTx — synthesize from size/tx array
  if (block.weight === undefined) {
    block.weight = block.size * 4;
  }
  if (block.nTx === undefined) {
    block.nTx = txs.length;
  }
  if (block.strippedsize === undefined) {
    block.strippedsize = block.size;
  }
  for (const tx of txs) {
    if (tx.weight === undefined) {
      tx.weight = (tx.size || 0) * 4;
    }
    if (tx.vsize === undefined) {
      tx.vsize = tx.size || 0;
    }
  }
  return { ...block, tx: txs };
}

if (config.MEMPOOL.LEGACY_GETBLOCK) {
  applyPatches();
}
