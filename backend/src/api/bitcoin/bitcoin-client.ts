import config from '../../config';
const bitcoin = require('../../rpc-api/index');
import { BitcoinRpcCredentials } from './bitcoin-api-abstract-factory';

const nodeRpcCredentials: BitcoinRpcCredentials = {
  host: config.CORE_RPC.HOST,
  port: config.CORE_RPC.PORT,
  user: config.CORE_RPC.USERNAME,
  pass: config.CORE_RPC.PASSWORD,
  timeout: config.CORE_RPC.TIMEOUT,
  cookie: config.CORE_RPC.COOKIE ? config.CORE_RPC.COOKIE_PATH : undefined,
};

const client = new bitcoin.Client(nodeRpcCredentials);

/*
 * WojakCoin compatibility layer.
 *
 * WojakCore is an older pre-SegWit Bitcoin Core fork, so its RPC signatures
 * differ from what modern mempool expects:
 *   - `getblock`'s 2nd arg is a BOOLEAN `verbose` (true/false). There is no
 *     integer verbosity, and no verbosity=2 (full tx objects).
 *   - `getrawtransaction`'s 2nd arg is an INTEGER `verbose` (0/1); it rejects
 *     booleans with "JSON value is not an integer as expected".
 *   - `getblock` responses lack SegWit-era fields (weight, strippedsize,
 *     versionHex, nTx) that downstream code reads.
 *
 * We translate at the single client chokepoint so the rest of mempool is
 * unchanged. verbosity=2 is emulated by fetching each tx individually — cheap
 * here because WojakCoin blocks are tiny.
 */

const rawGetBlock = client.getBlock.bind(client);
const rawGetRawTransaction = client.getRawTransaction.bind(client);
const rawGetRawMemPool = client.getRawMemPool.bind(client);

// WojakCore's verbose mempool entries use the old flat shape
// ({size, fee, modifiedfee, descendantfees, ...}); normalize to the modern
// MempoolEntry shape mempool expects ({vsize, weight, fees: {base, ...}}).
// Pre-SegWit: vsize === size and weight === size * 4.
function normalizeMempoolEntry(e: any): any {
  if (!e || typeof e !== 'object' || e.fees) {
    return e; // already modern shape (or empty)
  }
  const size = e.size ?? e.vsize ?? 0;
  return {
    vsize: e.vsize ?? size,
    weight: e.weight ?? size * 4,
    time: e.time,
    height: e.height,
    descendantcount: e.descendantcount ?? 1,
    descendantsize: e.descendantsize ?? size,
    ancestorcount: e.ancestorcount ?? 1,
    ancestorsize: e.ancestorsize ?? size,
    wtxid: e.wtxid ?? undefined,
    fees: {
      base: e.fee ?? 0,
      modified: e.modifiedfee ?? e.fee ?? 0,
      // old Core reports descendant/ancestor fees in satoshis
      ancestor: e.ancestorfees != null ? e.ancestorfees / 1e8 : (e.fee ?? 0),
      descendant: e.descendantfees != null ? e.descendantfees / 1e8 : (e.modifiedfee ?? e.fee ?? 0),
    },
    depends: e.depends ?? [],
    spentby: e.spentby ?? [],
    'bip125-replaceable': e['bip125-replaceable'] ?? false,
  };
}

function addMissingBlockFields(block: any): any {
  if (block && typeof block === 'object') {
    if (block.weight == null && block.size != null) { block.weight = block.size * 4; }
    if (block.strippedsize == null && block.size != null) { block.strippedsize = block.size; }
    if (block.versionHex == null && block.version != null) { block.versionHex = (block.version >>> 0).toString(16).padStart(8, '0'); }
    if (block.nTx == null && Array.isArray(block.tx)) { block.nTx = block.tx.length; }
  }
  return block;
}

// Normalize getrawtransaction's verbose flag to an integer for WojakCore.
client.getRawTransaction = function (txid: string, verbose?: boolean | number, blockhash?: string): Promise<any> {
  let v: number;
  if (typeof verbose === 'boolean') {
    v = verbose ? 1 : 0;
  } else if (verbose === undefined || verbose === null) {
    v = 0;
  } else {
    v = verbose;
  }
  if (blockhash !== undefined) {
    return rawGetRawTransaction(txid, v, blockhash);
  }
  return rawGetRawTransaction(txid, v);
};

// Translate getblock's integer verbosity to WojakCore's boolean verbose,
// emulating verbosity=2 (full tx objects) when requested.
client.getBlock = async function (hash: string, verbosity?: number): Promise<any> {
  if (verbosity === 0) {
    return rawGetBlock(hash, false); // raw hex
  }
  const block = addMissingBlockFields(await rawGetBlock(hash, true));
  if (verbosity === 2 && Array.isArray(block.tx) && typeof block.tx[0] === 'string') {
    const txids: string[] = block.tx;
    const txs: any[] = [];
    for (const txid of txids) {
      txs.push(await client.getRawTransaction(txid, 1));
    }
    block.tx = txs;
  }
  return block;
};

// Normalize verbose `getrawmempool true` entries to the modern shape.
client.getRawMemPool = async function (verbose?: boolean): Promise<any> {
  const result = await rawGetRawMemPool(verbose);
  if (verbose && result && typeof result === 'object' && !Array.isArray(result)) {
    for (const txid of Object.keys(result)) {
      result[txid] = normalizeMempoolEntry(result[txid]);
    }
  }
  return result;
};

// WojakCore has no `getmempoolentry`; derive it from the verbose mempool.
client.getMempoolEntry = async function (txid: string): Promise<any> {
  const verboseMempool = await rawGetRawMemPool(true);
  if (verboseMempool && verboseMempool[txid]) {
    return normalizeMempoolEntry(verboseMempool[txid]);
  }
  throw new Error('Transaction not in mempool');
};

export default client;

