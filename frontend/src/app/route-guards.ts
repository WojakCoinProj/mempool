import { Injectable, inject } from '@angular/core';
import { CanMatchFn, Route, Router, UrlSegment } from '@angular/router';
import { NavigationService } from '@app/services/navigation.service';

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
  const path = inject(Router).url.split('?')[0];
  return /(^|\/)(en\/)?mining\/?$/.test(path);
};

/** Pool page when lazy parent is `mining` (remainder is pool/:slug, not mining/pool/:slug). */
export const MiningPoolDeepGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  if (segments.length < 2 || segments[0].path !== 'pool') {
    return false;
  }
  return inject(Router).url.includes('/mining/pool/');
};

/**
 * Graphs tabs when lazy parent is app route `graphs` (child segments are mempool, mining/...).
 * When loaded from BitcoinGraphs at `/`, the first segment is still `graphs` — use the normal `path: 'graphs'` route instead.
 */
export const GraphsLazyPrefixGuard: CanMatchFn = (_route: Route, segments: UrlSegment[]): boolean => {
  const path = inject(Router).url.split('?')[0];
  if (!segments.length) {
    return /(^|\/)graphs(\/|$)/.test(path);
  }
  return segments[0].path !== 'graphs';
};
