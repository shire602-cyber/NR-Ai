import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { messages } from "./SalesShared.i18n";

interface Signature {
  id: string;
  action: "accepted" | "declined";
  signerName: string;
  signerEmail: string;
  ip: string | null;
  userAgent: string | null;
  reason: string | null;
  quoteHash: string;
  signedAt: string;
  supersededAt: string | null;
}

/** Who accepted or declined a quote, when and from where: the record kept for five years. */
export function SignatureRecord({ quoteId, enabled = true }: { quoteId: string; enabled?: boolean }) {
  const tr = messages.useT();
  const { locale } = useTranslation();
  const query = useQuery<{ current: Signature | null; history: Signature[] }>({
    queryKey: ["/api/quotes", quoteId, "signature"],
    enabled,
  });
  if (!enabled || query.isLoading) return null;
  const current = query.data?.current;
  if (!current) return <p className="text-sm text-muted-foreground" data-testid="no-signature">{tr("signatureNone")}</p>;
  const rows: Array<[string, string]> = [
    [tr("signatureOutcome"), current.action === "accepted" ? tr("quoteAccepted") : tr("quoteDeclined")],
    [tr("signatureName"), current.signerName],
    [tr("signatureEmail"), current.signerEmail],
    [tr("signatureAt"), formatDate(current.signedAt, locale)],
    [tr("signatureIp"), current.ip ?? "-"],
    [tr("signatureDevice"), current.userAgent ?? "-"],
  ];
  if (current.reason) rows.push([tr("signatureReason"), current.reason]);
  return (
    <section className="space-y-2 rounded-lg border p-4" data-testid="signature-record" aria-label={tr("signatureTitle")}>
      <h3 className="flex items-center gap-2 font-medium">
        <ShieldCheck className="h-4 w-4 text-success" />
        {tr("signatureTitle")}
      </h3>
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="break-words font-medium">{value}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">{tr("signatureHash")}</dt>
        <dd dir="ltr" className="break-all font-mono text-xs">
          {current.quoteHash}
        </dd>
      </dl>
    </section>
  );
}
