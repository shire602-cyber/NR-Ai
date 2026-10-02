import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ChangePasswordCard } from "@/components/security/ChangePasswordCard";
import { RequireTwoFactorCard } from "@/components/security/RequireTwoFactorCard";
import { SessionsCard } from "@/components/security/SessionsCard";
import { TwoFactorCard } from "@/components/security/TwoFactorCard";
import { twoFactorStatusKey, type TwoFactorStatus } from "@/lib/security-api";
import { messages as pageMessages } from "./SecuritySettings.i18n";

export default function SecuritySettings() {
  const tr = pageMessages.useT();
  const { data: status } = useQuery<TwoFactorStatus>({ queryKey: twoFactorStatusKey });
  const nowSafe = new URLSearchParams(window.location.search).get("required") === "1" && status?.enabled === true;

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} />
      {nowSafe && (
        <Button asChild>
          <Link href="/dashboard">{tr("continueToApp")}</Link>
        </Button>
      )}
      <TwoFactorCard />
      <SessionsCard />
      <ChangePasswordCard />
      <RequireTwoFactorCard />
    </div>
  );
}
