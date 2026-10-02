import type { SourcePreset } from "./types";

/** No source: the plain names the product's own templates use. Also the fallback every preset falls through to. */
export const generic: SourcePreset = {
  source: "generic",
  label: "Other / spreadsheet",
  defaults: { dateFormat: "yyyy-MM-dd", numberFormat: "us" },
  aliases: {
    contacts: {
      name: ["Name", "Contact", "Company Name", "Customer Name", "Vendor Name"],
      type: ["Type", "Contact Type"],
      email: ["Email", "E-mail", "Email Address"],
      phone: ["Phone", "Mobile", "Phone Number", "Telephone"],
      trn: ["TRN", "Tax Registration Number", "Tax Number", "VAT Number"],
      address: ["Address"],
      city: ["City"],
      country: ["Country"],
      contactPerson: ["Contact Person"],
      paymentTermsDays: ["Payment Terms", "Terms"],
      notes: ["Notes", "Note"],
    },
    items: {
      name: ["Name", "Item", "Item Name", "Product", "Service"],
      sku: ["SKU", "Code", "Item Code"],
      description: ["Description"],
      unitPrice: ["Unit Price", "Price", "Rate", "Selling Price"],
      costPrice: ["Cost", "Cost Price", "Purchase Price"],
      vatRate: ["VAT Rate", "Tax Rate", "VAT"],
      unit: ["Unit"],
      isActive: ["Active", "Status"],
    },
    accounts: {
      code: ["Code", "Account Code", "Number", "Account Number"],
      name: ["Name", "Account", "Account Name"],
      type: ["Type", "Account Type"],
      description: ["Description"],
    },
    opening_tb: {
      accountCode: ["Account Code", "Code"],
      accountName: ["Account", "Account Name", "Name"],
      debit: ["Debit", "Dr"],
      credit: ["Credit", "Cr"],
      balance: ["Balance", "Amount"],
    },
    open_invoices: {
      number: ["Invoice Number", "Number", "Invoice No", "Invoice #"],
      customer: ["Customer", "Customer Name", "Name"],
      date: ["Date", "Invoice Date"],
      dueDate: ["Due Date"],
      amount: ["Balance", "Outstanding", "Amount Due", "Open Balance", "Amount"],
      currency: ["Currency"],
      exchangeRate: ["Exchange Rate", "Rate"],
    },
    open_bills: {
      number: ["Bill Number", "Number", "Bill No", "Bill #", "Invoice Number"],
      vendor: ["Vendor", "Vendor Name", "Supplier", "Name"],
      date: ["Date", "Bill Date"],
      dueDate: ["Due Date"],
      amount: ["Balance", "Outstanding", "Amount Due", "Open Balance", "Amount"],
      currency: ["Currency"],
      exchangeRate: ["Exchange Rate", "Rate"],
    },
  },
};
