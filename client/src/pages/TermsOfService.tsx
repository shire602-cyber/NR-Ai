import { useEffect } from "react";
import { LegalLayout } from "@/components/LegalLayout";
import { messages as pageMessages } from "./TermsOfService.i18n";

export default function TermsOfService() {
  const tr = pageMessages.useT();

  useEffect(() => {
    document.title = tr("termsOfServiceMuhasibAi");
  }, []);

  return (
    <LegalLayout title={tr("termsOfService")} effectiveDate="2026-04-26">
      <p>
        {tr("theseTermsOfService")}
        <strong>{tr("terms")}</strong>
        {tr("governYourAccessToAndUse")} <strong>{tr("service")}</strong>
        {tr("operatedByNajmaAlRaedaAccounting")}
        <strong>"NRA"</strong>, <strong>{tr("we")}</strong>, <strong>{tr("us")}</strong>
        {tr("byCreatingAnAccountOrUsing")}
      </p>

      <h2>{tr("n1Eligibility")}</h2>
      <p>{tr("youMustBeAtLeast18")}</p>

      <h2>{tr("n2AccountsAndSecurity")}</h2>
      <ul>
        <li>{tr("youAreResponsibleForMaintainingThe")}</li>
        <li>
          {tr("youMustNotifyUsImmediatelyOf")}
          <a href="mailto:security@muhasib.ai">security@muhasib.ai</a>.
        </li>
        <li>{tr("youAreResponsibleForAllActivity")}</li>
      </ul>

      <h2>{tr("n3SubscriptionAndBilling")}</h2>
      <p>{tr("paidPlansRenewAutomaticallyAtThe")}</p>

      <h2>{tr("n4AcceptableUse")}</h2>
      <p>{tr("youAgreeNotTo")}</p>
      <ul>
        <li>{tr("useTheServiceForAnyUnlawful")}</li>
        <li>{tr("reverseEngineerDecompileOrAttemptTo")}</li>
        <li>{tr("uploadMaliciousCodeSpamOrContent")}</li>
        <li>{tr("attemptToDisruptTheServiceOr")}</li>
      </ul>

      <h2>{tr("n5YourDataAndContent")}</h2>
      <p>
        {tr("youRetainOwnershipOfAllData")}
        <strong>{tr("customerData")}</strong>
        {tr("youGrantUsALimitedLicence")}
      </p>

      <h2>{tr("n6TaxAndAccountingDisclaimer")}</h2>
      <p>{tr("muhasibAiProvidesSoftwareToolsTo")}</p>

      <h2>{tr("n7ServiceAvailability")}</h2>
      <p>{tr("weStriveToKeepTheService")}</p>

      <h2>{tr("n8IntellectualProperty")}</h2>
      <p>{tr("theServiceIncludingAllSoftwareDesigns")}</p>

      <h2>{tr("n9Termination")}</h2>
      <p>{tr("weMaySuspendOrTerminateYour")}</p>

      <h2>{tr("n10LimitationOfLiability")}</h2>
      <p>{tr("toTheMaximumExtentPermittedBy")}</p>

      <h2>{tr("n11Indemnification")}</h2>
      <p>{tr("youAgreeToIndemnifyAndHold")}</p>

      <h2>{tr("n12GoverningLawAndDisputeResolution")}</h2>
      <p>{tr("theseTermsAreGovernedByThe")}</p>

      <h2>{tr("n13ChangesToTheseTerms")}</h2>
      <p>{tr("weMayUpdateTheseTermsFrom")}</p>

      <h2>{tr("n14Contact")}</h2>
      <p>
        {tr("questionsAboutTheseTermsEmail")} <a href="mailto:legal@muhasib.ai">legal@muhasib.ai</a>{" "}
        {tr("orWriteToNajmaAlRaeda")}
      </p>
    </LegalLayout>
  );
}
