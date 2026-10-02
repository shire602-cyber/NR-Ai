import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { messages as salesMessages } from "@/components/sales/SalesShared.i18n";
import { useTranslation } from "@/lib/i18n";
import { formatCurrency } from "@/lib/format";

export interface OpeningStockRow {
  quantity: string;
  unitCost: string;
}

export type OpeningStock = Record<string, OpeningStockRow>;

interface Props {
  companyId: string | undefined | null;
  value: OpeningStock;
  onChange: (next: OpeningStock) => void;
  /** What the account grid already holds on the stock account (1070): entering it twice would count the stock twice. */
  gridStockAmount: number;
}

const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/,/g, "")));

/** The wire form of the opening stock: only items with a quantity. */
export function openingStockPayload(value: OpeningStock) {
  return Object.entries(value)
    .map(([productId, r]) => ({ productId, quantity: Math.trunc(num(r.quantity)), unitCost: num(r.unitCost) }))
    .filter((r) => r.quantity > 0);
}

export function openingStockTotal(value: OpeningStock): number {
  return Math.round(openingStockPayload(value).reduce((s, r) => s + r.quantity * r.unitCost, 0) * 100) / 100;
}

/** Opening stock by item: quantity and unit cost on the opening date. The value goes to Inventory and the items' stock. */
export function OpeningStockCard({ companyId, value, onChange, gridStockAmount }: Props) {
  const tr = salesMessages.useT();
  const { locale } = useTranslation();
  const { data: products = [] } = useQuery<Array<{ id: string; name: string; nameAr?: string | null; sku?: string | null; trackInventory?: boolean | null; isActive?: boolean | null }>>({
    queryKey: ["/api/companies", companyId, "products"],
    enabled: !!companyId,
  });
  const items = products.filter((p) => p.trackInventory && p.isActive !== false);
  if (items.length === 0) return null;
  const total = openingStockTotal(value);
  const set = (id: string, patch: Partial<OpeningStockRow>) =>
    onChange({ ...value, [id]: { ...(value[id] ?? { quantity: "", unitCost: "" }), ...patch } });

  return (
    <Card data-testid="card-opening-stock">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="h-5 w-5" />
          {tr("openingStockTitle")}
        </CardTitle>
        <CardDescription>{tr("openingStockCardHelp")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr("lineProduct")}</TableHead>
                <TableHead className="w-32 text-end">{tr("openingQuantity")}</TableHead>
                <TableHead className="w-36 text-end">{tr("openingUnitCost")}</TableHead>
                <TableHead className="w-36 text-end">{tr("openingStockValue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => {
                const row = value[p.id] ?? { quantity: "", unitCost: "" };
                const line = Math.trunc(num(row.quantity)) * num(row.unitCost);
                return (
                  <TableRow key={p.id} data-testid={`opening-stock-row-${p.sku || p.id}`}>
                    <TableCell>
                      {locale === "ar" && p.nameAr ? p.nameAr : p.name}
                      {p.sku && <span className="ms-2 text-xs text-muted-foreground" dir="ltr">{p.sku}</span>}
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0} step="1" dir="ltr" className="text-end" aria-label={tr("openingQuantityOf", { name: p.name })} value={row.quantity} onChange={(e) => set(p.id, { quantity: e.target.value })} data-testid={`input-os-qty-${p.sku || p.id}`} />
                    </TableCell>
                    <TableCell>
                      <Input type="number" min={0} step="0.01" dir="ltr" className="text-end" aria-label={tr("openingUnitCostOf", { name: p.name })} value={row.unitCost} onChange={(e) => set(p.id, { unitCost: e.target.value })} data-testid={`input-os-cost-${p.sku || p.id}`} />
                    </TableCell>
                    <TableCell className="text-end font-mono" dir="ltr">{formatCurrency(line, "AED", locale)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex justify-between text-sm font-medium">
          <span>{tr("openingStockTotal")}</span>
          <span className="font-mono" dir="ltr" data-testid="opening-stock-total">{formatCurrency(total, "AED", locale)}</span>
        </div>
        {total > 0 && gridStockAmount > 0.004 && (
          <p role="alert" className="text-sm text-destructive" data-testid="opening-stock-double-count">
            {tr("openingStockDoubleCount", { amount: formatCurrency(gridStockAmount, "AED", locale) })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
