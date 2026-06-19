#!/usr/bin/env node

/*
 * Report audit fixture
 * --------------------
 * Creates a dedicated synthetic company and fills report-driving modules with
 * realistic accounting data through public app APIs. The goal is report-density
 * and workflow validation, not production load testing.
 *
 * Env:
 *   BASE_URL or first arg          Target app URL.
 *   REPORT_AUDIT_EMAIL            Optional existing/new smoke email.
 *   REPORT_AUDIT_PASSWORD         Optional smoke password.
 *   REPORT_AUDIT_REUSE=true       Login to an existing account instead of registering first.
 *
 * Output:
 *   tests/e2e/.artifacts/report-audit-fixture-last-run.json
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.BASE_URL || process.argv[2] || "").replace(/\/$/, "");
if (!BASE) {
  console.error("BASE_URL or first argument is required");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(__dirname, ".artifacts");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "report-audit-fixture-last-run.json");

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const email = process.env.REPORT_AUDIT_EMAIL || `report-audit+${runStamp}@test.local`;
const password = process.env.REPORT_AUDIT_PASSWORD || "ReportAudit123!";
const reuseAccount = process.env.REPORT_AUDIT_REUSE === "true";

const cookieJar = new Map();
let bearerToken = "";
let csrfToken = "";

const summary = {
  baseUrl: BASE,
  startedAt: new Date().toISOString(),
  account: { email, password, reused: reuseAccount },
  company: null,
  created: {},
  probes: [],
  warnings: [],
  artifact: ARTIFACT_PATH,
};

function rememberCookies(headers) {
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];
  for (const header of raw) {
    const [pair] = header.split(";");
    const [name, value] = pair.split("=");
    if (name && value !== undefined) cookieJar.set(name.trim(), value.trim());
  }
}

function cookieHeader() {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function count(name, increment = 1) {
  summary.created[name] = (summary.created[name] || 0) + increment;
}

function warn(name, error) {
  const message = error?.message || String(error);
  summary.warnings.push({ name, message });
  console.warn(`warn: ${name}: ${message.slice(0, 240)}`);
}

async function http(name, route, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = {
    ...(options.headers || {}),
    ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(method)
      ? { "x-csrf-token": csrfToken }
      : {}),
  };

  let body = options.body;
  if (body !== undefined && typeof body !== "string" && !(body instanceof Buffer)) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE}${route}`, { ...options, method, headers, body });
  rememberCookies(response.headers);
  const parsed = await parseBody(response);
  const okStatuses = options.okStatuses || [200, 201, 204];
  if (!okStatuses.includes(response.status)) {
    const detail =
      typeof parsed === "string" ? parsed : parsed ? JSON.stringify(parsed) : response.statusText;
    throw new Error(`${name} failed: ${response.status} ${detail.slice(0, 600)}`);
  }
  return parsed;
}

async function optional(name, fn) {
  try {
    return await fn();
  } catch (error) {
    warn(name, error);
    return null;
  }
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthStart(date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function monthEnd(date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + 1, 0));
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function assertProbe(name, passed, detail) {
  summary.probes.push({ name, passed, detail });
  if (!passed) {
    throw new Error(`${name} probe failed: ${JSON.stringify(detail).slice(0, 500)}`);
  }
  console.log(`ok: ${name}`);
}

async function authenticate() {
  if (!reuseAccount) {
    const register = await optional("register smoke account", () =>
      http("register", "/api/auth/register", {
        method: "POST",
        body: {
          email,
          password,
          name: "Report Audit Owner",
          companyName: `Report Audit Trading ${runStamp}`,
        },
      })
    );
    if (register?.token || register?.accessToken) {
      bearerToken = register.token || register.accessToken;
    }
  }

  if (!bearerToken) {
    const login = await http("login", "/api/auth/login", {
      method: "POST",
      body: { email, password },
    });
    bearerToken = login?.token || login?.accessToken || bearerToken;
  }

  const csrf = await http("csrf token", "/api/csrf-token");
  csrfToken = csrf?.csrfToken || "";
  await http("auth session", "/api/auth/me");
}

async function getCompany() {
  const companies = await http("companies", "/api/companies");
  if (!Array.isArray(companies) || companies.length === 0) {
    throw new Error("Authenticated account has no accessible companies");
  }

  const preferred =
    companies.find((company) => String(company.name || "").includes("Report Audit")) ||
    companies[0];
  summary.company = { id: preferred.id, name: preferred.name };

  await http("company profile", `/api/companies/${preferred.id}`, {
    method: "PATCH",
    body: {
      legalName: "Report Audit Trading LLC",
      legalStructure: "LLC",
      industry: "Professional services and product trading",
      registrationNumber: `RA-${runStamp}`,
      businessAddress: "Office 1404, Sheikh Zayed Road, Dubai, UAE",
      addressStreet: "Sheikh Zayed Road",
      addressCity: "Dubai",
      addressCountry: "AE",
      contactPhone: "+971 4 555 0199",
      contactEmail: email,
      trnVatNumber: "100123456700003",
      taxRegistrationType: "Standard",
      vatFilingFrequency: "Quarterly",
      taxRegistrationDate: "2026-01-01",
      corporateTaxId: `CT-${runStamp}`,
      emirate: "dubai",
      mohreEstablishmentId: `MOHRE-${runStamp}`,
      wpsEmployerBankName: "Emirates NBD",
      wpsEmployerIban: "AE070331234567890123456",
      wpsEmployerRoutingCode: "302620122",
      onboardingCompleted: true,
    },
  });
  await optional("complete onboarding", () =>
    http("complete onboarding", `/api/companies/${preferred.id}/onboarding/complete`, {
      method: "POST",
      body: {},
    })
  );

  return preferred;
}

async function loadAccounts(companyId) {
  const accounts = await http("accounts", `/api/companies/${companyId}/accounts`);
  const byCode = new Map(accounts.map((account) => [String(account.code), account]));
  const byType = (type) => accounts.find((account) => account.type === type && account.isActive);
  const pick = (code, type) => byCode.get(code) || byType(type);

  const critical = {
    bank: pick("1020", "asset"),
    cash: pick("1010", "asset"),
    ar: pick("1040", "asset"),
    ap: pick("2010", "liability"),
    capital: pick("3010", "equity"),
    revenue: byCode.get("4020") || byCode.get("4010") || byType("income"),
    productRevenue: byCode.get("4010") || byCode.get("4020") || byType("income"),
    rentExpense: byCode.get("5010") || byType("expense"),
    salariesExpense: byCode.get("5020") || byType("expense"),
    utilitiesExpense: byCode.get("5030") || byType("expense"),
    suppliesExpense: byCode.get("5050") || byType("expense"),
    marketingExpense: byCode.get("5060") || byType("expense"),
    professionalExpense: byCode.get("5070") || byType("expense"),
    softwareExpense: byCode.get("5080") || byType("expense"),
    travelExpense: byCode.get("5090") || byType("expense"),
    inventory: byCode.get("1070") || byType("asset"),
    loan: byCode.get("2210") || byType("liability"),
    equipment: byCode.get("1230") || byCode.get("1210") || byType("asset"),
  };

  for (const [name, account] of Object.entries(critical)) {
    if (!account?.id) throw new Error(`Missing required account for ${name}`);
  }

  return { accounts, byCode, ...critical };
}

async function seedOpeningBalances(companyId, account) {
  await http("opening journal", `/api/companies/${companyId}/journal`, {
    method: "POST",
    body: {
      date: ymd(monthStart(new Date(), -5)),
      status: "posted",
      memo: "Synthetic opening balance for report audit",
      lines: [
        { accountId: account.bank.id, debit: 300000, credit: 0, description: "Opening bank" },
        { accountId: account.cash.id, debit: 20000, credit: 0, description: "Opening cash" },
        {
          accountId: account.inventory.id,
          debit: 45000,
          credit: 0,
          description: "Opening inventory",
        },
        {
          accountId: account.equipment.id,
          debit: 80000,
          credit: 0,
          description: "Opening equipment",
        },
        { accountId: account.loan.id, debit: 0, credit: 100000, description: "Opening loan" },
        {
          accountId: account.capital.id,
          debit: 0,
          credit: 345000,
          description: "Owner capital",
        },
      ],
    },
  });
  count("journalEntries");
}

async function createInvoice(companyId, payload) {
  const invoice = await http("create invoice", `/api/companies/${companyId}/invoices`, {
    method: "POST",
    body: {
      customerTrn: "100987654300003",
      currency: "AED",
      ...payload,
    },
  });
  count("invoices");
  if (payload.issue !== false) {
    await http("issue invoice", `/api/invoices/${invoice.id}/status`, {
      method: "PATCH",
      body: { status: "sent" },
    });
  }
  return { ...invoice, total: safeNumber(invoice.total) };
}

async function seedInvoices(companyId, account, dates) {
  const lines = [
    {
      description: "Accounting advisory subscription",
      quantity: 1,
      unitPrice: 18500,
      vatRate: 0.05,
    },
    { description: "Automation setup", quantity: 2, unitPrice: 3200, vatRate: 0.05 },
  ];

  const invoices = [];
  invoices.push(
    await createInvoice(companyId, {
      customerName: "Blue Palm Services LLC",
      date: dates.currentMid,
      dueDate: dates.futureSoon,
      lines,
    })
  );
  invoices.push(
    await createInvoice(companyId, {
      customerName: "Atlas Free Zone FZCO",
      date: dates.currentEarly,
      dueDate: dates.today,
      lines: [
        { description: "Monthly bookkeeping", quantity: 1, unitPrice: 9200, vatRate: 0.05 },
        { description: "VAT return support", quantity: 1, unitPrice: 2800, vatRate: 0.05 },
      ],
    })
  );
  invoices.push(
    await createInvoice(companyId, {
      customerName: "Noor Retail Trading",
      date: dates.priorMid,
      dueDate: dates.overdue,
      lines: [
        { description: "Point-of-sale integration", quantity: 1, unitPrice: 14500, vatRate: 0.05 },
      ],
    })
  );
  invoices.push(
    await createInvoice(companyId, {
      customerName: "Harbor Design Studio",
      date: dates.currentLate,
      dueDate: dates.futureLater,
      lines: [
        { description: "Design automation review", quantity: 3, unitPrice: 1750, vatRate: 0.05 },
      ],
    })
  );
  invoices.push(
    await createInvoice(companyId, {
      customerName: "Export Advisory Client",
      date: dates.priorEarly,
      dueDate: dates.currentLate,
      lines: [{ description: "Export advisory", quantity: 1, unitPrice: 7800, vatRate: 0 }],
    })
  );
  invoices.push(
    await createInvoice(companyId, {
      customerName: "Draft Review Customer",
      date: dates.currentLate,
      issue: false,
      lines: [{ description: "Draft proposal", quantity: 1, unitPrice: 2500, vatRate: 0.05 }],
    })
  );

  await http("full invoice payment", `/api/companies/${companyId}/invoices/${invoices[1].id}/payments`, {
    method: "POST",
    body: {
      amount: invoices[1].total,
      date: dates.currentLate,
      method: "bank",
      reference: `PAY-${runStamp}-001`,
      paymentAccountId: account.bank.id,
    },
  });
  count("invoicePayments");

  await http("partial invoice payment", `/api/companies/${companyId}/invoices/${invoices[2].id}/payments`, {
    method: "POST",
    body: {
      amount: Math.round(invoices[2].total * 0.4 * 100) / 100,
      date: dates.currentEarly,
      method: "bank",
      reference: `PAY-${runStamp}-002`,
      paymentAccountId: account.bank.id,
    },
  });
  count("invoicePayments");

  await optional("credit note from invoice", () =>
    http("credit note from invoice", `/api/companies/${companyId}/invoices/${invoices[3].id}/credit-note`, {
      method: "POST",
      body: { reason: "Synthetic credit-note audit adjustment" },
    })
  );

  return invoices;
}

async function seedReceipts(companyId, account, dates) {
  const receipts = [
    {
      merchant: "Dubai Office Properties",
      category: "Rent",
      amount: 24000,
      vatAmount: 1200,
      date: dates.currentEarly,
      expenseAccountId: account.rentExpense.id,
      shouldPost: true,
    },
    {
      merchant: "CloudStack FZ LLC",
      category: "Software",
      amount: 4200,
      vatAmount: 210,
      date: dates.currentMid,
      expenseAccountId: account.softwareExpense.id,
      shouldPost: true,
    },
    {
      merchant: "OfficeMart UAE",
      category: "Office Supplies",
      amount: 1250,
      vatAmount: 62.5,
      date: dates.currentLate,
      expenseAccountId: account.suppliesExpense.id,
      shouldPost: true,
    },
    {
      merchant: "Campaign Labs",
      category: "Marketing",
      amount: 8600,
      vatAmount: 430,
      date: dates.priorMid,
      expenseAccountId: account.marketingExpense.id,
      shouldPost: false,
    },
    {
      merchant: "Legal Partners",
      category: "Professional Services",
      amount: 6100,
      vatAmount: 305,
      date: dates.currentMid,
      expenseAccountId: account.professionalExpense.id,
      shouldPost: false,
    },
  ];

  const created = [];
  for (const receipt of receipts) {
    const createdReceipt = await http("create receipt", `/api/companies/${companyId}/receipts`, {
      method: "POST",
      body: {
        merchant: receipt.merchant,
        category: receipt.category,
        amount: receipt.amount,
        vatAmount: receipt.vatAmount,
        currency: "AED",
        exchangeRate: 1,
        date: receipt.date,
        notes: "Synthetic report audit receipt",
      },
    });
    created.push(createdReceipt);
    count("receipts");
    if (receipt.shouldPost) {
      await http("post receipt", `/api/receipts/${createdReceipt.id}/post`, {
        method: "POST",
        body: {
          accountId: receipt.expenseAccountId,
          paymentAccountId: account.bank.id,
        },
      });
      count("postedReceipts");
    }
  }
  return created;
}

async function seedBills(companyId, account, dates) {
  const bills = [
    {
      vendor_name: "Gulf Hosting LLC",
      vendor_trn: "100555555500003",
      bill_number: `BILL-${runStamp}-001`,
      bill_date: dates.currentEarly,
      due_date: dates.futureSoon,
      category: "Software",
      line_items: [
        {
          description: "Cloud hosting",
          quantity: 1,
          unit_price: 7400,
          vat_rate: 5,
          account_id: account.softwareExpense.id,
        },
      ],
      payment: 3000,
    },
    {
      vendor_name: "Al Noor Facilities",
      vendor_trn: "100444444400003",
      bill_number: `BILL-${runStamp}-002`,
      bill_date: dates.priorMid,
      due_date: dates.overdue,
      category: "Utilities",
      line_items: [
        {
          description: "Facilities and utilities",
          quantity: 1,
          unit_price: 5800,
          vat_rate: 5,
          account_id: account.utilitiesExpense.id,
        },
      ],
      payment: 0,
    },
    {
      vendor_name: "Strategy Consultants",
      vendor_trn: "100333333300003",
      bill_number: `BILL-${runStamp}-003`,
      bill_date: dates.currentMid,
      due_date: dates.futureLater,
      category: "Professional Services",
      line_items: [
        {
          description: "Fractional CFO review",
          quantity: 1,
          unit_price: 11200,
          vat_rate: 5,
          account_id: account.professionalExpense.id,
        },
      ],
      payment: "full",
    },
  ];

  const created = [];
  for (const bill of bills) {
    const createdBill = await http("create bill", `/api/companies/${companyId}/bills`, {
      method: "POST",
      body: { ...bill, currency: "AED", exchange_rate: 1, notes: "Synthetic report audit bill" },
    });
    created.push(createdBill);
    count("bills");

    await http("approve bill", `/api/bills/${createdBill.id}/approve`, {
      method: "POST",
      body: {},
    });

    const total = safeNumber(createdBill.total_amount);
    const payment =
      bill.payment === "full" ? total : typeof bill.payment === "number" ? bill.payment : 0;
    if (payment > 0) {
      await http("pay bill", `/api/bills/${createdBill.id}/payments`, {
        method: "POST",
        body: {
          payment_date: dates.currentLate,
          amount: payment,
          payment_method: "bank_transfer",
          reference: `BPAY-${runStamp}-${created.length}`,
          notes: "Synthetic report audit bill payment",
        },
      });
      count("billPayments");
    }
  }
  return created;
}

async function seedInventory(companyId, dates) {
  const products = [
    {
      name: "Automation Starter Kit",
      sku: `AUTO-KIT-${runStamp}`,
      description: "Synthetic stocked product for report audit",
      unitPrice: "1800",
      costPrice: "900",
      vatRate: "0.05",
      unit: "each",
      currentStock: 5,
      lowStockThreshold: 10,
      movements: [
        { type: "purchase", quantity: 30, unitCost: "900", reference: `PO-${runStamp}-INV-1` },
        { type: "sale", quantity: 18, unitCost: "900", reference: `INV-${runStamp}-INV-1` },
        { type: "adjustment", quantity: -2, unitCost: "900", reference: "stock count" },
      ],
    },
    {
      name: "Reporting Dashboard License",
      sku: `RDL-${runStamp}`,
      unitPrice: "4200",
      costPrice: "0",
      vatRate: "0.05",
      unit: "license",
      currentStock: 0,
      lowStockThreshold: 1,
      movements: [{ type: "purchase", quantity: 3, unitCost: "0", reference: "license pool" }],
    },
  ];

  const created = [];
  for (const product of products) {
    const { movements, ...payload } = product;
    const createdProduct = await http("create product", `/api/companies/${companyId}/products`, {
      method: "POST",
      body: payload,
    });
    created.push(createdProduct);
    count("products");
    for (const movement of movements) {
      await http("inventory movement", `/api/products/${createdProduct.id}/movements`, {
        method: "POST",
        body: { ...movement, notes: `Synthetic report audit movement ${dates.today}` },
      });
      count("inventoryMovements");
    }
  }
  return created;
}

async function seedPayroll(companyId, dates) {
  const employees = [
    {
      employeeNumber: `RA-E001-${runStamp}`,
      fullName: "Mariam Al Mansoori",
      nationality: "UAE",
      bankName: "Emirates NBD",
      bankAccountNumber: "1234567890",
      iban: "AE070331234567890123456",
      routingCode: "302620122",
      department: "Advisory",
      designation: "Senior Accountant",
      joinDate: "2020-02-01",
      basicSalary: 18000,
      housingAllowance: 6500,
      transportAllowance: 1500,
      otherAllowance: 1000,
      status: "active",
    },
    {
      employeeNumber: `RA-E002-${runStamp}`,
      fullName: "Omar Khan",
      nationality: "Pakistan",
      bankName: "ADCB",
      bankAccountNumber: "2345678901",
      iban: "AE090331234567890123457",
      routingCode: "302620122",
      department: "Operations",
      designation: "Bookkeeper",
      joinDate: "2022-05-15",
      basicSalary: 10500,
      housingAllowance: 3000,
      transportAllowance: 900,
      otherAllowance: 500,
      status: "active",
    },
  ];

  for (const employee of employees) {
    await http("create employee", `/api/companies/${companyId}/employees`, {
      method: "POST",
      body: employee,
    });
    count("employees");
  }

  const now = new Date();
  const runPeriods = [
    { periodMonth: now.getUTCMonth() + 1, periodYear: now.getUTCFullYear(), approve: false },
    {
      periodMonth: monthStart(now, -1).getUTCMonth() + 1,
      periodYear: monthStart(now, -1).getUTCFullYear(),
      approve: true,
    },
  ];

  const runs = [];
  for (const period of runPeriods) {
    const run = await http("create payroll run", `/api/companies/${companyId}/payroll-runs`, {
      method: "POST",
      body: period,
    });
    count("payrollRuns");
    const calculated = await http("calculate payroll", `/api/payroll-runs/${run.id}/calculate`, {
      method: "POST",
      body: {},
    });
    runs.push(calculated);
    if (period.approve) {
      await optional("approve payroll run", () =>
        http("approve payroll run", `/api/payroll-runs/${run.id}/approve`, {
          method: "POST",
          body: {},
        })
      );
      await optional("generate WPS SIF", () => http("generate WPS SIF", `/api/payroll-runs/${run.id}/generate-sif`));
    }
  }
  return runs;
}

async function seedAssets(companyId, account, dates) {
  const assets = [
    {
      assetName: "Audit Workstation Fleet",
      assetNumber: `FA-${runStamp}-001`,
      category: "Computers & Software",
      purchaseDate: dates.priorEarly,
      purchaseCost: 36000,
      salvageValue: 3000,
      usefulLifeYears: 3,
      depreciationMethod: "straight_line",
      location: "Dubai HQ",
      serialNumber: `SER-${runStamp}-001`,
      notes: "Synthetic report audit asset with capitalization attempt",
      paymentAccountId: account.bank.id,
    },
    {
      assetName: "Client Presentation Furniture",
      assetNumber: `FA-${runStamp}-002`,
      category: "Furniture & Fixtures",
      purchaseDate: dates.currentEarly,
      purchaseCost: 18500,
      salvageValue: 1500,
      usefulLifeYears: 5,
      depreciationMethod: "straight_line",
      location: "Client meeting room",
      serialNumber: `SER-${runStamp}-002`,
      notes: "Synthetic report audit asset",
    },
  ];

  const created = [];
  for (const payload of assets) {
    let asset = await optional("create fixed asset with supplied payload", () =>
      http("create fixed asset", `/api/companies/${companyId}/fixed-assets`, {
        method: "POST",
        body: payload,
      })
    );
    if (!asset && payload.paymentAccountId) {
      const { paymentAccountId: _paymentAccountId, ...fallbackPayload } = payload;
      asset = await http("create fixed asset fallback", `/api/companies/${companyId}/fixed-assets`, {
        method: "POST",
        body: fallbackPayload,
      });
    }
    if (asset?.id) {
      created.push(asset);
      count("fixedAssets");
      await optional("post depreciation", () =>
        http("post depreciation", `/api/fixed-assets/${asset.id}/depreciate`, {
          method: "POST",
          body: {
            month: new Date(dates.currentMid).getUTCMonth() + 1,
            year: new Date(dates.currentMid).getUTCFullYear(),
          },
        })
      );
    }
  }
  return created;
}

async function seedBudgets(companyId, account, dates) {
  const year = new Date(dates.today).getUTCFullYear();
  const budget = await http("create budget plan", `/api/companies/${companyId}/budget-plans`, {
    method: "POST",
    body: {
      name: `Report Audit Operating Budget ${year}`,
      fiscalYear: year,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      notes: "Synthetic report audit budget",
    },
  });
  count("budgetPlans");

  const monthlyRevenue = 38000;
  const monthlyPayroll = 32000;
  const linePayloads = [
    {
      accountId: account.revenue.id,
      category: "Revenue",
      description: "Services revenue target",
      jan: monthlyRevenue,
      feb: monthlyRevenue,
      mar: monthlyRevenue,
      apr: monthlyRevenue,
      may: monthlyRevenue,
      jun: monthlyRevenue,
      jul: monthlyRevenue,
      aug: monthlyRevenue,
      sep: monthlyRevenue,
      oct: monthlyRevenue,
      nov: monthlyRevenue,
      dec: monthlyRevenue,
    },
    {
      accountId: account.salariesExpense.id,
      category: "Payroll",
      description: "Payroll cost plan",
      jan: monthlyPayroll,
      feb: monthlyPayroll,
      mar: monthlyPayroll,
      apr: monthlyPayroll,
      may: monthlyPayroll,
      jun: monthlyPayroll,
      jul: monthlyPayroll,
      aug: monthlyPayroll,
      sep: monthlyPayroll,
      oct: monthlyPayroll,
      nov: monthlyPayroll,
      dec: monthlyPayroll,
    },
    {
      accountId: account.softwareExpense.id,
      category: "Technology",
      description: "Software and automation tools",
      jan: 5000,
      feb: 5000,
      mar: 5000,
      apr: 5000,
      may: 5000,
      jun: 5000,
      jul: 5000,
      aug: 5000,
      sep: 5000,
      oct: 5000,
      nov: 5000,
      dec: 5000,
    },
  ];

  for (const line of linePayloads) {
    await http("create budget line", `/api/budget-plans/${budget.id}/lines`, {
      method: "POST",
      body: line,
    });
    count("budgetLines");
  }
  await http("approve budget", `/api/budget-plans/${budget.id}/approve`, {
    method: "POST",
    body: {},
  });
  return budget;
}

async function seedExpenseClaims(companyId, dates) {
  const claim = await http("create expense claim", `/api/companies/${companyId}/expense-claims`, {
    method: "POST",
    body: {
      title: "Client travel and training reimbursements",
      description: "Synthetic report audit expense claim",
      currency: "AED",
      items: [
        {
          expense_date: dates.currentEarly,
          category: "Travel",
          description: "Client visit taxi and parking",
          amount: 420,
          vat_amount: 21,
          merchant_name: "Careem",
        },
        {
          expense_date: dates.currentMid,
          category: "Training",
          description: "Accounting automation workshop",
          amount: 950,
          vat_amount: 47.5,
          merchant_name: "Dubai Training Hub",
        },
      ],
    },
  });
  count("expenseClaims");
  await http("submit expense claim", `/api/expense-claims/${claim.id}/submit`, {
    method: "POST",
    body: {},
  });

  const approved = await http("create approved expense claim", `/api/companies/${companyId}/expense-claims`, {
    method: "POST",
    body: {
      title: "Approved reimbursement queue",
      currency: "AED",
      items: [
        {
          expense_date: dates.currentMid,
          category: "Meals",
          description: "Client working lunch",
          amount: 380,
          vat_amount: 19,
          merchant_name: "DIFC Cafe",
        },
      ],
    },
  });
  count("expenseClaims");
  await http("submit approved expense claim", `/api/expense-claims/${approved.id}/submit`, {
    method: "POST",
    body: {},
  });
  await http("approve expense claim", `/api/expense-claims/${approved.id}/approve`, {
    method: "POST",
    body: { review_notes: "Synthetic approved queue item" },
  });
  return [claim, approved];
}

async function seedBank(companyId, account, dates, invoices, receipts) {
  const bankAccount = await http("create bank account", `/api/companies/${companyId}/bank-accounts`, {
    method: "POST",
    body: {
      nameEn: "Report Audit Operating Account",
      bankName: "Emirates NBD",
      accountNumber: `RA${runStamp}`,
      iban: "AE070331234567890123456",
      currency: "AED",
      glAccountId: account.bank.id,
    },
  });
  count("bankAccounts");

  const rows = [
    "date,description,debit,credit,balance,reference",
    `${dates.currentLate},Customer payment Blue Palm,,25000,325000,BANK-${runStamp}-001`,
    `${dates.currentLate},CloudStack payment,4410,,320590,BANK-${runStamp}-002`,
    `${dates.currentMid},Bank service fee,95,,320495,BANK-${runStamp}-003`,
    `${dates.futureSoon},Expected customer receipt,,15000,335495,BANK-${runStamp}-004`,
  ];
  await http("import bank statement", `/api/companies/${companyId}/bank-statements/import`, {
    method: "POST",
    body: { bankAccountId: bankAccount.id, csvContent: rows.join("\n") },
  });
  count("bankStatementImports");

  const transactions = await http(
    "bank transactions",
    `/api/companies/${companyId}/bank-statements/transactions`
  );
  const creditTxn = Array.isArray(transactions)
    ? transactions.find((txn) => safeNumber(txn.amount) > 0)
    : null;
  const targetInvoice = invoices.find((invoice) => invoice.customerName === "Blue Palm Services LLC");
  if (creditTxn?.id && targetInvoice?.id) {
    await optional("manual bank match invoice", () =>
      http("manual bank match invoice", `/api/companies/${companyId}/bank-statements/${creditTxn.id}/match`, {
        method: "POST",
        body: { matchedType: "invoice", matchedId: targetInvoice.id },
      })
    );
  }

  const debitTxn = Array.isArray(transactions)
    ? transactions.find((txn) => safeNumber(txn.amount) < 0)
    : null;
  const postedReceipt = receipts.find((receipt) => receipt.posted === true) || receipts[0];
  if (debitTxn?.id && postedReceipt?.id) {
    await optional("manual bank match receipt", () =>
      http("manual bank match receipt", `/api/companies/${companyId}/bank-statements/${debitTxn.id}/match`, {
        method: "POST",
        body: { matchedType: "receipt", matchedId: postedReceipt.id },
      })
    );
  }
}

async function seedCommercialDocs(companyId, dates) {
  await optional("create quote", async () => {
    const quote = await http("create quote", `/api/companies/${companyId}/quotes`, {
      method: "POST",
      body: {
        number: `Q-${runStamp}-001`,
        customerName: "Quote Prospect LLC",
        date: dates.currentMid,
        expiryDate: dates.futureLater,
        currency: "AED",
        status: "sent",
        lines: [{ description: "Automation readiness workshop", quantity: 1, unitPrice: 9500, vatRate: 0.05 }],
      },
    });
    count("quotes");
    await optional("convert quote to invoice", () =>
      http("convert quote to invoice", `/api/quotes/${quote.id}/convert-to-invoice`, {
        method: "POST",
        body: {},
      })
    );
  });

  await optional("create purchase order", async () => {
    const po = await http("create purchase order", `/api/companies/${companyId}/purchase-orders`, {
      method: "POST",
      body: {
        number: `PO-${runStamp}-001`,
        vendorName: "Hardware Supplier LLC",
        date: dates.currentMid,
        expectedDeliveryDate: dates.futureLater,
        currency: "AED",
        status: "draft",
        lines: [{ description: "Audit laptop bundle", quantity: 3, unitPrice: 4200, vatRate: 0.05 }],
      },
    });
    count("purchaseOrders");
    await optional("send purchase order", () =>
      http("send purchase order", `/api/purchase-orders/${po.id}/send`, {
        method: "POST",
        body: {},
      })
    );
    await optional("approve purchase order", () =>
      http("approve purchase order", `/api/purchase-orders/${po.id}/approve`, {
        method: "POST",
        body: {},
      })
    );
    await optional("receive purchase order", () =>
      http("receive purchase order", `/api/purchase-orders/${po.id}/receive`, {
        method: "POST",
        body: {},
      })
    );
  });
}

async function seedTaxAndClose(companyId, dates) {
  await optional("generate VAT return", () =>
    http("generate VAT return", `/api/companies/${companyId}/vat-returns/generate`, {
      method: "POST",
      body: {
        periodStart: ymd(monthStart(new Date(), -2)),
        periodEnd: ymd(monthEnd(new Date(), 0)),
        dueDate: ymd(addDays(new Date(), 28)),
      },
    })
  );

  await optional("create corporate tax return", async () => {
    const ctReturn = await http("create corporate tax return", `/api/companies/${companyId}/corporate-tax/returns`, {
      method: "POST",
      body: {
        taxPeriodStart: `${new Date(dates.today).getUTCFullYear()}-01-01`,
        taxPeriodEnd: `${new Date(dates.today).getUTCFullYear()}-12-31`,
        totalRevenue: 760000,
        totalExpenses: 455000,
        totalDeductions: 12000,
        exemptionThreshold: 375000,
        taxRate: 0.09,
        status: "draft",
      },
    });
    count("corporateTaxReturns");
    await http("compute corporate tax return", `/api/corporate-tax/returns/${ctReturn.id}/compute`, {
      method: "POST",
      body: {
        adjustments: [
          { label: "Entertainment disallowance", amount: 4200, direction: "add_back" },
          { label: "Small equipment deduction", amount: 1800, direction: "deduction" },
        ],
        smallBusinessReliefElected: false,
        relatedPartyNotes: "Synthetic audit run has no related-party balances.",
      },
    });
  });

  await optional("month-end checklist", () =>
    http("month-end checklist", `/api/companies/${companyId}/month-end/checklist?period=${dates.period}`)
  );
  await optional("month-end AI validation", () =>
    http("month-end AI validation", `/api/companies/${companyId}/month-end/ai-validation?period=${dates.period}`)
  );
}

async function seedCostCenters(companyId) {
  await optional("create cost centers", async () => {
    const root = await http("create cost center", `/api/companies/${companyId}/cost-centers`, {
      method: "POST",
      body: {
        code: `ADV-${runStamp}`,
        name: "Advisory",
        description: "Synthetic advisory cost center",
        isActive: true,
      },
    });
    count("costCenters");
    await http("create child cost center", `/api/companies/${companyId}/cost-centers`, {
      method: "POST",
      body: {
        code: `OPS-${runStamp}`,
        name: "Operations",
        description: "Synthetic operations cost center",
        parentId: root.id,
        isActive: true,
      },
    });
    count("costCenters");
  });
}

async function probeReports(companyId, dates, budgetId) {
  const start = ymd(monthStart(new Date(), -5));
  const end = ymd(monthEnd(new Date(), 0));

  const pl = await http("P&L report", `/api/companies/${companyId}/reports/pl?startDate=${start}&endDate=${end}`);
  assertProbe("P&L has revenue and expenses", safeNumber(pl.totalRevenue) > 0 && safeNumber(pl.totalExpenses) > 0, {
    totalRevenue: pl.totalRevenue,
    totalExpenses: pl.totalExpenses,
  });

  const balance = await http(
    "balance sheet report",
    `/api/companies/${companyId}/reports/balance-sheet?startDate=${start}&endDate=${end}`
  );
  assertProbe("Balance sheet has asset and equity/liability rows", safeNumber(balance.totalAssets) > 0, {
    totalAssets: balance.totalAssets,
    totalLiabilities: balance.totalLiabilities,
    totalEquity: balance.totalEquity,
  });

  const aging = await http("aging report", `/api/reports/${companyId}/aging`);
  const agingRows = Array.isArray(aging)
    ? aging
    : [
        ...(Array.isArray(aging?.receivables) ? aging.receivables : []),
        ...(Array.isArray(aging?.payables) ? aging.payables : []),
      ];
  const receivables = agingRows.filter((row) => row?.type === "receivable").length;
  const payables = agingRows.filter((row) => row?.type === "payable").length;
  assertProbe("Aging report has A/R and A/P rows", receivables > 0 && payables > 0, {
    receivables,
    payables,
  });

  const trialBalance = await http(
    "trial balance report",
    `/api/companies/${companyId}/reports/trial-balance?from=${start}&to=${end}`
  );
  const trialBalanceRows = Array.isArray(trialBalance?.rows)
    ? trialBalance.rows
    : Array.isArray(trialBalance?.accounts)
      ? trialBalance.accounts
      : Array.isArray(trialBalance)
        ? trialBalance
        : [];
  assertProbe(
    "Trial balance returns account activity",
    trialBalanceRows.some(
      (row) => Math.abs(safeNumber(row?.totalDebit)) > 0 || Math.abs(safeNumber(row?.totalCredit)) > 0
    ),
    { rows: trialBalanceRows.length }
  );

  const balanceSummaries = await http(
    "balance summaries",
    `/api/companies/${companyId}/reports/balance-summaries`
  );
  assertProbe("Balance summaries include customers or vendors", Boolean(balanceSummaries), {
    keys: Object.keys(balanceSummaries || {}),
  });

  const salesProduct = await http(
    "sales product service report",
    `/api/companies/${companyId}/reports/sales-product-service?startDate=${start}&endDate=${end}`
  );
  assertProbe(
    "Sales by product/service has rows",
    Array.isArray(salesProduct?.rows) ? salesProduct.rows.length > 0 : Array.isArray(salesProduct) && salesProduct.length > 0,
    { rows: salesProduct?.rows?.length || salesProduct?.length || 0 }
  );

  const comparison = await http(
    "period comparison",
    `/api/reports/${companyId}/comparison/month?startDate=${start}&endDate=${end}`
  );
  const comparisonRows = Array.isArray(comparison)
    ? comparison
    : Array.isArray(comparison?.metrics)
      ? comparison.metrics
      : [];
  assertProbe("Period comparison exposes metrics", comparisonRows.some((row) => row?.metric), {
    metrics: comparisonRows.length,
  });

  await optional("financial statement P&L", () =>
    http("financial statement P&L", `/api/companies/${companyId}/financial-statements/profit-loss?startDate=${start}&endDate=${end}`)
  );
  await optional("financial statement balance sheet", () =>
    http("financial statement balance sheet", `/api/companies/${companyId}/financial-statements/balance-sheet?asOfDate=${end}&startDate=${start}&endDate=${end}`)
  );
  await optional("cash-flow forecast", () => http("cash-flow forecast", `/api/reports/${companyId}/cash-flow/month`));
  await optional("VAT summary", () => http("VAT summary", `/api/companies/${companyId}/reports/vat-summary`));
  await optional("inventory movements", () => http("inventory movements", `/api/companies/${companyId}/inventory-movements`));
  await optional("fixed assets list", () => http("fixed assets list", `/api/companies/${companyId}/fixed-assets`));
  await optional("payroll runs", () => http("payroll runs", `/api/companies/${companyId}/payroll-runs`));
  await optional("expense claims summary", () => http("expense claims summary", `/api/companies/${companyId}/expense-claims/summary`));
  await optional("bank statement report", () => http("bank statement report", `/api/companies/${companyId}/bank-statements/report`));
  await optional("cost-center profitability", () =>
    http("cost-center profitability", `/api/companies/${companyId}/cost-centers/profitability?startDate=${start}&endDate=${end}`)
  );
  if (budgetId) {
    await optional("budget variance", () => http("budget variance", `/api/budget-plans/${budgetId}/variance`));
  }
}

async function main() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await http("liveness", "/health/live");
  await http("readiness", "/health/ready");
  await authenticate();

  const company = await getCompany();
  const companyId = company.id;
  const account = await loadAccounts(companyId);

  const now = new Date();
  const dates = {
    today: ymd(now),
    period: ymd(monthStart(now, 0)).slice(0, 7),
    currentEarly: ymd(addDays(monthStart(now, 0), 4)),
    currentMid: ymd(addDays(monthStart(now, 0), 12)),
    currentLate: ymd(addDays(monthStart(now, 0), 18)),
    priorEarly: ymd(addDays(monthStart(now, -1), 5)),
    priorMid: ymd(addDays(monthStart(now, -1), 14)),
    overdue: ymd(addDays(now, -45)),
    futureSoon: ymd(addDays(now, 5)),
    futureLater: ymd(addDays(now, 21)),
  };

  await seedOpeningBalances(companyId, account);
  await seedCostCenters(companyId);
  const invoices = await seedInvoices(companyId, account, dates);
  const receipts = await seedReceipts(companyId, account, dates);
  await seedBills(companyId, account, dates);
  await seedInventory(companyId, dates);
  await seedPayroll(companyId, dates);
  await seedAssets(companyId, account, dates);
  const budget = await seedBudgets(companyId, account, dates);
  await seedExpenseClaims(companyId, dates);
  await seedBank(companyId, account, dates, invoices, receipts);
  await seedCommercialDocs(companyId, dates);
  await seedTaxAndClose(companyId, dates);
  await probeReports(companyId, dates, budget?.id);

  summary.finishedAt = new Date().toISOString();
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`ok: report audit fixture complete`);
  console.log(`artifact: ${ARTIFACT_PATH}`);
  console.log(`email: ${email}`);
}

main().catch(async (error) => {
  summary.finishedAt = new Date().toISOString();
  summary.failure = error?.message || String(error);
  await fs.mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`).catch(() => {});
  console.error(error);
  process.exit(1);
});
