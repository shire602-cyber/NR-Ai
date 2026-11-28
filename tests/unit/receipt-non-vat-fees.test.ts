import { describe, expect, it } from "vitest";
import { parseReceiptOcrText } from "../../shared/receipt-ocr-parser";
import { reconcileReceiptAmounts } from "../../shared/receipt-amounts";
import { approvedReceiptAmounts } from "../../client/src/lib/receipt-review-amounts";

// Tourism dirham and municipality fees are non-recoverable fees, never VAT. The parser used to read
// "Tourism tax 10.00" as the VAT line and booked 10.00 as input VAT. The fee stays in the net
// expense (subtotal = total - VAT), so subtotal + VAT = total to the fil.
function parse(text: string) {
  const r = parseReceiptOcrText(text, { fallbackDate: "2026-01-01" });
  return {
    subtotal: r.subtotal,
    vat: r.vatAmount,
    total: r.total,
    codes: r.validationIssues.map((i) => i.code).sort(),
    percentage: r.vatPercentage,
  };
}

// Both the server (buildResult runs reconcileReceiptAmounts on these figures) and the client (the
// review form's approvedReceiptAmounts) reject figures that do not add up.
function expectAddsUp(r: ReturnType<typeof parse>) {
  expect(Math.round((r.subtotal + r.vat) * 100)).toBe(Math.round(r.total * 100));
  const server = reconcileReceiptAmounts({
    subtotal: r.subtotal,
    vatAmount: r.vat,
    total: r.total,
    vatPercentage: r.percentage,
  });
  expect(server.mismatch).toBe(false);
  expect(r.codes).not.toContain("AMOUNT_MISMATCH");
  const approved = approvedReceiptAmounts({
    subtotal: r.subtotal,
    vatAmount: r.vat,
    total: r.total,
  });
  expect(approved).toEqual({ net: Math.round(r.subtotal * 100), vat: Math.round(r.vat * 100) });
}

describe("fee lines are never read as VAT", () => {
  it("tourism tax only: 10.00 is not VAT (VAT is worked back from the net and flagged)", () => {
    const r = parse("Grand Hotel\nTourism tax 10.00\nTotal 110.00");
    expect(r.vat).not.toBe(10);
    expect(r.vat).toBe(4.76);
    expect(r.subtotal).toBe(105.24);
    expect(r.total).toBe(110);
    expect(r.codes).toContain("VAT_DERIVED");
    expect(r.codes).toContain("NON_VAT_FEE");
    expectAddsUp(r);
  });

  it("municipality fee only", () => {
    const r = parse("Cafe\nMunicipality fee 10.00\nTotal 110.00");
    expect(r.vat).not.toBe(10);
    expect(r.codes).toContain("NON_VAT_FEE");
    expect(r.codes).toContain("VAT_DERIVED");
    expect(r.total).toBe(110);
    expectAddsUp(r);
  });

  it("VAT + tourism fee + service charge: fees sit on top of the subtotal", () => {
    const r = parse(
      "Grand Hotel\nSubtotal 100.00\nService charge 10.00\nVAT 5% 5.00\nTourism dirham fee 10.00\nTotal 125.00"
    );
    expect(r).toMatchObject({ subtotal: 120, vat: 5, total: 125 });
    expect(r.codes).toEqual(["NON_VAT_FEE"]);
    expectAddsUp(r);
  });

  it("subtotal, VAT, tourism fee, total: the fee is part of the net", () => {
    const r = parse("Hotel\nSubtotal 100\nVAT 5\nTourism fee 10\nTotal 115");
    expect(r).toMatchObject({ subtotal: 110, vat: 5, total: 115 });
    expect(r.codes).toEqual(["NON_VAT_FEE"]);
    expectAddsUp(r);
  });

  it("a VAT line with a tourism line before it keeps the genuine VAT", () => {
    const r = parse("Hotel\nTourism tax 10.00\nVAT 5.00\nTotal 115.00");
    expect(r).toMatchObject({ subtotal: 110, vat: 5, total: 115 });
    expectAddsUp(r);
  });

  it("a fee that does not add up still goes to review", () => {
    const r = parse("Hotel\nSubtotal 100\nVAT 5\nTourism fee 10\nTotal 200");
    expect(r.codes).toContain("AMOUNT_MISMATCH");
  });

  it("abbreviations are fees", () => {
    const m = parse("Hotel\nMunic. tax 4.00\nTDF 15.00\nTotal 119.00");
    expect(m.vat).not.toBe(4);
    expect(m.vat).not.toBe(15);
    expect(m.codes).toContain("NON_VAT_FEE");
    expectAddsUp(m);
  });

  it("a VAT line that mentions a service charge stays a VAT line", () => {
    const r = parse("Cafe\nSubtotal 100\nVAT on service charge 5.00\nTotal 105.00");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 105 });
    expect(r.codes).toEqual([]);
  });

  it("a receipt with no fees is unchanged", () => {
    const r = parse("Cafe\nSubtotal 100\nVAT 5\nTotal 105");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 105 });
    expect(r.codes).toEqual([]);
  });
});

describe("Arabic fee lines are never read as VAT", () => {
  it("municipality tax only", () => {
    const r = parse("فندق\nضريبة البلدية 10.00\nالاجمالي 110.00");
    expect(r.vat).not.toBe(10);
    expect(r).toMatchObject({ subtotal: 105.24, vat: 4.76, total: 110 });
    expect(r.codes).toContain("NON_VAT_FEE");
    expect(r.codes).toContain("VAT_DERIVED");
    expectAddsUp(r);
  });

  it("tourism dirham only, Arabic-Indic digits", () => {
    const r = parse("فندق\nدرهم السياحة ١٠٫٠٠\nالاجمالي ١١٠٫٠٠");
    expect(r.vat).not.toBe(10);
    expect(r.codes).toContain("NON_VAT_FEE");
    expect(r.total).toBe(110);
    expectAddsUp(r);
  });

  it("hotel bill with a VAT line and a tourism dirham line", () => {
    const r = parse(
      "فندق\nالمجموع الفرعي 100.00\nض.ق.م 5.00\nدرهم السياحة 10.00\nرسوم الخدمة 10.00\nالاجمالي 125.00"
    );
    expect(r).toMatchObject({ subtotal: 120, vat: 5, total: 125 });
    expect(r.codes).toEqual(["NON_VAT_FEE"]);
    expectAddsUp(r);
  });

  it("full VAT label with tourism tax", () => {
    const r = parse(
      "فندق\nالمجموع الفرعي 100.00\nضريبة القيمة المضافة 5% 5.00\nضريبة السياحة 10.00\nالاجمالي 115.00"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5, total: 115 });
    expectAddsUp(r);
  });

  it("Arabic hotel bill: service charge and tourism dirham on top of the subtotal", () => {
    const r = parse(
      "فندق\nالمجموع الفرعي 100.00\nرسوم الخدمة 10.00\nضريبة القيمة المضافة 5.50\nدرهم السياحة 10.00\nالاجمالي 125.50"
    );
    expect(r).toMatchObject({ subtotal: 120, vat: 5.5, total: 125.5 });
    expectAddsUp(r);
  });
});

describe("fees are anchored to the start of a line and need an amount", () => {
  it("a product code with TDF in it is not a fee", () => {
    const r = parse("Shop\nItem TDF-200 cable 100.00\nVAT 5.00\nTotal 105.00");
    expect(r).toMatchObject({ subtotal: 100, vat: 5, total: 105, codes: [] });
    expectAddsUp(r);
  });

  it("a sold 'Service fee' item is not the service-charge fee", () => {
    const r = parse(
      "Garage\nCar Service 200.00\nService fee 20.00\nSubtotal 220.00\nVAT 11.00\nTotal 231.00"
    );
    expect(r).toMatchObject({ subtotal: 220, vat: 11, total: 231, codes: [] });
    expectAddsUp(r);
  });

  it("store names and addresses with fee words raise no fee warning and no VAT", () => {
    for (const header of [
      "City Tax Consultants LLC",
      "Opp. Municipality Tax Office",
      "Near Dubai Municipality, Deira",
      "Carrefour City Centre Deira",
    ]) {
      const r = parse(`${header}\nSubtotal 100.00\nVAT 5.00\nTotal 105.00`);
      expect(r.codes, header).not.toContain("NON_VAT_FEE");
      expect(r, header).toMatchObject({ subtotal: 100, vat: 5, total: 105 });
    }
    const pkg = parse("Travel Agency\nTourism package 500.00\nVAT 25.00\nTotal 525.00");
    expect(pkg).toMatchObject({ subtotal: 500, vat: 25, total: 525, codes: [] });
  });

  it("a rate-only service charge line with no amount is not a fee", () => {
    const r = parse("Bar\nSubtotal 100\nSvc chg 10%\nVAT 5.00\nTotal 105.00");
    expect(r.codes).not.toContain("NON_VAT_FEE");
    expect(r).toMatchObject({ vat: 5, total: 105 });
  });
});

describe("a fee already inside the printed figures is not subtracted again", () => {
  it("room 100, tourism dirham 10, VAT 5, total 115 reads like the receipt says", () => {
    const r = parse("Hotel\nRoom 100.00\nTourism dirham 10.00\nVAT 5.00\nTotal 115.00");
    expect(r).toMatchObject({ subtotal: 110, vat: 5, total: 115 });
    expectAddsUp(r);
  });

  it("printed subtotal + VAT = total with a fee line: nothing is subtracted", () => {
    const r = parse("Hotel\nSubtotal 110.00\nTourism dirham 10.00\nVAT 5.00\nTotal 115.00");
    expect(r).toMatchObject({ subtotal: 110, vat: 5, total: 115 });
    expectAddsUp(r);
  });

  it("restaurant: service charge is taxable, VAT on it stays recoverable VAT", () => {
    const r = parse("Restaurant\nFood 100.00\nService charge 10.00\nVAT 5% 5.50\nTotal 115.50");
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5 });
    expectAddsUp(r);
  });

  it("service charge, municipality fee and tourism dirham together", () => {
    const r = parse(
      "Hotel\nRoom 100.00\nService charge 10.00\nMunicipality fee 7.00\nVAT 5.50\nTourism dirham 15.00\nTotal 137.50"
    );
    expect(r).toMatchObject({ subtotal: 132, vat: 5.5, total: 137.5 });
    expectAddsUp(r);
  });
});

describe("VAT printed on a fee line stays VAT", () => {
  it("'Service charge 10% 10.00 VAT 0.50' keeps VAT 0.50 and fee 10.00", () => {
    const r = parse(
      "Restaurant\nSubtotal 100.00\nService charge 10% 10.00 VAT 0.50\nVAT 5.00\nTotal 115.50"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5 });
    expectAddsUp(r);
  });

  it("with no other VAT line the fee-line VAT is the VAT", () => {
    const r = parse("Restaurant\nSubtotal 100.00\nService charge 10% 10.00 VAT 0.50\nTotal 110.50");
    expect(r).toMatchObject({ subtotal: 110, vat: 0.5, total: 110.5 });
    expectAddsUp(r);
  });

  it("the review note does not call VAT on a service charge unrecoverable", () => {
    const r = parseReceiptOcrText("Hotel\nTourism tax 10.00\nTotal 110.00", {
      fallbackDate: "2026-01-01",
    });
    const note = r.validationIssues.find((i) => i.code === "NON_VAT_FEE")!.message;
    expect(note).toMatch(
      /Tourism dirham and municipality fees are not VAT and cannot be recovered/
    );
    expect(note).toMatch(/service charge is not VAT itself, but VAT may be charged on it/i);
  });
});

// Review round 3: every case the reviewer's harnesses (run-r3, run-r4) used, with exact figures.
describe("fee words on lines that carry the total, subtotal or VAT amount", () => {
  const cases: Array<[string, string, number, number, number, string[]]> = [
    [
      "total line that names the service charge",
      "Restaurant\nFood 100.00\nService charge 10.00\nVAT 5.50\nTotal incl service charge 115.50",
      110,
      5.5,
      115.5,
      ["NON_VAT_FEE"],
    ],
    [
      "subtotal line that names the service charge",
      "Restaurant\nSubtotal incl. service charge 110.00\nVAT 5.50\nTotal 115.50",
      110,
      5.5,
      115.5,
      [],
    ],
    [
      "store name with a d and a fee phrase",
      "Grand City Tax Advisors\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
      100,
      5,
      105,
      [],
    ],
    [
      "store name without a d and a fee phrase",
      "City Tax Consultants\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
      100,
      5,
      105,
      [],
    ],
    [
      "address line with a fee phrase and no amount never gives the next line as VAT",
      "Cafe\nBehind Municipality Tax Building\nItem 100.00\nTotal 105.00",
      100,
      5,
      105,
      ["VAT_DERIVED"],
    ],
    [
      "tourism dirham line with a zero VAT amount",
      "Hotel\nRoom 100.00\nTourism dirham 10.00 VAT 0.00\nVAT 5.00\nTotal 115.00",
      110,
      5,
      115,
      ["NON_VAT_FEE"],
    ],
    [
      "tourism dirham with a total only",
      "Hotel\nRoom charge 100.00\nTourism dirham 10.00\nTotal 110.00",
      105.24,
      4.76,
      110,
      ["NON_VAT_FEE", "VAT_DERIVED"],
    ],
    [
      "fee-only receipt",
      "Hotel\nTourism dirham 20.00\nTotal 20.00",
      19.05,
      0.95,
      20,
      ["NON_VAT_FEE", "VAT_DERIVED"],
    ],
    [
      "tourism tax only",
      "Grand Hotel\nTourism tax 10.00\nTotal 110.00",
      105.24,
      4.76,
      110,
      ["NON_VAT_FEE", "VAT_DERIVED"],
    ],
    [
      "municipality tax only in Arabic",
      "فندق\nضريبة البلدية 10.00\nالاجمالي 110.00",
      105.24,
      4.76,
      110,
      ["NON_VAT_FEE", "VAT_DERIVED"],
    ],
    [
      "subtotal, VAT, tourism fee, total",
      "Hotel\nSubtotal 100\nVAT 5\nTourism fee 10\nTotal 115",
      110,
      5,
      115,
      ["NON_VAT_FEE"],
    ],
    [
      "restaurant service charge with a subtotal",
      "Restaurant\nSubtotal 100.00\nService charge 10.00\nVAT 5% 5.50\nTotal 115.50",
      110,
      5.5,
      115.5,
      ["NON_VAT_FEE"],
    ],
    [
      "restaurant service charge without a subtotal",
      "Restaurant\nFood 100.00\nService charge 10.00\nVAT 5% 5.50\nTotal 115.50",
      110,
      5.5,
      115.5,
      ["NON_VAT_FEE"],
    ],
    [
      "a sold service item and service fee product line",
      "Garage\nCar Service 200.00\nService fee 20.00\nSubtotal 220.00\nVAT 11.00\nTotal 231.00",
      220,
      11,
      231,
      [],
    ],
    [
      "tourism package item",
      "Travel Agency\nTourism package 500.00\nVAT 25.00\nTotal 525.00",
      500,
      25,
      525,
      [],
    ],
    [
      "Carrefour City Centre",
      "Carrefour City Centre Deira\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
      100,
      5,
      105,
      [],
    ],
    [
      "TDF inside a product code",
      "Shop\nItem TDF-200 cable 100.00\nVAT 5.00\nTotal 105.00",
      100,
      5,
      105,
      [],
    ],
    [
      "Dubai Municipality address",
      "Cafe\nNear Dubai Municipality, Deira\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
      100,
      5,
      105,
      [],
    ],
    [
      "Municipality Tax Office address",
      "Cafe\nOpp. Municipality Tax Office\nSubtotal 100.00\nVAT 5.00\nTotal 105.00",
      100,
      5,
      105,
      [],
    ],
    [
      "room, service charge, municipality fee, tourism dirham and VAT",
      "Hotel\nRoom 100.00\nService charge 10.00\nMunicipality fee 7.00\nVAT 5.50\nTourism dirham 15.00\nTotal 137.50",
      132,
      5.5,
      137.5,
      ["NON_VAT_FEE"],
    ],
    [
      "Arabic hotel bill",
      "فندق\nالمجموع الفرعي 100.00\nرسوم الخدمة 10.00\nضريبة القيمة المضافة 5.50\nدرهم السياحة 10.00\nالاجمالي 125.50",
      120,
      5.5,
      125.5,
      ["NON_VAT_FEE"],
    ],
    ["no fee", "Cafe\nSubtotal 100\nVAT 5\nTotal 105", 100, 5, 105, []],
  ];
  it.each(cases)("%s", (_name, text, subtotal, vat, total, codes) => {
    const r = parse(text);
    expect(r).toMatchObject({ subtotal, vat, total });
    expect(r.codes).toEqual(codes);
    expectAddsUp(r);
  });

  it("a header with a fee phrase and no amount does not make the next line's number the VAT", () => {
    const r = parse("Grand City Tax Advisors\n100\nSubtotal 100.00\nVAT 5.00\nTotal 105.00");
    expect(r.vat).toBe(5);
  });

  it("a total label naming a fee, with the figure on the next line, is still read", () => {
    const r = parse("Restaurant\nFood 100.00\nVAT 5.00\nTotal incl service charge\n105.00");
    expect(r).toMatchObject({ vat: 5, total: 105 });
  });

  it("'Total VAT 5.50' is the VAT, never the total", () => {
    const r = parse(
      "Restaurant\nFood 100.00\nService charge 10% 10.00 VAT 0.50\nTotal VAT 5.50\nTotal 115.50"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5, codes: ["NON_VAT_FEE"] });
    expectAddsUp(r);
  });
});

describe("VAT on a fee line is never silently added to the VAT line", () => {
  it("the standalone VAT already includes the fee-line VAT: not summed (no subtotal)", () => {
    const r = parse(
      "Restaurant\nFood 100.00\nService charge 10% 10.00 VAT 0.50\nVAT 5.50\nTotal 115.50"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5, codes: ["NON_VAT_FEE"] });
    expectAddsUp(r);
  });

  it("same receipt with the VAT line first", () => {
    const r = parse(
      "Restaurant\nFood 100.00\nVAT 5.50\nService charge 10% 10.00 VAT 0.50\nTotal 115.50"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5, codes: ["NON_VAT_FEE"] });
    expectAddsUp(r);
  });

  it("same receipt with a printed subtotal", () => {
    const r = parse(
      "Restaurant\nSubtotal 100.00\nService charge 10% 10.00 VAT 0.50\nVAT 5.50\nTotal 115.50"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5 });
    expect(r.codes).toEqual(["NON_VAT_FEE"]);
  });

  it("the standalone VAT covers the food only: the fee-line VAT is added because the sum reconciles", () => {
    const r = parse(
      "Restaurant\nFood 100.00\nService charge 10% 10.00 VAT 0.50\nVAT 5.00\nTotal 115.50"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5, codes: ["NON_VAT_FEE"] });
    expectAddsUp(r);
  });

  it("the same receipt in the other order", () => {
    const r = parse(
      "Restaurant\nFood 100.00\nVAT 5.00\nService charge 10% 10.00 VAT 0.50\nTotal 115.50"
    );
    expect(r).toMatchObject({ subtotal: 110, vat: 5.5, total: 115.5, codes: ["NON_VAT_FEE"] });
  });

  it("neither figure fits: the standalone VAT is kept and the receipt is flagged for review", () => {
    const text =
      "Restaurant\nFood 100.00\nService charge 10% 10.00 VAT 0.50\nVAT 5.20\nTotal 115.70";
    const r = parse(text);
    expect(r.vat).toBe(5.2);
    expect(r.codes).toContain("AMOUNT_MISMATCH");
    const full = parseReceiptOcrText(text, { fallbackDate: "2026-01-01" });
    expect(full.validationIssues.find((i) => i.code === "AMOUNT_MISMATCH")!.message).toMatch(
      /fee line.*0\.50.*5\.20/
    );
  });

  it("with no standalone VAT line the fee-line VAT is the VAT", () => {
    const r = parse("Restaurant\nFood 100.00\nService charge 10% 10.00 VAT 0.50\nTotal 110.50");
    expect(r).toMatchObject({ subtotal: 110, vat: 0.5, total: 110.5 });
  });

  it("a VAT-on-service-charge line that is not a fee line is flagged, never silently wrong", () => {
    const r = parse("Cafe\nSubtotal 100\nVAT on service charge 0.50\nVAT 5.00\nTotal 115.50");
    expect(r.codes).toContain("AMOUNT_MISMATCH");
  });
});
