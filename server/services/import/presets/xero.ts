import type { SourcePreset } from "./types";

/** Xero exports and import templates (Contacts, Items, Chart of Accounts, Trial Balance, Aged Receivables/Payables detail). */
export const xero: SourcePreset = {
  source: "xero",
  label: "Xero",
  defaults: { dateFormat: "dd/MM/yyyy", numberFormat: "us" },
  aliases: {
    contacts: {
      name: ["*ContactName", "ContactName", "Name"],
      email: ["EmailAddress", "Email"],
      phone: ["PhoneNumber", "MobileNumber"],
      trn: ["TaxNumber", "TRN"],
      address: ["POAddressLine1", "SAAddressLine1"],
      city: ["POCity", "SACity"],
      country: ["POCountry", "SACountry"],
      contactPerson: ["POAttentionTo"],
    },
    items: {
      name: ["ItemName", "Name"],
      sku: ["*ItemCode", "ItemCode"],
      description: ["SalesDescription", "PurchasesDescription"],
      unitPrice: ["SalesUnitPrice"],
      costPrice: ["PurchasesUnitPrice"],
    },
    accounts: {
      code: ["*Code", "Code"],
      name: ["*Name", "Name"],
      type: ["*Type", "Type"],
      description: ["Description"],
    },
    opening_tb: {
      accountCode: ["Account Code", "Code"],
      accountName: ["Account", "Account Name"],
      debit: ["Debit - Year to date", "Debit YTD", "Debit"],
      credit: ["Credit - Year to date", "Credit YTD", "Credit"],
    },
    open_invoices: {
      number: ["*InvoiceNumber", "InvoiceNumber", "Invoice Number", "Reference"],
      customer: ["*ContactName", "ContactName", "Contact"],
      date: ["*InvoiceDate", "InvoiceDate", "Date"],
      dueDate: ["*DueDate", "DueDate", "Due Date"],
      amount: ["AmountDue", "Amount Due", "Due", "Balance"],
      currency: ["Currency"],
    },
    open_bills: {
      number: ["*InvoiceNumber", "InvoiceNumber", "Invoice Number", "Reference"],
      vendor: ["*ContactName", "ContactName", "Contact"],
      date: ["*InvoiceDate", "InvoiceDate", "Date"],
      dueDate: ["*DueDate", "DueDate", "Due Date"],
      amount: ["AmountDue", "Amount Due", "Due", "Balance"],
      currency: ["Currency"],
    },
  },
};
