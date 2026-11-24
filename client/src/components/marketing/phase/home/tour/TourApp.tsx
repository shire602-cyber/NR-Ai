import type { SiteLocale } from "../../routes";
import { useMarketingText } from "../text";
import AccountantTab from "./AccountantTab";
import BankTab from "./BankTab";
import InvoiceTab from "./InvoiceTab";
import ReceiptTab from "./ReceiptTab";
import VatTab from "./VatTab";

export interface TourAppProps {
  tab: number;
  locale: SiteLocale;
  reduced: boolean;
  autoPlay: boolean;
}

/** The interactive part of the tour. Lazy-loaded by `ProductTour` when the section nears the viewport. */
export default function TourApp({ tab, locale, reduced, autoPlay }: TourAppProps) {
  const text = useMarketingText(locale);
  const props = { locale, text, reduced, autoPlay };
  // `key` restarts a tab's state when the visitor comes back to it.
  switch (tab) {
    case 0:
      return <InvoiceTab key="invoice" {...props} />;
    case 1:
      return <ReceiptTab key="receipt" {...props} />;
    case 2:
      return <BankTab key="bank" {...props} />;
    case 3:
      return <VatTab key="vat" {...props} />;
    default:
      return <AccountantTab key="accountant" {...props} />;
  }
}
