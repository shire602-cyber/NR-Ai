import type { SourcePreset } from "./types";

/** QuickBooks Online report/list exports (Customer/Vendor contact lists, Products and Services, Account List, Trial Balance, Open Invoices, Unpaid Bills). */
export const quickbooks: SourcePreset = {
  source: "quickbooks",
  label: "QuickBooks",
  defaults: { dateFormat: "MM/dd/yyyy", numberFormat: "us" },
  aliases: {
    contacts: {
      name: ["Customer", "Vendor", "Full Name", "Display Name", "Name", "Company"],
      email: ["Email", "Main Email"],
      phone: ["Phone", "Phone Numbers", "Main Phone", "Mobile"],
      trn: ["TRN", "Tax ID", "VAT Reg No", "Resale Number"],
      address: ["Billing Address", "Street Address", "Address"],
      city: ["City"],
      country: ["Country"],
      notes: ["Notes"],
    },
    items: {
      name: ["Product/Service", "Name"],
      sku: ["SKU"],
      description: ["Sales Description", "Description"],
      unitPrice: ["Sales Price", "Price", "Rate"],
      costPrice: ["Cost", "Purchase Cost"],
      unit: ["Unit of Measure", "U/M"],
    },
    accounts: {
      code: ["Account #", "Account Number", "Number"],
      name: ["Account", "Full name", "Name"],
      type: ["Type", "Account Type"],
      description: ["Description"],
    },
    opening_tb: { accountCode: ["Account #"], accountName: ["Account", "Name"], debit: ["Debit"], credit: ["Credit"] },
    open_invoices: {
      number: ["Num", "Invoice No.", "Number"],
      customer: ["Customer", "Name"],
      date: ["Date", "Transaction date"],
      dueDate: ["Due date", "Due Date"],
      amount: ["Open balance", "Balance"],
      currency: ["Currency"],
    },
    open_bills: {
      number: ["Num", "Bill No.", "Number"],
      vendor: ["Vendor", "Name"],
      date: ["Date", "Transaction date"],
      dueDate: ["Due date", "Due Date"],
      amount: ["Open balance", "Balance"],
      currency: ["Currency"],
    },
  },
};
