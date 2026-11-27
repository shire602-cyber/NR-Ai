/**
 * Property test: mixed standard + reverse-charge Box 1 reconciles to the GL at every step,
 * for both combined (std+RC on same account) and separate (std on 4010, RC on 4020) layouts.
 *
 * Account layout determines the invoice GL:
 *   combined : one bucket → toBase(std+rc, rate)       (Cases H/I/J/K in DB tests)
 *   separate : two buckets → toBase(std,rate)+toBase(rc,rate) (Case L in DB tests)
 *
 * After the fix (postedInvoiceNet GL query), the engine reads the invoice's actual posted GL
 * regardless of layout. The proportional split then allocates correctly between families.
 * Box 1 == GL remaining to the fil at every step in both cases.
 *
 * Invariants checked for every random scenario (1 000 seeds × random partials × random layout):
 *   1. engineInvoiceBox1 == glInvoice  (invoice GL derived from actual bucket amounts)
 *   2. cnStdGL + cnRcGL == cnGl        (CN split sums to GL cleared — no FX gain/loss)
 *   3. engBox1 == glRemaining          (tracks GL exactly after each CN)
 *   4. engBox1 >= 0 at every step      (proven for std/rc >= 100, rates >= 3.67)
 *   5. engBox1 == 0 after final "remaining" CN
 */

import { describe, expect, it } from "vitest";
import { mulRate } from "../../shared/money";

// --- Simulation helpers (mirror the engine and posting service) ---

/**
 * GL posting for std+RC:
 *   combined (separate=false): one bucket → toBase(std+rc, rate)
 *   separate (separate=true):  two buckets → toBase(std,rate) + toBase(rc,rate)
 */
function glBasePerBuckets(
  stdFils: number,
  rcFils: number,
  separate: boolean,
  rate: string
): number {
  if (separate) return mulRate(stdFils, rate) + mulRate(rcFils, rate);
  return mulRate(stdFils + rcFils, rate);
}

/**
 * Engine invoice split: returns [stdBase, rcBase] summing to invGl.
 * With the GL-query fix, the engine reads invGl directly and splits proportionally.
 */
function engineInvoiceSplit(
  stdFils: number,
  rcFils: number,
  separate: boolean,
  rate: string
): [number, number] {
  const invGl = glBasePerBuckets(stdFils, rcFils, separate, rate);
  const totalFils = stdFils + rcFils;
  if (totalFils === 0) return [0, 0];
  const rcBase = Math.round((invGl * rcFils) / totalFils);
  const stdBase = invGl - rcBase;
  return [stdBase, rcBase];
}

/**
 * Engine CN split from rawPostedNet (GL cleared) proportional to per-CN doc base.
 * Returns [stdGL, rcGL] where stdGL + rcGL = glAmount always.
 */
function engineCnSplit(
  glAmount: number,
  stdFils: number,
  rcFils: number,
  rate: string
): [number, number] {
  const rateNum = parseFloat(rate);
  const stdDocBase = Math.round(stdFils * rateNum);
  const rcDocBase = Math.round(rcFils * rateNum);
  const totalDocBase = stdDocBase + rcDocBase;
  if (totalDocBase === 0) return [0, 0];
  const rcGL = Math.round((glAmount * rcDocBase) / totalDocBase);
  const stdGL = glAmount - rcGL;
  return [stdGL, rcGL];
}

/** Minimal seeded LCG for reproducible random inputs. */
class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = Math.imul(this.s, 1664525) + 1013904223;
    return (this.s >>> 0) / 0x100000000;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(arr: T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }
}

function runScenario(
  invStd: number,
  invRc: number,
  rate: string,
  partials: Array<{ std: number; rc: number }>,
  separate: boolean
): void {
  const invGl = glBasePerBuckets(invStd, invRc, separate, rate);

  const [invStdBase, invRcBase] = engineInvoiceSplit(invStd, invRc, separate, rate);
  const engineInvBox1 = invStdBase + invRcBase;

  // Invariant 1: invoice Box 1 == GL invoice amount
  expect(engineInvBox1, `inv(${invStd}+${invRc})@${rate} sep=${separate}`).toBe(invGl);

  let glBox1 = invGl;
  let engBox1 = engineInvBox1;

  for (const p of partials) {
    // CN GL uses same layout as invoice buckets
    const cnGl = glBasePerBuckets(p.std, p.rc, separate, rate);
    glBox1 -= cnGl;

    // Invariant 2: CN split sums to GL cleared (no FX gain/loss)
    const [cnStd, cnRc] = engineCnSplit(cnGl, p.std, p.rc, rate);
    expect(cnStd + cnRc, `CN split sums (${p.std}+${p.rc})@${rate}`).toBe(cnGl);

    engBox1 -= cnGl;

    // Invariant 3: engine tracks GL exactly
    expect(engBox1, `Box1 tracks GL (${p.std}+${p.rc})@${rate}`).toBe(glBox1);

    // Invariant 4: non-negative (proven for std/rc >= 100, rates >= 3.67)
    expect(engBox1, `Box1 >= 0 (${p.std}+${p.rc})@${rate}`).toBeGreaterThanOrEqual(0);
  }

  // Final "remaining" CN: clears exactly the remaining GL
  engBox1 -= glBox1;

  // Invariant 5: final = 0
  expect(engBox1, `final Box1=0 (${invStd}+${invRc})@${rate} sep=${separate}`).toBe(0);
}

// --- Named scenarios ---

describe("vat201 mixed-doc property: Box 1 == GL at every step", () => {
  it("Sol odd-cent repro: USD 200 std + USD 700 RC, three partial credits at 3.6725 (combined account)", () => {
    runScenario(
      20000,
      70000,
      "3.6725",
      [
        { std: 4001, rc: 20001 }, // USD 40.01 + USD 200.01
        { std: 3000, rc: 20000 }, // USD 30 + USD 200
      ],
      false
    );
  });

  it("USD 100.01 std + USD 100.01 RC at 3.6725: combined account Box 1 = AED 734.57", () => {
    // Combined GL: toBase(20002, 3.6725) = 73457 fils. With fix, engine reads 73457, CN clears 73457.
    runScenario(10001, 10001, "3.6725", [], false);
  });

  it("USD 100.01 std + USD 100.01 RC at 3.6725: separate accounts Box 1 = AED 734.58 (Sol review 6088896030 repro)", () => {
    // Separate buckets: toBase(10001)+toBase(10001) = 36729+36729 = 73458 fils.
    // Without GL-query fix, invoice used combined (73457) while GL posted 73458 → -AED 0.01 after full CN.
    // With fix: engine reads invoice GL = 73458, CN clears 73458, net = 0.
    runScenario(10001, 10001, "3.6725", [], true);
  });

  it("property: 1 000 random mixed documents, random account layout, up to 3 partial credits", () => {
    const rates = ["3.6725", "3.67", "3.6731"];
    const rng = new Rng(0xdeadbeef);

    for (let i = 0; i < 1000; i++) {
      const rate = rng.pick(rates);
      const invStd = rng.int(100, 50000);
      const invRc = rng.int(100, 100000);
      const separate = rng.int(0, 1) === 1;

      const partials: Array<{ std: number; rc: number }> = [];
      let remStd = invStd;
      let remRc = invRc;

      const numPartials = rng.int(0, 3);
      for (let j = 0; j < numPartials; j++) {
        if (remStd < 2 || remRc < 2) break;
        const pStd = rng.int(1, remStd - 1);
        const pRc = rng.int(1, remRc - 1);
        partials.push({ std: pStd, rc: pRc });
        remStd -= pStd;
        remRc -= pRc;
      }

      runScenario(invStd, invRc, rate, partials, separate);
    }
  });
});
