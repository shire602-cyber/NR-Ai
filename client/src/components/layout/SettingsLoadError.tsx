import type { ComponentProps, ReactNode } from "react";
import { Link } from "wouter";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useTranslation } from "@/lib/i18n";
import { ApiError } from "@/lib/queryClient";

export function SettingsLoadError({
  companyAccessDescription,
  ...props
}: Omit<ComponentProps<typeof LoadErrorState>, "forbiddenDescription"> & {
  companyAccessDescription?: string;
}) {
  const { t } = useTranslation();
  const error = props.error;
  const code = error instanceof ApiError && error.status === 403 ? error.body?.code : undefined;
  let forbiddenDescription: ReactNode = t["pages.settingsAccessForbiddenBody"];

  switch (code) {
    case "MFA_ENROLLMENT_REQUIRED":
      forbiddenDescription = (
        <Link href="/settings/security" className="text-primary underline">
          {t["pages.settingsEnableMfa"]}
        </Link>
      );
      break;
    case "ACCESS_RESTRICTED":
    case "PORTAL_SCOPE":
    case "PORTAL_USER_APP_DENIED":
      forbiddenDescription = t["pages.accountTypeAccessForbiddenBody"];
      break;
    case "COMPANY_ACCESS_DENIED":
    case "PERMISSION_DENIED":
      forbiddenDescription = companyAccessDescription ?? forbiddenDescription;
      break;
  }

  return <LoadErrorState {...props} forbiddenDescription={forbiddenDescription} />;
}
