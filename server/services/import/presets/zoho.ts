import type { SourcePreset } from "./types";

/** Zoho Books CSV exports (Contacts, Items, Chart of Accounts, Trial Balance, Invoices, Bills). */
export const zoho: SourcePreset = {
  source: "zoho",
  label: "Zoho Books",
  defaults: { dateFormat: "yyyy-MM-dd", numberFormat: "us" },
  aliases: {
    contacts: {
      name: ["Display Name", "Contact Name", "Company Name"],
      type: ["Contact Type"],
      email: ["EmailID", "Email"],
      phone: ["Phone", "MobilePhone", "Mobile"],
      trn: ["TRN", "Tax Registration Number", "Tax ID", "VAT Number", "Tax Number"],
      address: ["Billing Address", "Address"],
      city: ["Billing City", "City"],
      country: ["Billing Country", "Country"],
      paymentTermsDays: ["Payment Terms"],
      notes: ["Notes"],
    },
    items: {
      name: ["Item Name", "Name"],
      sku: ["SKU"],
      description: ["Description", "Sales Description"],
      unitPrice: ["Rate", "Selling Price", "Sales Rate"],
      costPrice: ["Purchase Rate", "Cost Price"],
      unit: ["Usage unit", "Unit"],
      isActive: ["Status"],
    },
    accounts: {
      code: ["Account Code"],
      name: ["Account Name"],
      type: ["Account Type"],
      description: ["Description"],
    },
    opening_tb: { accountCode: ["Account Code"], accountName: ["Account", "Account Name"], debit: ["Debit"], credit: ["Credit"] },
    open_invoices: {
      number: ["Invoice Number", "Invoice#"],
      customer: ["Customer Name"],
      date: ["Invoice Date", "Date"],
      dueDate: ["Due Date"],
      amount: ["Balance", "Balance Due"],
      currency: ["Currency Code", "Currency"],
      exchangeRate: ["Exchange Rate"],
    },
    open_bills: {
      number: ["Bill Number", "Bill#"],
      vendor: ["Vendor Name"],
      date: ["Bill Date", "Date"],
      dueDate: ["Due Date"],
      amount: ["Balance", "Balance Due"],
      currency: ["Currency Code", "Currency"],
      exchangeRate: ["Exchange Rate"],
    },
  },
};
