import { describe, it, expect } from "vitest";
import { csvCell, csvLine, isExcludedColumn, resolveExportSpecs, findUncoveredChildren } from "../../server/services/company-export";

describe("CSV cells", () => {
  it("defuses formulas but leaves numbers alone", () => {
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvCell("+971500000000")).toBe("'+971500000000");
    expect(csvCell("-cmd|' /C calc'!A0")).toBe("'-cmd|' /C calc'!A0");
    expect(csvCell("@evil")).toBe("'@evil");
    expect(csvCell("-1234.50")).toBe("-1234.50");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("12.00")).toBe("12.00");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell('Acme, "LLC"')).toBe('"Acme, ""LLC"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
  it("joins a line with CRLF", () => {
    expect(csvLine(["a", "b,c", null])).toBe('a,"b,c",\r\n');
  });
});

describe("secret columns", () => {
  it.each(["password_hash", "api_key", "key_hash", "access_token", "portal_access_token", "refresh_token", "client_secret", "webhook_secret", "private_key", "otp_code", "token_encrypted", "image_data"])(
    "%s is never exported",
    (col) => expect(isExcludedColumn(col)).toBe(true)
  );
  it.each(["company_id", "name", "trn_number", "total", "bill_number", "iban", "created_at"])("%s is exported", (col) => expect(isExcludedColumn(col)).toBe(false));
});

describe("export plan", () => {
  const companyTables = ["accounts", "invoices", "sales_orders", "projects", "time_entries", "custom_field_values", "payment_links", "api_keys", "bank_connections", "payment_gateway_connections", "webhook_endpoints", "company_users", "stored_files"];
  const existing = new Set([...companyTables, "invoice_lines", "journal_lines", "journal_entries", "sales_order_lines"]);
  const plan = resolveExportSpecs(companyTables, existing);
  const names = plan.map((t) => t.name);

  it("exports every company table that is not denylisted, new ones included", () => {
    for (const t of ["sales_orders", "projects", "time_entries", "custom_field_values", "payment_links", "accounts", "invoices"]) expect(names, t).toContain(t);
    expect(resolveExportSpecs([...companyTables, "brand_new_table"], existing).map((t) => t.name)).toContain("brand_new_table");
  });
  it("never exports credential-bearing tables", () => {
    for (const banned of ["api_keys", "bank_connections", "payment_gateway_connections", "webhook_endpoints", "users", "refresh_sessions", "user_totp", "idempotency_keys"]) {
      expect(names, banned).not.toContain(banned);
    }
  });
  it("filters every table by company", () => {
    for (const t of plan) expect(t.where, t.name).toMatch(/\$1/);
  });
  it("joins child tables through their parent's company", () => {
    const lines = plan.find((t) => t.name === "sales_order_lines")!;
    expect(lines.from).toMatch(/JOIN sales_orders p/);
    expect(lines.where).toBe("p.company_id = $1");
  });
  it("flags a child table nobody classified", () => {
    expect(findUncoveredChildren(["invoice_lines", "webhook_deliveries", "shiny_new_lines"])).toEqual(["shiny_new_lines"]);
  });
});
