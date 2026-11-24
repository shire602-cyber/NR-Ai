/** UNCL4461 payment means accepted as the company default. */
export const EINVOICE_SETTINGS_PAYMENT_MEANS_CODES = [
  "1",
  "10",
  "20",
  "30",
  "42",
  "49",
  "54",
  "55",
  "68",
] as const;

export type EInvoiceSettingsPaymentMeansCode =
  (typeof EINVOICE_SETTINGS_PAYMENT_MEANS_CODES)[number];

/** Existing records may carry an unspecified card type, which needs correction before sending. */
export const UNSPECIFIED_CARD_PAYMENT_MEANS_CODE = "48";
