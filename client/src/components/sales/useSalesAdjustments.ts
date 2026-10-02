import { useCallback, useState } from "react";
import {
  splitStoredLines,
  shippingFormFromRow,
  type DiscountType,
  type SalesLineRow,
  type ShippingForm,
} from "@/lib/sales-api";

const EMPTY_SHIPPING: ShippingForm = { amount: "", vatRate: 0.05 };

export interface SalesAdjustments {
  discountType: DiscountType | null;
  discountValue: number | string | null;
  shipping: ShippingForm;
  setDiscount: (next: { type: DiscountType | null; value: number | string | null }) => void;
  setShipping: (next: ShippingForm) => void;
  reset: () => void;
  /** Take the stored discount and the shipping line from a document the server returned (edit). */
  loadFrom: (doc: { discountType?: string | null; discountValue?: number | string | null; lines?: SalesLineRow[] | null }) => void;
}

/** Document-level discount and shipping of the editor being filled (kept beside the react-hook-form lines). */
export function useSalesAdjustments(): SalesAdjustments {
  const [discountType, setDiscountType] = useState<DiscountType | null>(null);
  const [discountValue, setDiscountValue] = useState<number | string | null>(null);
  const [shipping, setShipping] = useState<ShippingForm>(EMPTY_SHIPPING);

  const setDiscount = useCallback((next: { type: DiscountType | null; value: number | string | null }) => {
    setDiscountType(next.type);
    setDiscountValue(next.value);
  }, []);
  const reset = useCallback(() => {
    setDiscountType(null);
    setDiscountValue(null);
    setShipping(EMPTY_SHIPPING);
  }, []);
  const loadFrom = useCallback<SalesAdjustments["loadFrom"]>((doc) => {
    const type = doc.discountType === "percent" || doc.discountType === "amount" ? doc.discountType : null;
    setDiscountType(type);
    setDiscountValue(type && doc.discountValue !== undefined && doc.discountValue !== null ? Number(doc.discountValue) : null);
    setShipping(shippingFormFromRow(splitStoredLines(doc.lines).shipping));
  }, []);

  return { discountType, discountValue, shipping, setDiscount, setShipping, reset, loadFrom };
}
