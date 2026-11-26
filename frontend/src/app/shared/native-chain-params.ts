/**
 * WojakCoin consensus (matches WojakCoin Core GetBlockSubsidy + nSubsidyHalvingInterval).
 * @see https://github.com/wojakcoinproj/wojakcore — src/main.cpp, src/chainparams.cpp
 */
export const NATIVE_SUBSIDY_HALVING_INTERVAL = 210_000;

/** Expected block time (ms); mainnet nPowTargetSpacing = 2 minutes in WojakCoin Core */
export const NATIVE_EXPECTED_BLOCK_TIME_MS = 2 * 60 * 1000;

/** Initial subsidy before first halving: 100 WJK per block */
export const NATIVE_INITIAL_SUBSIDY_SATS = 100 * 100_000_000;

/**
 * Approximate max supply (2× Bitcoin’s 21M cap: double initial subsidy, same schedule).
 */
export const NATIVE_MAX_SUPPLY_COINS = 2 * 20999999.9769;

/** Subsidy after the next halving boundary (used by difficulty “New subsidy” UI). */
export function nativeNextHalvingSubsidySats(currentHeight: number): number {
  const halvings = Math.floor(currentHeight / NATIVE_SUBSIDY_HALVING_INTERVAL) + 1;
  if (halvings >= 64) {
    return 0;
  }
  return Number(BigInt(NATIVE_INITIAL_SUBSIDY_SATS) >> BigInt(halvings));
}
