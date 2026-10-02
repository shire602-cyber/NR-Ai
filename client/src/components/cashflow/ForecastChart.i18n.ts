import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "ForecastChart",
  {
    inflows: "Money in",
    outflows: "Money out",
    balance: "Closing balance",
    weekOf: "Week of {date}",
    ariaLabel: "Weekly cash flow forecast: money in, money out and the closing balance",
    empty: "No weeks to show.",
  },
  {
    inflows: "وارد",
    outflows: "صادر",
    balance: "الرصيد الختامي",
    weekOf: "أسبوع {date}",
    ariaLabel: "توقعات التدفق النقدي الأسبوعية: الوارد والصادر والرصيد الختامي",
    empty: "لا توجد أسابيع للعرض.",
  }
);
