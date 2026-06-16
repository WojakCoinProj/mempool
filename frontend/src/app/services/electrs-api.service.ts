import { Injectable } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { BehaviorSubject, EMPTY, Observable, catchError, expand, filter, from, map, of, reduce, shareReplay, switchMap, take, tap, throwError } from 'rxjs';
import { Transaction, Address, Outspend, Recent, Asset, ScriptHash, AddressTxSummary, Utxo, AssetRegistryItem } from '@interfaces/electrs.interface';
import { StateService } from '@app/services/state.service';
import { BlockExtended } from '@interfaces/node-api.interface';
import { calcScriptHash$ } from '@app/bitcoin.utils';

@Injectable({
  providedIn: 'root'
})
export class ElectrsApiService {
  private apiBaseUrl: string; // base URL is protocol, hostname, and port
  private apiBasePath: string; // network path is /testnet, etc. or '' for mainnet

  private requestCache = new Map<string, { subject: BehaviorSubject<any>, expiry: number }>;

  constructor(
    private httpClient: HttpClient,
    private stateService: StateService,
  ) {
    this.apiBaseUrl = ''; // use relative URL by default
    if (!stateService.isBrowser) { // except when inside AU SSR process
      this.apiBaseUrl = this.stateService.env.NGINX_PROTOCOL + '://' + this.stateService.env.NGINX_HOSTNAME + ':' + this.stateService.env.NGINX_PORT;
    }
    this.apiBasePath = ''; // assume mainnet by default
    this.stateService.networkChanged$.subscribe((network) => {
      this.apiBasePath = network && network !== this.stateService.env.ROOT_NETWORK ? '/' + network : '';
    });
  }

  private generateCacheKey(functionName: string, params: any[]): string {
    return functionName + JSON.stringify(params);
  }

  // delete expired cache entries
  private cleanExpiredCache(): void {
    this.requestCache.forEach((value, key) => {
      if (value.expiry < Date.now()) {
        this.requestCache.delete(key);
      }
    });
  }

  cachedRequest<T, F extends (...args: any[]) => Observable<T>>(
    apiFunction: F,
    expireAfter: number, // in ms
    ...params: Parameters<F>
  ): Observable<T> {
    this.cleanExpiredCache();

    const cacheKey = this.generateCacheKey(apiFunction.name, params);
    if (!this.requestCache.has(cacheKey)) {
      const subject = new BehaviorSubject<T | null>(null);
      this.requestCache.set(cacheKey, { subject, expiry: Date.now() + expireAfter });

      apiFunction.bind(this)(...params).pipe(
        tap(data => {
          subject.next(data as T);
        }),
        catchError((error) => {
          subject.error(error);
          return of(null);
        }),
        shareReplay(1),
      ).subscribe();
    }

    return this.requestCache.get(cacheKey).subject.asObservable().pipe(filter(val => val !== null), take(1));
  }

  getBlock$(hash: string): Observable<BlockExtended> {
    return this.httpClient.get<BlockExtended>(this.apiBaseUrl + this.apiBasePath + '/api/block/' + hash);
  }

  listBlocks$(height?: number): Observable<BlockExtended[]> {
    return this.httpClient.get<BlockExtended[]>(this.apiBaseUrl + this.apiBasePath + '/api/blocks/' + (height || ''));
  }

  getTransaction$(txId: string): Observable<Transaction> {
    return this.httpClient.get<Transaction>(this.apiBaseUrl + this.apiBasePath + '/api/tx/' + txId);
  }

  getTransactionHex$(txId: string): Observable<string> {
    return this.httpClient.get(this.apiBaseUrl + this.apiBasePath + '/api/tx/' + txId + '/hex', { responseType: 'text' });
  }

  getRecentTransaction$(): Observable<Recent[]> {
    return this.httpClient.get<Recent[]>(this.apiBaseUrl + this.apiBasePath + '/api/mempool/recent');
  }

  getOutspend$(hash: string, vout: number): Observable<Outspend> {
    return this.httpClient.get<Outspend>(this.apiBaseUrl + this.apiBasePath + '/api/tx/' + hash + '/outspend/' + vout);
  }

  getOutspends$(hash: string): Observable<Outspend[]> {
    return this.httpClient.get<Outspend[]>(this.apiBaseUrl + this.apiBasePath + '/api/tx/' + hash + '/outspends');
  }

  getOutspendsBatched$(txids: string[]): Observable<Outspend[][]> {
    let params = new HttpParams();
    params = params.append('txids', txids.join(','));
    return this.httpClient.get<Outspend[][]>(this.apiBaseUrl + this.apiBasePath + '/api/txs/outspends', { params });
  }

  getBlockTransactions$(hash: string, index: number = 0): Observable<Transaction[]> {
    return this.httpClient.get<Transaction[]>(this.apiBaseUrl + this.apiBasePath + '/api/block/' + hash + '/txs/' + index);
  }

  getBlockHashFromHeight$(height: number): Observable<string> {
    return this.httpClient.get(this.apiBaseUrl + this.apiBasePath + '/api/block-height/' + height, {responseType: 'text'});
  }

  getBlockTxId$(hash: string, index: number): Observable<string> {
    return this.httpClient.get(this.apiBaseUrl + this.apiBasePath + '/api/block/' + hash + '/txid/' + index, { responseType: 'text' });
  }

  getAddress$(address: string): Observable<Address> {
    return this.httpClient.get<Address>(this.apiBaseUrl + this.apiBasePath + '/api/address/' + address);
  }

  getPubKeyAddress$(pubkey: string): Observable<Address> {
    const scriptpubkey = (pubkey.length === 130 ? '41' : '21') + pubkey + 'ac';
    return this.getScriptHash$(scriptpubkey).pipe(
      switchMap((scripthash: ScriptHash) => {
        return of({
          ...scripthash,
          address: pubkey,
          is_pubkey: true,
        });
      })
    );
  }

  getScriptHash$(script: string): Observable<ScriptHash> {
    return from(calcScriptHash$(script)).pipe(
      switchMap(scriptHash => this.httpClient.get<ScriptHash>(this.apiBaseUrl + this.apiBasePath + '/api/scripthash/' + scriptHash))
    );
  }

  getAddressTransactions$(address: string,  txid?: string): Observable<Transaction[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return this.httpClient.get<Transaction[]>(this.apiBaseUrl + this.apiBasePath + '/api/address/' + address + '/txs', { params });
  }

  getAddressesTransactions$(addresses: string[], txid?: string): Observable<Transaction[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return this.httpClient.post<Transaction[]>(
      this.apiBaseUrl + this.apiBasePath + '/api/addresses/txs',
      addresses,
      { params }
    );
  }

  getAddressSummary$(address: string,  txid?: string): Observable<AddressTxSummary[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return this.httpClient.get<AddressTxSummary[]>(this.apiBaseUrl + this.apiBasePath + '/api/address/' + address + '/txs/summary', { params }).pipe(
      // Some esplora backends (e.g. WojakCoin's electrs) don't implement the
      // /txs/summary extension. Reconstruct it from the address transactions.
      catchError((err) => (err?.status === 404) ? this.getAddressSummaryFromTxs$(address) : throwError(() => err)),
    );
  }

  // Build an AddressTxSummary[] (newest-first) from the address' transactions by
  // computing each tx's net value change for the address. Used as a fallback
  // when the backend lacks the /txs/summary endpoint.
  private summaryFromTransactions(txs: Transaction[], address: string): AddressTxSummary[] {
    return txs.map((tx) => {
      let value = 0;
      for (const vout of (tx.vout || [])) {
        if (vout.scriptpubkey_address === address) { value += vout.value; }
      }
      for (const vin of (tx.vin || [])) {
        if (vin.prevout && vin.prevout.scriptpubkey_address === address) { value -= vin.prevout.value; }
      }
      return {
        txid: tx.txid,
        value,
        height: tx.status?.block_height ?? 0,
        time: tx.status?.block_time ?? Math.floor(Date.now() / 1000),
      };
    });
  }

  private getAddressSummaryFromTxs$(address: string): Observable<AddressTxSummary[]> {
    const base = this.apiBaseUrl + this.apiBasePath + '/api/address/' + address;
    const mempool$ = this.httpClient.get<Transaction[]>(base + '/txs/mempool').pipe(catchError(() => of([] as Transaction[])));
    let pages = 0;
    const chain$ = this.httpClient.get<Transaction[]>(base + '/txs/chain').pipe(
      expand((txs: Transaction[]) => (txs.length >= 25 && ++pages < 200)
        ? this.httpClient.get<Transaction[]>(base + '/txs/chain/' + txs[txs.length - 1].txid)
        : EMPTY),
      reduce((acc: Transaction[], txs: Transaction[]) => acc.concat(txs), [] as Transaction[]),
    );
    return mempool$.pipe(
      switchMap((memTxs) => chain$.pipe(
        map((chainTxs) => this.summaryFromTransactions([...memTxs, ...chainTxs], address)),
      )),
    );
  }

  getAddressesSummary$(addresses: string[],  txid?: string): Observable<AddressTxSummary[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return this.httpClient.post<AddressTxSummary[]>(this.apiBaseUrl + this.apiBasePath + '/api/addresses/txs/summary', addresses, { params });
  }

  getScriptHashTransactions$(script: string,  txid?: string): Observable<Transaction[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return from(calcScriptHash$(script)).pipe(
      switchMap(scriptHash => this.httpClient.get<Transaction[]>(this.apiBaseUrl + this.apiBasePath + '/api/scripthash/' + scriptHash + '/txs', { params })),
    );
  }

  getScriptHashesTransactions$(scripts: string[],  txid?: string): Observable<Transaction[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return from(Promise.all(scripts.map(script => calcScriptHash$(script)))).pipe(
      switchMap(scriptHashes => this.httpClient.post<Transaction[]>(this.apiBaseUrl + this.apiBasePath + '/api/scripthashes/txs', scriptHashes, { params })),
    );
  }

  getScriptHashSummary$(script: string,  txid?: string): Observable<AddressTxSummary[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return from(calcScriptHash$(script)).pipe(
      switchMap(scriptHash => this.httpClient.get<AddressTxSummary[]>(this.apiBaseUrl + this.apiBasePath + '/api/scripthash/' + scriptHash + '/txs/summary', { params })),
    );
  }

  getAddressUtxos$(address: string): Observable<Utxo[]> {
    return this.httpClient.get<Utxo[]>(this.apiBaseUrl + this.apiBasePath + '/api/address/' + address + '/utxo');
  }

  getScriptHashUtxos$(script: string): Observable<Utxo[]> {
    return from(calcScriptHash$(script)).pipe(
      switchMap(scriptHash => this.httpClient.get<Utxo[]>(this.apiBaseUrl + this.apiBasePath + '/api/scripthash/' + scriptHash + '/utxo')),
    );
  }

  getScriptHashesSummary$(scripts: string[],  txid?: string): Observable<AddressTxSummary[]> {
    let params = new HttpParams();
    if (txid) {
      params = params.append('after_txid', txid);
    }
    return from(Promise.all(scripts.map(script => calcScriptHash$(script)))).pipe(
      switchMap(scriptHashes => this.httpClient.post<AddressTxSummary[]>(this.apiBaseUrl + this.apiBasePath + '/api/scripthashes/txs/summary', scriptHashes, { params })),
    );
  }

  getAsset$(assetId: string): Observable<Asset> {
    return this.httpClient.get<Asset>(this.apiBaseUrl + this.apiBasePath + '/api/asset/' + assetId);
  }

  getLiquidAssetsRegistry$(startIndex: number, limit: number): Observable<HttpResponse<AssetRegistryItem[]>> {
    const params = new HttpParams()
      .set('start_index', startIndex)
      .set('limit', limit)
      .set('sort_field', 'name')
      .set('sort_dir', 'asc');

    return this.httpClient.get<AssetRegistryItem[]>(this.apiBaseUrl + this.apiBasePath + '/api/assets/registry', { params, observe: 'response' });
  }

  getLiquidAssetsRegistrySearch$(query: string): Observable<AssetRegistryItem[]> {
    const params = new HttpParams().set('q', query);
    return this.httpClient.get<AssetRegistryItem[]>(this.apiBaseUrl + this.apiBasePath + '/api/assets/registry/search', { params });
  }

  getLiquidAssetRegistry$(assetId: string): Observable<AssetRegistryItem> {
    return this.httpClient.get<AssetRegistryItem>(this.apiBaseUrl + this.apiBasePath + '/api/assets/registry/' + assetId);
  }

  getAssetTransactions$(assetId: string): Observable<Transaction[]> {
    return this.httpClient.get<Transaction[]>(this.apiBaseUrl + this.apiBasePath + '/api/asset/' + assetId + '/txs');
  }

  getAssetTransactionsFromHash$(assetId: string, txid: string): Observable<Transaction[]> {
    return this.httpClient.get<Transaction[]>(this.apiBaseUrl + this.apiBasePath + '/api/asset/' + assetId + '/txs/chain/' + txid);
  }

  getAddressesByPrefix$(prefix: string): Observable<string[]> {
    if (prefix.toLowerCase().indexOf('bc1') === 0) {
      prefix = prefix.toLowerCase();
    }
    return this.httpClient.get<string[]>(this.apiBaseUrl + this.apiBasePath + '/api/address-prefix/' + prefix);
  }
}
