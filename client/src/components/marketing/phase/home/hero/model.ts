import { SAMPLE } from "../../../sample";

/** Pure data and maths behind the hero stage. All money is integer fils (1 AED = 100 fils). */

export const VAT_RATE_PERCENT = 5;

export function toFils(aed: number): number {
  return Math.round(aed * 100);
}

/** 5% VAT on a net amount, rounded half up, in integer fils. */
export function vatOnNet(netFils: number): number {
  return Math.floor((netFils * VAT_RATE_PERCENT + 50) / 100);
}

/** The VAT already inside a VAT-inclusive amount, in integer fils. */
export function vatInGross(grossFils: number): number {
  return Math.floor(
    (grossFils * VAT_RATE_PERCENT + (100 + VAT_RATE_PERCENT) / 2) / (100 + VAT_RATE_PERCENT)
  );
}

/** "18,500.00": Western digits and grouping in both languages. */
export function formatFils(fils: number): string {
  const negative = fils < 0;
  const abs = Math.abs(Math.round(fils));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

const SAMPLE_INVOICE = SAMPLE.invoices[0];
/** The sample invoice total is VAT inclusive; the net is what the two lines add up to. */
const NET_FILS = Math.round((toFils(SAMPLE_INVOICE.total) * 100) / (100 + VAT_RATE_PERCENT));
const LINE_ONE_FILS = 1_200_000;

export const INVOICE = (() => {
  const lines = [
    { key: "hxHeroInvLine1", netFils: LINE_ONE_FILS },
    { key: "hxHeroInvLine2", netFils: NET_FILS - LINE_ONE_FILS },
  ] as const;
  const netFils = lines.reduce((sum, line) => sum + line.netFils, 0);
  const vatFils = vatOnNet(netFils);
  return {
    number: SAMPLE_INVOICE.number,
    lines,
    netFils,
    vatFils,
    totalFils: netFils + vatFils,
  };
})();

const RECEIPT_GROSS_FILS = toFils(Math.abs(SAMPLE.bankLines[1].amount));
export const RECEIPT = {
  grossFils: RECEIPT_GROSS_FILS,
  vatFils: vatInGross(RECEIPT_GROSS_FILS),
};

/** The VAT 201 payable figure shown on the tile, in AED. */
export const VAT_PAYABLE_AED = SAMPLE.vatPayable;

export const STATUS_KEYS = [
  "hxHeroStDraft",
  "hxHeroStValidated",
  "hxHeroStSent",
  "hxHeroStDelivered",
] as const;

export interface HeroFrame {
  /** Milliseconds from the start of the loop. */
  at: number;
  /** 0 shell, 1 invoice, 3 receipt, 4 expense row, 5 VAT tile (cumulative). */
  step: number;
  /** The invoice is shown in the other language. */
  flip: boolean;
  /** Index into STATUS_KEYS. */
  status: number;
}

export const LOOP_MS = 12_000;

export const FRAMES: readonly HeroFrame[] = [
  { at: 0, step: 0, flip: false, status: 0 },
  { at: 700, step: 1, flip: false, status: 0 },
  { at: 2700, step: 1, flip: true, status: 0 },
  { at: 4500, step: 1, flip: false, status: 0 },
  { at: 5000, step: 1, flip: false, status: 1 },
  { at: 5900, step: 1, flip: false, status: 2 },
  { at: 6800, step: 3, flip: false, status: 3 },
  { at: 8300, step: 4, flip: false, status: 3 },
  { at: 9300, step: 5, flip: false, status: 3 },
];

/** Reduced motion and no IntersectionObserver: everything visible, Delivered, final VAT figure. */
export const FINAL_FRAME: HeroFrame = { at: 9300, step: 5, flip: false, status: 3 };
