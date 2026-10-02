import { useQuery } from "@tanstack/react-query";
import { useWatch, type Control, type FieldValues, type Path } from "react-hook-form";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";
import { messages } from "./DisposalDetailsFields.i18n";

export type VatTreatment = "none" | "standard" | "zero_rated" | "exempt";

export interface DisposalPreview {
  depreciationToDate: number;
  accumulatedAfter: number;
  nbv: number;
  proceeds: number;
  vatAmount: number;
  total: number;
  gainLoss: number;
  gainLossType?: "gain" | "loss";
}

interface Props<T extends FieldValues> {
  control: Control<T>;
  assetId: string;
  companyId: string;
  dateName: Path<T>;
  amountName: Path<T>;
  buyerName: Path<T>;
  vatName: Path<T>;
}

/** Buyer and VAT treatment of a disposal, with the computed result (depreciation, VAT, gain or loss) before it is posted. */
export function DisposalDetailsFields<T extends FieldValues>({ control, assetId, companyId, dateName, amountName, buyerName, vatName }: Props<T>) {
  const tr = messages.useT();
  const locale = useI18n((s) => s.locale);
  const date = String(useWatch({ control, name: dateName }) ?? "");
  const amount = Number(useWatch({ control, name: amountName }) ?? 0);
  const vat = String(useWatch({ control, name: vatName }) ?? "none");
  const ready = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(amount) && amount >= 0;
  const { data, isFetching, isError } = useQuery<DisposalPreview>({
    queryKey: [`/api/fixed-assets/${assetId}/dispose-preview?date=${date}&amount=${amount}&vatTreatment=${vat}`],
    enabled: !!assetId && !!companyId && ready,
    retry: false,
  });
  const money = (n: number) => formatCurrency(n, "AED", locale);
  const row = (label: string, value: string, key: string, strong = false) => (
    <p className={`flex justify-between gap-3 ${strong ? "border-t pt-1 font-semibold" : ""}`} data-testid={`dispose-${key}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span dir="ltr" className="font-mono">{value}</span>
    </p>
  );
  const gain = (data?.gainLoss ?? 0) >= 0;

  return (
    <>
      <FormField
        control={control}
        name={buyerName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tr("buyer")}</FormLabel>
            <FormControl>
              <Input placeholder={tr("buyerPlaceholder")} {...field} value={field.value ?? ""} maxLength={255} dir="auto" data-testid="input-disposal-buyer" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name={vatName}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tr("vat")}</FormLabel>
            <Select value={field.value || "none"} onValueChange={(v) => v && field.onChange(v)}>
              <FormControl>
                <SelectTrigger data-testid="select-disposal-vat">
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="none">{tr("vatNone")}</SelectItem>
                <SelectItem value="standard">{tr("vatStandard")}</SelectItem>
                <SelectItem value="zero_rated">{tr("vatZero")}</SelectItem>
                <SelectItem value="exempt">{tr("vatExempt")}</SelectItem>
              </SelectContent>
            </Select>
            <FormDescription>{tr("vatHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="rounded-md border p-3 text-sm space-y-1" data-testid="dispose-preview">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("previewTitle")}</p>
        {isFetching && !data ? (
          <Skeleton className="h-20 w-full" aria-label={tr("loading")} />
        ) : isError || !data ? (
          <p className="text-xs text-muted-foreground">{tr("previewFailed")}</p>
        ) : (
          <>
            {row(tr("depreciationToDate"), money(data.depreciationToDate), "depreciation")}
            {row(tr("accumulatedAfter"), money(data.accumulatedAfter), "accumulated")}
            {row(tr("nbv"), money(data.nbv), "nbv")}
            {row(tr("proceeds"), money(data.proceeds), "proceeds")}
            {data.vatAmount > 0 && row(tr("vatAmount"), money(data.vatAmount), "vat")}
            {data.vatAmount > 0 && row(tr("total"), money(data.total), "total")}
            <p className={`flex justify-between gap-3 border-t pt-1 font-semibold ${gain ? "text-[hsl(var(--chart-5))]" : "text-destructive"}`} data-testid="dispose-gainloss" data-value={data.gainLoss}>
              <span>{gain ? tr("gain") : tr("loss")}</span>
              <span dir="ltr" className="font-mono">{money(Math.abs(data.gainLoss))}</span>
            </p>
          </>
        )}
      </div>
    </>
  );
}
