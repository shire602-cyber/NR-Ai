// @vitest-environment jsdom
/**
 * J4: write controls follow the signed-in role. Renders the real hook (and the real Backups page)
 * with the access record the server returns from GET /companies/:id/team/me, and checks what a
 * viewer / employee / owner is offered.
 */
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { permissionsForRole, type CompanyRole } from "../../shared/permissions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMPANY = "11111111-1111-4111-8111-111111111111";

vi.mock("@/hooks/useDefaultCompany", () => ({
  useDefaultCompany: () => ({ companyId: COMPANY, company: { id: COMPANY, name: "Co" } }),
}));

import { loadLocale } from "../../client/src/lib/i18n";
import { companyAccessQueryKey } from "../../client/src/lib/auth";
import { useCompanyPermission } from "../../client/src/hooks/useCompanyPermission";
import BackupRestore from "../../client/src/pages/BackupRestore";

let container: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await Promise.all([loadLocale("en"), loadLocale("ar")]);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

function render(role: CompanyRole | null, node: () => ReturnType<typeof createElement>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (role) {
    qc.setQueryData(companyAccessQueryKey(COMPANY), {
      role,
      permissions: permissionsForRole(role),
      grantableRoles: [],
      viaFirmAccess: false,
    });
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(createElement(QueryClientProvider, { client: qc }, node()));
  });
}

function GatedButtons() {
  const { gate } = useCompanyPermission();
  return createElement(
    "div",
    null,
    createElement("button", { "data-testid": "new-invoice", ...gate("documents.write") }, "New"),
    createElement("button", { "data-testid": "post", ...gate("ledger.post") }, "Post"),
    createElement("button", { "data-testid": "upgrade", ...gate("billing.manage") }, "Upgrade")
  );
}

const btn = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;

describe("J4: controls are gated by role", () => {
  it("viewer: every write control is disabled with an explanation", () => {
    render("viewer", () => createElement(GatedButtons));
    for (const id of ["new-invoice", "post", "upgrade"]) {
      expect(btn(id).disabled).toBe(true);
      expect(btn(id).title).toMatch(/role does not allow/i);
    }
  });

  it("employee: can create documents but not post or manage billing", () => {
    render("employee", () => createElement(GatedButtons));
    expect(btn("new-invoice").disabled).toBe(false);
    expect(btn("post").disabled).toBe(true);
    expect(btn("upgrade").disabled).toBe(true);
  });

  it("owner: everything is enabled", () => {
    render("owner", () => createElement(GatedButtons));
    for (const id of ["new-invoice", "post", "upgrade"]) expect(btn(id).disabled).toBe(false);
  });

  it("unknown access (not loaded): nothing is hidden on a guess", () => {
    render(null, () => createElement(GatedButtons));
    expect(btn("post").disabled).toBe(false);
  });
});

describe("J4: a role without backups.manage sees 'no access', not an empty backup list", () => {
  it("viewer: Backups renders the no-access state and no counts or create button", () => {
    render("viewer", () => createElement(BackupRestore));
    expect(container.querySelector('[data-testid="state-backups-no-access"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-create-backup"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Never/);
    expect(container.textContent).toMatch(/don't have access/i);
  });

  it("owner: Backups renders the create button", () => {
    render("owner", () => createElement(BackupRestore));
    expect(container.querySelector('[data-testid="state-backups-no-access"]')).toBeNull();
    expect(container.querySelector('[data-testid="button-create-backup"]')).not.toBeNull();
  });
});
