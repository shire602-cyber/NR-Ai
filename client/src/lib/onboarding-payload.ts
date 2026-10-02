// What onboarding sends when it updates a company that already exists. A blank TRN means "the user typed nothing",
// never "remove the TRN saved at sign-up or in Company Profile", so it is left out of the update.

export function withoutBlankTrn<T extends { trnVatNumber?: string | null }>(payload: T): Omit<T, "trnVatNumber"> | T {
  if (typeof payload.trnVatNumber === "string" && payload.trnVatNumber.trim() !== "") {
    return { ...payload, trnVatNumber: payload.trnVatNumber.trim() };
  }
  const { trnVatNumber: _blank, ...rest } = payload;
  return rest;
}
