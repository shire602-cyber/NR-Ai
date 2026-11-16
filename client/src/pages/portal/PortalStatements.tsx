import { T } from "@/components/layout/T";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";

/**
 * W4-D (R16-15): the customer's statement of account — opening balance, invoices, credit
 * notes and payments with a running balance, closing balance and ageing — not the supplier's
 * profit and loss or balance sheet.
 */
interface StatementSection {
  currency: string;
  openingBalance: number;
  closingBalance: number;
  totals: { debit: number; credit: number };
  lines: Array<{
    date: string;
    type: string;
    reference: string;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }>;
  aging: {
    current: number;
    days30: number;
    days60: number;
    days90: number;
    over90: number;
    total: number;
    unappliedCredits: number;
  };
}

interface Statement {
  asOf: string;
  party: { name: string };
  company: { name: string };
  sections: StatementSection[];
}

function money(n: number, currency: string) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(n);
}

export default function PortalStatements() {
  const { data, isLoading } = useQuery<Statement>({
    queryKey: ["portal-statements"],
    queryFn: () => apiRequest("GET", "/api/client-portal/statements"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            <T k="portal.statementOfAccount" />
          </h1>
          <p className="text-sm text-muted-foreground">
            <T k="portal.asOf" /> {data?.asOf}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => window.open(apiUrl("/api/client-portal/statements?format=pdf"), "_blank")}
        >
          <Download className="w-4 h-4 me-1" />
          PDF
        </Button>
      </div>
      {(data?.sections ?? []).length === 0 && (
        <p className="text-muted-foreground">
          <T k="portal.noInvoices" />
        </p>
      )}
      {(data?.sections ?? []).map((s) => (
        <Card key={s.currency}>
          <CardHeader>
            <CardTitle>{s.currency}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>
                <T k="portal.openingBalance" />
              </span>
              <span className="tabular-nums">{money(s.openingBalance, s.currency)}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <T k="portal.date" />
                  </TableHead>
                  <TableHead>
                    <T k="portal.reference" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="portal.debit" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="portal.credit" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="portal.balance" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.lines.map((l, i) => (
                  <TableRow key={`${l.reference}-${i}`}>
                    <TableCell>{l.date}</TableCell>
                    <TableCell>
                      {l.reference}{" "}
                      <span className="text-muted-foreground">
                        · <T k={`portal.lineType.${l.type}`} />
                      </span>
                    </TableCell>
                    <TableCell data-numeric className=" tabular-nums">
                      {l.debit ? money(l.debit, s.currency) : ""}
                    </TableCell>
                    <TableCell data-numeric className=" tabular-nums">
                      {l.credit ? money(l.credit, s.currency) : ""}
                    </TableCell>
                    <TableCell data-numeric className=" tabular-nums">
                      {money(l.balance, s.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-between font-semibold">
              <span>
                <T k="portal.closingBalance" />
              </span>
              <span className="tabular-nums">{money(s.closingBalance, s.currency)}</span>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-sm">
              {(
                [
                  ["portal.agingCurrent", s.aging.current],
                  ["portal.aging30", s.aging.days30],
                  ["portal.aging60", s.aging.days60],
                  ["portal.aging90", s.aging.days90],
                  ["portal.agingOver90", s.aging.over90],
                  ["portal.agingTotal", s.aging.total],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded bg-muted p-2">
                  <p className="text-muted-foreground">
                    <T k={k} />
                  </p>
                  <p className="font-medium tabular-nums">{money(v, s.currency)}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
