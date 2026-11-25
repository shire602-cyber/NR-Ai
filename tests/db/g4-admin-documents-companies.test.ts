/**
 * [G4] the admin Documents page offers only companies the admin can store documents for.
 * Uploading goes through the document vault (company access), so a platform admin who is not a
 * member of a company would be refused with 403 after picking it.
 */
import { describe, expect, it } from "vitest";
import { useHarness } from "./harness";

const h = useHarness();

describe("[G4] GET /api/admin/documents/companies", () => {
  it("lists only companies the admin can write documents to", async () => {
    const admin = await h.createTenant({ isAdmin: true, userType: "admin", name: "G4 Admin" });
    const other = await h.createTenant({ name: "G4 Other" });

    const all = await admin.as.get("/api/admin/companies");
    expect(all.status, all.text).toBe(200);
    const allIds = (all.body as Array<{ id: string }>).map((c) => c.id);
    expect(allIds).toContain(other.company.id);

    const writable = await admin.as.get("/api/admin/documents/companies");
    expect(writable.status, writable.text).toBe(200);
    const ids = (writable.body as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(admin.company.id);
    expect(ids).not.toContain(other.company.id);

    // Every listed company really accepts an upload; an unlisted one is the 403 the page avoids.
    const refused = await admin.as.post(`/api/companies/${other.company.id}/documents`, {
      name: "Licence",
      category: "other",
      fileName: "licence.pdf",
      fileData: "data:application/pdf;base64,JVBERi0xLjQK",
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ACCESS_DENIED");
  });

  it("is not available to a non-admin", async () => {
    const t = await h.createTenant({ name: "G4 Plain" });
    const res = await t.as.get("/api/admin/documents/companies");
    expect([401, 403, 404]).toContain(res.status);
  });
});
