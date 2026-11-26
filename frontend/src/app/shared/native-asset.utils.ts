/**
 * Native chain unit for non-Liquid networks (from mempool-frontend-config.json → config.js).
 * Default WJK matches this fork; upstream mempool defaults to BTC via config.
 */
export function getNativeAssetSymbol(): string {
  if (typeof window !== 'undefined' && (window as any).__env && (window as any).__env.NATIVE_ASSET_SYMBOL) {
    return String((window as any).__env.NATIVE_ASSET_SYMBOL);
  }
  return 'WJK';
}
