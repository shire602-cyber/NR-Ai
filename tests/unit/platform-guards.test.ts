import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// R17-20: CI guards that stop NEW raw-body mass assignment and NEW direct
// journal writes, ratcheting against committed baselines.

const repo = resolve(__dirname, "../..");
const dirs: string[] = [];

function runScript(script: string, args: string[] = []) {
  const r = spawnSync(process.execPath, [join(repo, "scripts", script), ...args], {
    encoding: "utf8",
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function fixture(files: Record<string, string>, baseline?: object) {
  const root = mkdtempSync(join(tmpdir(), "w1b-guard-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  const baselinePath = join(root, "baseline.json");
  writeFileSync(baselinePath, JSON.stringify(baseline ?? { files: {} }));
  return { root, baselinePath };
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const RAW_BODY_OFFENDER = `
app.patch("/x/:id", async (req, res) => {
  await db.update(things).set(req.body).where(eq(things.id, req.params.id));
  const row = { ...req.body, companyId };
  await storage.updateThing(req.params.id, req.body);
  await db.insert(things).values(req.body);
  const picked = pickAllowed(req.body);
  const data = req.body;
});
`;

describe("R17-20 check-raw-body", () => {
  it("passes on the current tree against the committed baseline", () => {
    const r = runScript("check-raw-body.mjs");
    expect(r.out).toContain("OK");
    expect(r.code).toBe(0);
  });

  it("R17-20: a fixture route trips every raw-body pattern", () => {
    const { root, baselinePath } = fixture({ "server/routes/evil.routes.ts": RAW_BODY_OFFENDER });
    const r = runScript("check-raw-body.mjs", [
      "--root",
      root,
      "--baseline",
      baselinePath,
      "--json",
    ]);
    expect(r.code).toBe(1);
    const result = JSON.parse(r.out.trim().split("\n").pop() as string);
    const patterns = result.regressions.map((x: { pattern: string }) => x.pattern).sort();
    expect(patterns).toEqual([
      "alias-req-body",
      "pick-allowed-no-schema",
      "set-req-body",
      "spread-req-body",
      "storage-write-req-body",
      "values-req-body",
    ]);
  });

  it("a new offender inside an already-baselined file still fails", () => {
    const { root, baselinePath } = fixture(
      {
        "server/routes/a.routes.ts":
          "storage.updateA(id, req.body);\nstorage.updateB(id, req.body);\n",
      },
      { files: { "server/routes/a.routes.ts": { "storage-write-req-body": 1 } } }
    );
    const r = runScript("check-raw-body.mjs", ["--root", root, "--baseline", baselinePath]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1 -> 2");
  });

  it("validated bodies do not trip the guard", () => {
    const { root, baselinePath } = fixture({
      "server/routes/good.routes.ts": `
router.post("/x", strictBody(schema), async (req, res) => {
  const { name } = req.body;
  const parsed = schema.parse(req.body);
  await storage.updateThing(id, parsed);
  pickAllowed(req.body, insertThingSchema);
});`,
    });
    const r = runScript("check-raw-body.mjs", ["--root", root, "--baseline", baselinePath]);
    expect(r.out).toContain("OK");
    expect(r.code).toBe(0);
  });

  it("CL-B: follows imported handlers, so a split-out handler cannot hide a raw body", () => {
    const handler = `
export const handlePostThing = async (req, res) => {
  const { companyId } = req.body;
  res.json({ companyId });
};
export const handleGetThing = async (req, res) => {
  res.json(req.params);
};`;
    const unvalidated = fixture({
      "server/routes/things/handlers.ts": handler,
      "server/routes/things.routes.ts": `
import { handlePostThing } from "./things/handlers";
export function register(app) {
  app.post("/api/thing", authMiddleware, asyncHandler(handlePostThing));
}`,
    });
    const bad = runScript("check-raw-body.mjs", [
      "--root",
      unvalidated.root,
      "--baseline",
      unvalidated.baselinePath,
    ]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("server/routes/things/handlers.ts");
    expect(bad.out).toContain("destructure-req-body");

    const validated = fixture({
      "server/routes/things/handlers.ts": handler,
      "server/routes/things.routes.ts": `
import { handlePostThing } from "./things/handlers";
export function register(app) {
  app.post("/api/thing", authMiddleware, strictBody(thingBody), asyncHandler(handlePostThing));
}`,
    });
    const ok = runScript("check-raw-body.mjs", [
      "--root",
      validated.root,
      "--baseline",
      validated.baselinePath,
    ]);
    expect(ok.out).toContain("OK");
    expect(ok.code).toBe(0);
  });

  it("--update records offenders so the baseline then passes", () => {
    const { root, baselinePath } = fixture({ "server/routes/evil.routes.ts": RAW_BODY_OFFENDER });
    expect(
      runScript("check-raw-body.mjs", ["--root", root, "--baseline", baselinePath, "--update"]).code
    ).toBe(0);
    expect(runScript("check-raw-body.mjs", ["--root", root, "--baseline", baselinePath]).code).toBe(
      0
    );
  });
});

describe("check-ledger-writes", () => {
  it("passes on the current tree against the committed baseline", () => {
    const r = runScript("check-ledger-writes.mjs");
    expect(r.out).toContain("OK");
    expect(r.code).toBe(0);
  });

  it("a fixture route with direct journal writes fails; only server/ledger is exempt", () => {
    const writes = `
await tx.insert(journalEntries).values(entry);
await db.insert(journalLines).values(lines);
await storage.createJournalEntry(entry, lines);
`;
    const { root, baselinePath } = fixture({
      "server/routes/evil.routes.ts": writes,
      "server/ledger/post.ts": writes,
      // WP7: the storage bypass methods are gone, so the storage barrel and the
      // storage ledger module are no longer exempt.
      "server/storage.ts": writes,
      "server/storage/ledger.ts": writes,
      "server/storage/sales.ts": writes,
    });
    const r = runScript("check-ledger-writes.mjs", [
      "--root",
      root,
      "--baseline",
      baselinePath,
      "--json",
    ]);
    expect(r.code).toBe(1);
    const result = JSON.parse(r.out.trim().split("\n").pop() as string);
    expect(new Set(result.regressions.map((x: { file: string }) => x.file))).toEqual(
      new Set([
        "server/routes/evil.routes.ts",
        "server/storage.ts",
        "server/storage/ledger.ts",
        "server/storage/sales.ts",
      ])
    );
    expect(result.regressions).toHaveLength(12);
  });

  it("WP6: deletes, updates, status transitions and raw SQL writes on journal tables fail", () => {
    const writes = `
await db.delete(journalEntries).where(eq(journalEntries.id, id));
await tx.delete(schema.journalLines).where(eq(journalLines.entryId, id));
await db
  .update(journalEntries)
  .set({ status: "draft" });
await tx.update(journalLines).set({ debit: "0" });
await transitionRow(tx, journalEntries, id, "posted", "draft");
await pool.query("DELETE FROM journal_entries WHERE id = $1", [id]);
await db.execute(sql\`update "journal_lines" set debit = 0\`);
await client.query('INSERT INTO public.journal_entries (id) VALUES ($1)', [id]);
await pool.query("TRUNCATE TABLE journal_lines");
`;
    const readsOnly = `
const rows = await db.select().from(journalEntries).where(eq(journalEntries.id, id));
await db.delete(journalTemplates).where(eq(journalTemplates.id, id));
await pool.query("SELECT * FROM journal_entries WHERE id = $1", [id]);
// ON DELETE CASCADE from journal_entries is fine
`;
    const { root, baselinePath } = fixture({
      "server/routes/evil.routes.ts": writes,
      "server/routes/reads.routes.ts": readsOnly,
      "server/ledger/kernel.ts": writes,
    });
    const r = runScript("check-ledger-writes.mjs", [
      "--root",
      root,
      "--baseline",
      baselinePath,
      "--json",
    ]);
    expect(r.code).toBe(1);
    const result = JSON.parse(r.out.trim().split("\n").pop() as string);
    const byPattern = Object.fromEntries(
      result.regressions.map((x: { file: string; pattern: string; now: number }) => [
        `${x.file}#${x.pattern}`,
        x.now,
      ])
    );
    expect(byPattern).toEqual({
      "server/routes/evil.routes.ts#delete-journal-tables": 2,
      "server/routes/evil.routes.ts#update-journal-tables": 2,
      "server/routes/evil.routes.ts#transition-journal-rows": 1,
      "server/routes/evil.routes.ts#raw-sql-journal-write": 4,
    });
  });
});
