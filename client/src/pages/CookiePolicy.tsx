import { useEffect } from "react";
import { LegalLayout } from "@/components/LegalLayout";
import { messages as pageMessages } from "./CookiePolicy.i18n";

export default function CookiePolicy() {
  const tr = pageMessages.useT();

  useEffect(() => {
    document.title = tr("cookiePolicyMuhasibAi");
  }, []);

  return (
    <LegalLayout title={tr("cookiePolicy")} effectiveDate="2026-04-26">
      <p>
        {tr("thisCookiePolicyExplainsHowMuhasib")} <a href="/privacy">{tr("privacyPolicy")}</a>.
      </p>

      <h2>{tr("n1WhatAreCookies")}</h2>
      <p>{tr("cookiesAreSmallTextFilesPlaced")}</p>

      <h2>{tr("n2CategoriesOfCookiesWeUse")}</h2>

      <h3>{tr("strictlyNecessary")}</h3>
      <p>{tr("theseAreRequiredForTheService")}</p>

      <h3>{tr("functional")}</h3>
      <p>{tr("theseRememberChoicesYouMakeTo")}</p>

      <h3>{tr("analytics")}</h3>
      <p>{tr("weUseFirstPartyAnalyticsTo")}</p>

      <h3>{tr("marketing")}</h3>
      <p>{tr("weDoNotCurrentlySetMarketing")}</p>

      <h2>{tr("n3ThirdPartyCookies")}</h2>
      <p>{tr("somePagesMayLoadContentFrom")}</p>

      <h2>{tr("n4ManagingCookies")}</h2>
      <p>
        {tr("mostBrowsersAllowYouToRefuse")}
        <a href="https://www.aboutcookies.org" target="_blank" rel="noopener noreferrer">
          aboutcookies.org
        </a>
        .
      </p>

      <h2>{tr("n5ChangesToThisPolicy")}</h2>
      <p>{tr("weMayUpdateThisCookiePolicy")}</p>

      <h2>{tr("n6Contact")}</h2>
      <p>
        {tr("ifYouHaveQuestionsAboutHow")}
        <a href="mailto:privacy@muhasib.ai">privacy@muhasib.ai</a>.
      </p>
    </LegalLayout>
  );
}
