import { useEffect } from "react";
import { LegalLayout } from "@/components/LegalLayout";
import { messages as pageMessages } from "./PrivacyPolicy.i18n";

export default function PrivacyPolicy() {
  const tr = pageMessages.useT();

  useEffect(() => {
    document.title = tr("privacyPolicyMuhasibAi");
  }, []);

  return (
    <LegalLayout title={tr("privacyPolicy")} effectiveDate="2026-04-26">
      <p>
        {tr("thisPrivacyPolicyDescribesHowNajma")}
        <strong>"NRA"</strong>,<strong>{tr("we")}</strong>, <strong>{tr("us")}</strong>
        {tr("or")} <strong>{tr("our")}</strong>
        {tr("collectsUsesAndProtectsPersonalData")} <strong>{tr("service")}</strong>
        {tr("weAreCommittedToHandlingYour")}
      </p>

      <h2>{tr("n1DataWeCollect")}</h2>
      <p>{tr("weCollectTheFollowingCategoriesOf")}</p>
      <ul>
        <li>
          <strong>{tr("accountData")}</strong> {tr("nameEmailPhoneNumberPasswordHashed")}
        </li>
        <li>
          <strong>{tr("companyData")}</strong> {tr("tradeLicenceNumberTrnAddressBusiness")}
        </li>
        <li>
          <strong>{tr("financialData")}</strong>{" "}
          {tr("invoicesReceiptsBankTransactionsLedgerEntries")}
        </li>
        <li>
          <strong>{tr("usageData")}</strong> {tr("pagesVisitedFeaturesUsedIpAddress")}
        </li>
        <li>
          <strong>{tr("supportData")}</strong> {tr("communicationsYouSendToOurSupport")}
        </li>
      </ul>

      <h2>{tr("n2HowWeUseYourData")}</h2>
      <p>{tr("weUseYourDataTo")}</p>
      <ul>
        <li>{tr("provideOperateAndMaintainTheService")}</li>
        <li>{tr("generateVatReadyTaxWorkpapersE")}</li>
        <li>{tr("sendServiceRelatedNotificationsEG")}</li>
        <li>{tr("improveFeaturesThroughAggregatedAnonymisedAnalyt")}</li>
        <li>{tr("complyWithOurLegalObligationsUnder")}</li>
      </ul>

      <h2>{tr("n3LegalBasisForProcessing")}</h2>
      <p>{tr("weProcessPersonalDataOnThe")}</p>

      <h2>{tr("n4DataRetention")}</h2>
      <p>
        {tr("financialRecordsAndTaxRelatedData")}
        <strong>{tr("five5Years")}</strong>
        {tr("fromTheEndOfTheTax")}
      </p>

      <h2>{tr("n5DataSharing")}</h2>
      <p>{tr("weDoNotSellYourPersonal")}</p>
      <ul>
        <li>
          <strong>{tr("serviceProviders")}</strong>{" "}
          {tr("cloudHostingEmailDeliveryPaymentProcessors")}
        </li>
        <li>
          <strong>{tr("uaeRegulatoryAuthorities")}</strong> {tr("ftaMofWhereLegallyRequired")}
        </li>
        <li>
          <strong>{tr("yourAuthorisedUsers")}</strong> {tr("teamMembersAccountantsYouHaveInvited")}
        </li>
      </ul>

      <h2>{tr("n6DataSecurity")}</h2>
      <p>{tr("weUseTlsEncryptionForData")}</p>

      <h2>{tr("n7YourRights")}</h2>
      <p>
        {tr("subjectToUaePdplYouHave")}
        <a href="mailto:privacy@muhasib.ai">privacy@muhasib.ai</a>.
      </p>

      <h2>{tr("n8InternationalTransfers")}</h2>
      <p>{tr("yourDataIsPrimarilyHostedIn")}</p>

      <h2>{tr("n9Children")}</h2>
      <p>{tr("theServiceIsIntendedForBusinesses")}</p>

      <h2>{tr("n10ChangesToThisPolicy")}</h2>
      <p>{tr("weMayUpdateThisPrivacyPolicy")}</p>

      <h2>{tr("n11Contact")}</h2>
      <p>
        {tr("forPrivacyQuestionsContactOurData")}
        <a href="mailto:privacy@muhasib.ai">privacy@muhasib.ai</a> {tr("orWriteToNajmaAlRaeda")}
      </p>
    </LegalLayout>
  );
}
