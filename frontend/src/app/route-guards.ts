import { Injectable, inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlMatchResult, UrlMatcher, UrlSegment, UrlTree } from '@angular/router';
import { NavigationService } from '@app/services/navigation.service';

/**
 * canMatch runs while a navigation is in progress; Router.url is often still the *previous* URL.
 * Use the in-flight navigation target so / ↔ /mining (and /graphs) resolve the correct child route.
 */

/** First path segment for URLs owned by GraphsRoutingModule (inside BitcoinGraphsModule). */
const BITCOIN_GRAPHS_FIRST_SEGMENT = new Set<string>([
  'mining',
  'graphs',
  'address',
  'wallet',
  'tools',
  'acceleration',
  'mempool-block',
]);
if (typeof window !== 'undefined' && (window as any).__env?.OFFICIAL_MEMPOOL_SPACE) {
  BITCOIN_GRAPHS_FIRST_SEGMENT.add('treasuries');
}

/**
 * Single lazy entry for BitcoinGraphsModule. Matcher must include every top-level path defined in
 * graphs.routing.module.ts, otherwise MasterPageModule wins and has no matching child (e.g. /address/…).
 */
export function bitcoinGraphsShellMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length === 0) {
    return { consumed: [] };
  }
  if (BITCOIN_GRAPHS_FIRST_SEGMENT.has(segments[0].path)) {
    return { consumed: segments.slice(0, 1) };
  }
  return null;
}

/**
 * App-level {@link bitcoinGraphsShellMatcher} strips the first segment (e.g. `address`), so GraphsModule
 * only sees the hash/id segment. Matchers consume that single segment; {@link CanMatchFn} guards decide
 * address vs wallet vs mempool-block using the in-flight URL (see {@link routerNavigationTargetPath}).
 *
 * Important: do not call `inject(Router)` inside {@link UrlMatcher} — it often runs outside the
 * injection context, so path checks must live in `canMatch` guards instead.
 */
export const addressDeepUrlMatcher: UrlMatcher = (segments: UrlSegment[]): UrlMatchResult | null => {
  if (segments.length !== 1) {
    return null;
  }
  return { consumed: segments, posParams: { id: segments[0] } };
};

export const walletDeepUrlMatcher: UrlMatcher = (segments: UrlSegment[]): UrlMatchResult | null => {
  if (segments.length !== 1) {
    return null;
  }
  return { consumed: segments, posParams: { wallet: segments[0] } };
};

export const mempoolBlockDeepUrlMatcher: UrlMatcher = (segments: UrlSegment[]): UrlMatchResult | null => {
  if (segments.length !== 1) {
    return null;
  }
  return { consumed: segments, posParams: { id: segments[0] } };
};

export const addressDeepCanMatch: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  if (segments.length !== 1) {
    return false;
  }
  return routerNavigationTargetPath(inject(Router)).includes('/address/');
};

export const walletDeepCanMatch: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  if (segments.length !== 1) {
    return false;
  }
  return routerNavigationTargetPath(inject(Router)).includes('/wallet/');
};

export const mempoolBlockDeepCanMatch: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  if (segments.length !== 1) {
    return false;
  }
  return routerNavigationTargetPath(inject(Router)).includes('/mempool-block/');
};

export function routerNavigationTargetPath(router: Router): string {
  const nav = router.getCurrentNavigation();
  if (nav) {
    const tree: UrlTree | undefined = nav.extractedUrl ?? nav.finalUrl ?? undefined;
    if (tree) {
      const serialized = router.serializeUrl(tree);
      const q = serialized.indexOf('?');
      return (q >= 0 ? serialized.slice(0, q) : serialized) || '/';
    }
  }
  const u = router.url;
  const q = u.indexOf('?');
  return q >= 0 ? u.slice(0, q) : u;
}

@Injectable({
  providedIn: 'root'
})
class GuardService {
  constructor(
    private router: Router,
    private navigationService: NavigationService,
  ) {}

  trackerGuard(route: Route, segments: UrlSegment[]): boolean {
    const preferredRoute = this.router.getCurrentNavigation()?.extractedUrl.queryParams?.mode;
    const path = this.router.getCurrentNavigation()?.extractedUrl.root.children.primary.segments;
    return (preferredRoute === 'status' || (preferredRoute !== 'details' && this.navigationService.isInitialLoad())) && window.innerWidth <= 767.98 && !(path.length === 2 && ['push', 'test', 'preview'].includes(path[1].path));
  }
}

export const TrackerGuard: CanMatchFn = (route: Route, segments: UrlSegment[]): boolean => {
  return inject(GuardService).trackerGuard(route, segments);
};

/** GraphsModule is lazy-loaded under app route `mining` (remainder empty) — show mining dashboard, not the home dashboard. */
export const MiningDashboardRootGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  if (segments.length) {
    return false;
  }
  const path = routerNavigationTargetPath(inject(Router));
  return /(^|\/)(en\/)?mining\/?$/.test(path);
};

/** Pool page when lazy parent is `mining` (remainder is pool/:slug, not mining/pool/:slug). */
export const MiningPoolDeepGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  if (segments.length < 2 || segments[0].path !== 'pool') {
    return false;
  }
  return routerNavigationTargetPath(inject(Router)).includes('/mining/pool/');
};

/**
 * Graphs tabs when lazy parent is app route `graphs` (child segments are mempool, mining/...).
 * When loaded from BitcoinGraphs at `/`, the first segment is still `graphs` — use the normal `path: 'graphs'` route instead.
 */
export const GraphsLazyPrefixGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  const path = routerNavigationTargetPath(inject(Router));
  if (!segments.length) {
    return /(^|\/)graphs(\/|$)/.test(path);
  }
  return segments[0].path !== 'graphs';
};
