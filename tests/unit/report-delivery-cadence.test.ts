import { expect, it } from "vitest";
import arabicReportCatalog from "../../client/src/locales/ar-catalog/reportCatalog.json";
import { getReportDeliveryPlan } from "../../server/services/report-delivery.service";
import { getReportDeliveryScheduleDecision } from "../../server/services/report-delivery-scheduler.service";

it("preserves the Monday delivery when the saved cadence is the Arabic catalog label", () => {
  const subscriptionId = "owner-weekly-executive-delivery";
  const friday = new Date("2026-11-20T12:00:00.000Z");
  const monday = new Date("2026-11-23T08:00:00.000Z");
  const plan = getReportDeliveryPlan(subscriptionId, friday, [
    {
      subscriptionId,
      enabled: true,
      cadenceOverride:
        arabicReportCatalog["reportCatalog.delivery.owner-weekly-executive-delivery.cadence"],
      channelOverride: null,
      formatOverride: null,
      recipientsOverride: null,
      deliveryGuardrailOverride: null,
      updatedAt: friday,
    },
  ])!;

  expect(plan.nextRunAt).toBe(monday.toISOString());
  expect(getReportDeliveryScheduleDecision(plan, null, monday).shouldQueue).toBe(true);
});
