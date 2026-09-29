import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { downloadAuthenticatedFile } from "@/lib/file-upload";
import { useComplianceText } from "@/lib/i18n-compliance";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MAX_DAYS = 366;

/** Download of the FTA Audit File for a period (GET /api/companies/:id/reports/fta-audit-file). */
export default function FtaAuditFileCard({ companyId }: { companyId: string }) {
  const { c } = useComplianceText();
  const { toast } = useToast();
  const now = new Date();
  const [from, setFrom] = useState(ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const [to, setTo] = useState(ymd(new Date(now.getFullYear(), now.getMonth(), 0)));
  const [busy, setBusy] = useState(false);

  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  const rangeOk = !!from && !!to && from <= to && days <= MAX_DAYS;

  const download = async () => {
    if (!rangeOk) return;
    setBusy(true);
    try {
      await downloadAuthenticatedFile(
        `/api/companies/${companyId}/reports/fta-audit-file?from=${from}&to=${to}`,
        `FAF_${from}_${to}.csv`
      );
    } catch (err: any) {
      toast({ variant: "destructive", title: c.fafFailed, description: err?.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="card-faf">
      <CardHeader>
        <CardTitle>{c.fafTitle}</CardTitle>
        <CardDescription>{c.fafDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid max-w-md grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="faf-from">{c.fafFrom}</Label>
            <Input id="faf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="input-faf-from" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="faf-to">{c.fafTo}</Label>
            <Input id="faf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="input-faf-to" />
          </div>
        </div>
        {!rangeOk && <p className="text-sm text-destructive">{c.fafRangeInvalid}</p>}
        <Button onClick={() => void download()} disabled={!rangeOk || busy} data-testid="button-download-faf">
          {busy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Download className="me-2 h-4 w-4" />}
          {busy ? c.fafDownloading : c.fafDownload}
        </Button>
        <p className="text-xs text-muted-foreground">{c.fafNote}</p>
      </CardContent>
    </Card>
  );
}
