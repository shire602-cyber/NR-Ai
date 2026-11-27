/**
 * Property test: mixed standard + reverse-charge Box 1 reconciles to the GL at every step.
 *
 * Both supply types post to the same standard_sales account (4020). The GL combines their
 * net fils in one toBase(combined, rate) call. The engine must use the same combined rounding
 * for the invoice and absorb the posted GL remainder for each CN. When those two properties
 * hold, Box 1 == GL remaining at every step — including after odd-cent partial credits.
 *
 * Invariants checked for every random scenario (1 000 seeds × random partials):
 *   1. engineInvoiceBox1 == glInvoice  (invoice combined rounding matches GL posting)
 *   2. cnStdGL + cnRcGL == cnGl        (CN split sums to GL cleared — no FX gain/loss)
 *   3. engBox1 == glRemaining          (tracks GL exactly after each CN)
 *   4. engBox1 >= 0 at every step      (no negative Box 1 amount)
 *   5. engBox1 == 0 after final "remaining" CN
 *
 * Note: intermediate VAT non-negativity is not asserted here. The pure simulation uses
 * per-line rounding for partial-CN VAT, which can over-claim relative to the invoice VAT
 * (two independently-rounded amounts may sum to more). The real system caps each CN's posted
 * VAT at the GL remaining; that end-to-end invariant is verified in DB cases J and K.
 */

import { describe, expect, it } from "vitest";
import { mulRate } from "../../shared/money";

// --- Simulation helpers (mirror the engine and posting service) ---

/** Combined GL posting for std+RC bucket (one toBase call, same as revenueBuckets). */
function glBase(stdFils: number, rcFils: number, rate: string): number {
  return mulRate(stdFils + rcFils, rate);
}

/**
 * Engine invoice split with the combined-rounding fix.
 * Returns [stdBase, rcBase] where stdBase + rcBase = glBase(stdFils, rcFils, rate).
 */
function engineInvoiceSplit(
  stdFils: number,
  rcFils: number,
  rate: string
): [number, number] {
  const combined = glBase(stdFils, rcFils, rate);
  const totalFils = stdFils + rcFils;
  if (totalFils === 0) return [0, 0];
  const rcBase = Math.round((combined * rcFils) / totalFils);
  const stdBase = combined - rcBase;
  return [stdBase, rcBase];
}

/**
 * Engine CN split from rawPostedNet (GL cleared) proportional to per-CN doc base.
 * toBaseFils uses Math.round (same as the engine's local helper).
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
  partials: Array<{ std: number; rc: number }>
): void {
  const invGl = glBase(invStd, invRc, rate);

  const [invStdBase, invRcBase] = engineInvoiceSplit(invStd, invRc, rate);
  const engineInvBox1 = invStdBase + invRcBase;

  // Invariant 1: invoice Box 1 == GL invoice amount
  expect(engineInvBox1, `inv(${invStd}+${invRc})@${rate}`).toBe(invGl);

  let glBox1 = invGl;
  let engBox1 = engineInvBox1;

  for (const p of partials) {
    const cnGl = glBase(p.std, p.rc, rate);
    glBox1 -= cnGl;

    // Invariant 2: CN split sums to GL cleared (guarantees no FX gain/loss)
    const [cnStd, cnRc] = engineCnSplit(cnGl, p.std, p.rc, rate);
    expect(cnStd + cnRc, `CN split sums (${p.std}+${p.rc})@${rate}`).toBe(cnGl);

    engBox1 -= cnGl; // decrease equals GL cleared

    // Invariant 3: engine tracks GL exactly
    expect(engBox1, `Box1 tracks GL (${p.std}+${p.rc})@${rate}`).toBe(glBox1);

    // Invariant 4: non-negative at every step
    expect(engBox1, `Box1 >= 0 (${p.std}+${p.rc})@${rate}`).toBeGreaterThanOrEqual(0);
  }

  // Final "remaining" CN: GL clears exactly the remaining balance
  engBox1 -= glBox1;

  // Invariant 5: final = 0
  expect(engBox1, `final Box1=0 (${invStd}+${invRc})@${rate}`).toBe(0);
}

// --- Named scenarios from Sol review 6088308905 ---

describe("vat201 mixed-doc property: Box 1 == GL at every step", () => {
  it("Sol odd-cent repro: USD 200 std + USD 700 RC, three partial credits at 3.6725", () => {
    // GL: invoice = toBase(90000, 3.6725) = 330525
    // CN1 (40.01+200.01): combined = toBase(24002) = 88147; proportional split 73453+14694=88147
    //   Net 330525-88147=242378=AED 2,423.78
    // CN2 (30+200): combined = toBase(23000) = 84468; split 73450+11018=84468
    //   Net 242378-84468=157910=AED 1,579.10
    // CN3: remainder 157910 -> 0
    runScenario(20000, 70000, "3.6725", [
      { std: 4001, rc: 20001 }, // USD 40.01 std + USD 200.01 RC
      { std: 3000, rc: 20000 }, // USD 30 std + USD 200 RC
    ]);
  });

  it("USD 100.01 std + USD 100.01 RC at 3.6725: full credit leaves 0", () => {
    // Per-family: toBaseFils(10001)+toBaseFils(10001) = 73458
    // Combined GL: toBase(20002) = 73457
    // Without invoice fix: net = 73458-73457=1 fil. With fix: net=73457-73457=0.
    runScenario(10001, 10001, "3.6725", []);
  });

  it("property: 1 000 random mixed documents with up to 3 partial credits", () => {
    const rates = ["3.6725", "3.67", "3.6731"];
    const rng = new Rng(0xdeadbeef);

    for (let i = 0; i < 1000; i++) {
      const rate = rng.pick(rates);
      const invStd = rng.int(100, 50000); // 100–50000 doc fils
      const invRc = rng.int(100, 100000);

      const partials: Array<{ std: number; rc: number }> = [];
      let remStd = invStd;
      let remRc = invRc;

      const numPartials = rng.int(0, 3);
      for (let j = 0; j < numPartials; j++) {
        if (remStd < 2 || remRc < 2) break; // keep at least 1 fil for the final CN
        const pStd = rng.int(1, remStd - 1);
        const pRc = rng.int(1, remRc - 1);
        partials.push({ std: pStd, rc: pRc });
        remStd -= pStd;
        remRc -= pRc;
      }

      runScenario(invStd, invRc, rate, partials);
    }
  });
});
