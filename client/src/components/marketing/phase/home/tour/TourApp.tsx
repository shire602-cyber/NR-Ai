import type { SiteLocale } from "../../routes";
import { useMarketingText } from "../text";
import AccountantTab from "./AccountantTab";
import BankTab from "./BankTab";
import InvoiceTab from "./InvoiceTab";
import type { TourInvoice } from "./invoiceState";
import ReceiptTab from "./ReceiptTab";
import VatTab from "./VatTab";

export interface TourAppProps {
  tab: number;
  locale: SiteLocale;
  reduced: boolean;
  autoPlay: boolean;
  /** Explicit Pause pressed: hold demos that are already running. */
  paused?: boolean;
  /** Reports whether a demo sequence is actively running. */
  onActivity?: (active: boolean) => void;
  /** Sample invoice state owned by `ProductTour`, shared by the invoice and VAT 201 tabs. */
  invoice: TourInvoice;
}

/** The interactive part of the tour. Lazy-loaded by `ProductTour` when the section nears the viewport. */
export default function TourApp({
  tab,
  locale,
  reduced,
  autoPlay,
  paused = false,
  onActivity,
  invoice,
}: TourAppProps) {
  const text = useMarketingText(locale);
  const props = { locale, text, reduced, autoPlay, paused, onActivity };
  // `key` restarts a tab's state when the visitor comes back to it.
  switch (tab) {
    case 0:
      return <InvoiceTab key="invoice" {...props} invoice={invoice} />;
    case 1:
      return <ReceiptTab key="receipt" {...props} />;
    case 2:
      return <BankTab key="bank" {...props} />;
    case 3:
      return <VatTab key="vat" {...props} invoice={invoice} />;
    default:
      return <AccountantTab key="accountant" {...props} />;
  }
}
