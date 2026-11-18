import { errorHeading } from "@/lib/error-heading";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Link2, Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Money } from "@/components/ui/money";
import { downloadFile, errorMessage, monthName, useHr, type PayrollRun } from "./shared";

interface PayslipRow {
  id: string;
  employee_name: string;
  email: string | null;
  net_salary: string;
  payslip_emailed_at: string | null;
}

interface EmailResult {
  employeeName: string;
  sent: boolean;
  error?: string;
}

export function PayslipsTab({ companyId }: { companyId: string }) {
  const { tx, locale } = useHr();
  const { toast } = useToast();
  const { data: runs = [] } = useQuery<PayrollRun[]>({
    queryKey: [`/api/companies/${companyId}/payroll-runs`],
  });
  const ready = runs.filter((r) => r.status === "approved" || r.status === "paid");
  const [runId, setRunId] = useState("");
  const listKey = [`/api/payroll-runs/${runId}/payslips`];
  const { data: rows = [] } = useQuery<PayslipRow[]>({ queryKey: listKey, enabled: !!runId });
  const [results, setResults] = useState<EmailResult[] | null>(null);
  const fail = (err: unknown) =>
    toast({ title: errorHeading(err), description: errorMessage(err), variant: "destructive" });

  const email = useMutation({
    mutationFn: () => apiRequest("POST", `/api/payroll-runs/${runId}/payslips/email`, {}),
    onSuccess: (data: { results: EmailResult[]; sent: number; notSent: number }) => {
      setResults(data.results);
      queryClient.invalidateQueries({ queryKey: listKey });
      // Honest result: only what the email provider accepted counts as sent.
      toast({ title: tx("hr.payslipsEmailResult", { sent: data.sent, notSent: data.notSent }) });
    },
    onError: fail,
  });

  const link = useMutation({
    mutationFn: (itemId: string) =>
      apiRequest("POST", `/api/payroll-items/${itemId}/payslip-link`, {}),
    onSuccess: async (data: { url: string }) => {
      const url = data.url.startsWith("http") ? data.url : `${window.location.origin}${data.url}`;
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: tx("hr.linkCopied") });
      } catch {
        toast({ title: tx("hr.selfServiceLink"), description: url });
      }
    },
    onError: fail,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tx("hr.tab.payslips")}</CardTitle>
        <CardDescription>{tx("hr.payslipsHint")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={runId || undefined}
            onValueChange={(v) => {
              setRunId(v);
              setResults(null);
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder={tx("hr.selectApprovedRun")} />
            </SelectTrigger>
            <SelectContent>
              {ready.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {monthName(r.period_month, locale)} {r.period_year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={!runId || email.isPending} onClick={() => email.mutate()}>
            <Mail className="me-2 h-4 w-4" />
            {tx("hr.emailPayslips")}
          </Button>
        </div>
        {runId && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tx("hr.employee")}</TableHead>
                  <TableHead>{tx("hr.field.email")}</TableHead>
                  <TableHead data-numeric>{tx("hr.net")}</TableHead>
                  <TableHead>{tx("hr.emailed")}</TableHead>
                  <TableHead data-numeric>{tx("hr.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.employee_name}</TableCell>
                    <TableCell>{r.email ?? "—"}</TableCell>
                    <TableCell data-numeric>
                      <Money amount={Number(r.net_salary)} currency={"AED"} />
                    </TableCell>
                    <TableCell>{r.payslip_emailed_at ?? "—"}</TableCell>
                    <TableCell className="text-end space-x-1 rtl:space-x-reverse">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={tx("hr.downloadPayslip")}
                        onClick={() =>
                          downloadFile(
                            `/api/payroll-items/${r.id}/payslip.pdf`,
                            "payslip.pdf"
                          ).catch(fail)
                        }
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={tx("hr.selfServiceLink")}
                        onClick={() => link.mutate(r.id)}
                      >
                        <Link2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {results && (
          <ul className="space-y-1 text-sm">
            {results.map((r, i) => (
              <li key={i}>
                {r.employeeName}:{" "}
                {r.sent ? tx("hr.sent") : `${tx("hr.notSent")} — ${r.error ?? ""}`}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
