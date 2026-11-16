// Reports > vat tab.
// Split out of Reports.tsx (W5-A, R20-09); state comes from useReportsPage via context.
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { T } from "@/components/layout/T";
import { format } from "date-fns";
import { Money } from "@/components/ui/money";
import { useReportsPageContext } from "../context";

export default function VatTab() {
  const { dateRange, t, vatLoading, vatSummary } = useReportsPageContext();
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t.vatSummary}</CardTitle>
          <CardDescription>
            {dateRange.from && dateRange.to
              ? `${format(dateRange.from, "MMM dd, yyyy")} - ${format(dateRange.to, "MMM dd, yyyy")}`
              : "UAE VAT (5%) summary for the current period"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {vatLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-success ">Sales (Output VAT)</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        <T k="reportCenter.subtotal" />
                      </span>
                      <span className="tabular-nums">
                        <Money amount={vatSummary?.salesSubtotal || 0} currency={"AED"} />
                      </span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>VAT Collected (5%)</span>
                      <span className="tabular-nums">
                        <Money amount={vatSummary?.salesVAT || 0} currency={"AED"} />
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-semibold text-info ">Purchases (Input VAT)</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        <T k="reportCenter.subtotal" />
                      </span>
                      <span className="tabular-nums">
                        <Money amount={vatSummary?.purchasesSubtotal || 0} currency={"AED"} />
                      </span>
                    </div>
                    <div className="flex justify-between font-medium">
                      <span>VAT Paid (5%)</span>
                      <span className="tabular-nums">
                        <Money amount={vatSummary?.purchasesVAT || 0} currency={"AED"} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t-4 pt-6">
                <div className="flex justify-between items-center text-lg font-semibold">
                  <span>
                    <T k="reportCenter.netVatPayableToFta" />
                  </span>
                  <span
                    className={`tabular-nums ${(vatSummary?.netVATPayable ?? 0) >= 0 ? "text-destructive " : "text-success "}`}
                  >
                    <Money amount={Math.abs(vatSummary?.netVATPayable ?? 0)} currency={"AED"} />
                    {(vatSummary?.netVATPayable ?? 0) < 0 && " (Refund)"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {(vatSummary?.netVATPayable ?? 0) >= 0
                    ? t["reportCenter.vatPayableToFta"]
                    : t["reportCenter.vatRefundFromFta"]}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
