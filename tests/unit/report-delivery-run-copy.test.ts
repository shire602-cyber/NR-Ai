/**
 * F14 integration: server-written report-delivery run errors and handoff sentences come from
 * shared/server-copy templates, so the client can render them in the reader's language.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPORT_DELIVERY_TEMPLATES,
  localizeReportDeliveryText,
  renderServerCopy,
  serverCopyCatalogKey,
} from "../../shared/server-copy";

const load = (loc: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), `client/src/locales/${loc}/components.json`), "utf8")
  ) as Record<string, string>;
const en = load("en");
const ar = load("ar");
const ARABIC = /[؀-ۿ]/;

describe("report delivery run copy", () => {
  it("every template has English and Arabic catalog entries with the same params", () => {
    for (const t of REPORT_DELIVERY_TEMPLATES) {
      const k = serverCopyCatalogKey(t.key);
      expect(en[k], k).toBe(t.en);
      expect(ar[k], k).toMatch(ARABIC);
      const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(params(ar[k]), k).toEqual(params(t.en));
    }
  });

  it("localises run errors and handoff details, including joined per-recipient errors", () => {
    const first = renderServerCopy("reportDelivery.run.recipientFailed", {
      recipient: "a@x.ae",
      reason: "mailbox full",
    });
    const second = renderServerCopy("reportDelivery.run.recipientFailed", {
      recipient: "b@x.ae",
      reason: "rejected",
    });
    const out = localizeReportDeliveryText(`${first}; ${second}`, ar);
    expect(out).toContain("a@x.ae");
    expect(out).toContain("mailbox full");
    expect(out).toMatch(ARABIC);
    expect(out).not.toContain("Delivery to");

    const ready = renderServerCopy("reportDelivery.handoff.reportsReady", { ready: 3, total: 5 });
    expect(ready).toBe("3/5 reports are ready for this delivery.");
    expect(localizeReportDeliveryText(ready, ar)).toMatch(/3\/5/);
    expect(localizeReportDeliveryText(ready, ar)).toMatch(ARABIC);
    expect(localizeReportDeliveryText("Something unknown", ar)).toBe("Something unknown");
  });

  it("the server no longer hand-writes these sentences", () => {
    const delivery = readFileSync(
      join(process.cwd(), "server/services/report-render/delivery.ts"),
      "utf8"
    );
    expect(delivery).not.toMatch(/`\$\{to\}: /);
    expect(delivery).toContain("reportDelivery.run.recipientFailed");
    const svc = readFileSync(
      join(process.cwd(), "server/services/report-delivery.service.ts"),
      "utf8"
    );
    expect(svc).not.toContain('message: "Report delivery has unresolved handoff gaps"');
  });
});
