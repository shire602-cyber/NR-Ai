/**
 * Report delivery subscription titles, for notification display.
 *
 * The shell (notification bell) must not import the 34 KB report catalog just to localise the
 * title of a report-delivery notification. The catalog registers its subscriptions here when it
 * is evaluated (any report screen), and the shell asks for the catalog lazily the first time a
 * delivery title needs localising.
 */
interface TitleEntry {
  id: string;
  title: string;
}

let byTitle: Map<string, string> | null = null;
let loading: Promise<unknown> | null = null;

export function registerDeliverySubscriptions(subscriptions: readonly TitleEntry[]): void {
  byTitle = new Map(subscriptions.map((s) => [s.title, s.id]));
}

/** Subscription id for an English catalog title, or undefined while the catalog is not loaded. */
export function deliverySubscriptionIdForTitle(title: string): string | undefined {
  if (!byTitle && !loading) {
    loading = import("@/lib/reportCatalog").catch(() => undefined);
  }
  return byTitle?.get(title);
}
