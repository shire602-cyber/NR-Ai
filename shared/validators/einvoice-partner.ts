import { z } from "zod";

export const acceptPartnerTermsBody = z.object({
  expectedProvider: z.string().min(1),
  termsVersion: z.string().min(1),
  accepted: z.literal(true),
});

export const confirmEmaraTaxAppointmentBody = z.object({
  expectedProvider: z.string().min(1),
  expectedAcceptanceRevision: z.iso.datetime({ precision: 3 }),
  confirmed: z.literal(true),
});

export type AcceptPartnerTermsBody = z.infer<typeof acceptPartnerTermsBody>;
export type ConfirmEmaraTaxAppointmentBody = z.infer<typeof confirmEmaraTaxAppointmentBody>;
