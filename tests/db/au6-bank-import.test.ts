import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

async function importStatement(csvContent: string) {
  const tenant = await h.createTenant({ name: "AU6 bank import" });
  const path = `/api/companies/${tenant.company.id}/bank-connections`;
  const connection = await tenant.as.post(path, { bankName: "Audit Test Bank" });
  expect(connection.status, connection.text).toBe(201);

  const response = await tenant.as.post(`${path}/${connection.body.id}/import`, { csvContent });
  const saved = await h.sql<{ count: number }>(
    "SELECT count(*)::int AS count FROM bank_transactions WHERE company_id = $1 AND bank_connection_id = $2",
    [tenant.company.id, connection.body.id]
  );
  return { status: response.status, persistedRows: saved[0].count };
}

describe("AU6 manual bank connection CSV import", () => {
  it("imports an unambiguous statement in full", async () => {
    const result = await importStatement(
      "Date,Description,Amount\n2026-03-10,Stationery,-12.50\n2026-03-11,Deposit,100.00"
    );
    expect(result).toEqual({ status: 200, persistedRows: 2 });
  });

  it("asks for the date order before committing an ambiguous statement", async () => {
    const result = await importStatement("Date,Description,Amount\n03/11/2026,Stationery,-12.50");
    expect({
      saved: result.persistedRows,
      needsCorrection: [400, 409, 422].includes(result.status),
    }).toEqual({ saved: 0, needsCorrection: true });
  });

  it("leaves the books untouched when one of two transaction dates is invalid", async () => {
    const result = await importStatement(
      "Date,Description,Amount\n2026-03-10,Stationery,-12.50\n2026-02-30,Deposit,100.00"
    );
    expect({
      saved: result.persistedRows,
      needsCorrection: [400, 409, 422].includes(result.status),
    }).toEqual({ saved: 0, needsCorrection: true });
  });
});
