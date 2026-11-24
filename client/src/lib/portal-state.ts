/** Set when a customer accepts an invitation; the portal dashboard shows a one-time welcome card. */
export const PORTAL_WELCOME_KEY = "muhasib.portalWelcome";

const PORTAL_ACCOUNT_KEY = "muhasib.portalAccount";
const PORTAL_SELECTION_EVENT = "portal:selection";
export const PORTAL_SELECTION_REQUIRED = "none";
let inMemorySelection: string | null = null;
/** The supplier whose removal sent the customer to the chooser (named on the removed page). */
let removedSupplierName: string | null = null;
let selectionWriteFailed = false;

/** null is a first visit. The stored marker means the customer must choose again. */
export function getPortalAccountSelection(): string | null {
  if (selectionWriteFailed) return inMemorySelection;
  try {
    return window.localStorage.getItem(PORTAL_ACCOUNT_KEY);
  } catch {
    return inMemorySelection;
  }
}

export function getSelectedPortalAccount(): string | null {
  const selection = getPortalAccountSelection();
  return selection === PORTAL_SELECTION_REQUIRED ? null : selection;
}

export function getRemovedPortalSupplier(): string | null {
  return removedSupplierName;
}

export function setSelectedPortalAccount(selection: string | null): void {
  inMemorySelection = selection;
  if (selection !== PORTAL_SELECTION_REQUIRED) removedSupplierName = null;
  try {
    if (selection === null) window.localStorage.removeItem(PORTAL_ACCOUNT_KEY);
    else window.localStorage.setItem(PORTAL_ACCOUNT_KEY, selection);
    selectionWriteFailed = false;
  } catch {
    // Keep the selection in this tab if storage is blocked.
    selectionWriteFailed = true;
  }
  window.dispatchEvent(new Event(PORTAL_SELECTION_EVENT));
}

export function subscribeToPortalAccountSelection(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PORTAL_ACCOUNT_KEY || event.key === null) listener();
  };
  window.addEventListener(PORTAL_SELECTION_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(PORTAL_SELECTION_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** An in-flight request for the old supplier cannot clear a newer choice. */
export function clearRevokedPortalSelection(
  requestedSelection: string | null,
  supplierName?: string | null
): void {
  if (
    requestedSelection !== PORTAL_SELECTION_REQUIRED &&
    requestedSelection === getPortalAccountSelection()
  ) {
    setSelectedPortalAccount(PORTAL_SELECTION_REQUIRED);
    removedSupplierName = supplierName || null;
  }
}

export function portalRequestHeaders(
  selection = getPortalAccountSelection()
): Record<string, string> {
  return selection === null ? {} : { "X-Portal-Account": selection };
}
