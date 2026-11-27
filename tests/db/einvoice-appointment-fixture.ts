import type { Tenant } from "./harness";

export async function recordTestAppointment(tenant: Tenant, provider: string) {
  const { acceptPartnerTerms, confirmEmaraTaxAppointment, eInvoicePartner } =
    await import("../../server/services/einvoice-appointment.service");
  const userId = tenant.user.id;
  const accepted = await acceptPartnerTerms({
    companyId: tenant.company.id,
    partner: eInvoicePartner(provider),
    userId,
  });
  const confirmed = await confirmEmaraTaxAppointment({ accepted, userId });
  if (!confirmed) throw new Error("Could not confirm the test appointment");
}
