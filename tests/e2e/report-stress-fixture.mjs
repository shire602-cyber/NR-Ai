#!/usr/bin/env node

/*
 * High-volume report stress fixture
 * ---------------------------------
 * Creates a dedicated synthetic company and populates it through public APIs
 * with enough operational volume to exercise report behavior at realistic scale.
 *
 * Env:
 *   BASE_URL or first arg              Target app URL.
 *   REPORT_STRESS_EMAIL                Existing smoke/admin email.
 *   REPORT_STRESS_PASSWORD             Existing smoke/admin password.
 *   REPORT_STRESS_COMPANY_NAME         Optional exact company name.
 *   REPORT_STRESS_REUSE_COMPANY=true   Reuse company if name exists; default creates a new one.
 *   REPORT_STRESS_INVOICES             Default 220.
 *   REPORT_STRESS_RECEIPTS             Default 220.
 *   REPORT_STRESS_BILLS                Default 140.
 *   REPORT_STRESS_JOURNALS             Default 80.
 *   REPORT_STRESS_EMPLOYEES            Default 12.
 *   REPORT_STRESS_BANK_TXNS            Default 320.
 *   REPORT_STRESS_WRITE_DELAY_MS        Default 500; throttle mutating API calls.
 *
 * Output:
 *   tests/e2e/.artifacts/report-stress-fixture-last-run.json
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
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "report-stress-fixture-last-run.json");
const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const email = process.env.REPORT_STRESS_EMAIL;
const password = process.env.REPORT_STRESS_PASSWORD;
const reuseCompany = process.env.REPORT_STRESS_REUSE_COMPANY === "true";
const companyName =
  process.env.REPORT_STRESS_COMPANY_NAME || `Najma Raida Report Stress Test ${runStamp}`;

const config = {
  invoices: Number(process.env.REPORT_STRESS_INVOICES || "220"),
  receipts: Number(process.env.REPORT_STRESS_RECEIPTS || "220"),
  bills: Number(process.env.REPORT_STRESS_BILLS || "140"),
  journals: Number(process.env.REPORT_STRESS_JOURNALS || "80"),
  employees: Number(process.env.REPORT_STRESS_EMPLOYEES || "12"),
  bankTransactions: Number(process.env.REPORT_STRESS_BANK_TXNS || "320"),
  writeDelayMs: Number(process.env.REPORT_STRESS_WRITE_DELAY_MS || "500"),
};

if (!email || !password) {
  console.error("REPORT_STRESS_EMAIL and REPORT_STRESS_PASSWORD are required");
  process.exit(1);
}

const cookieJar = new Map();
let bearerToken = "";
let csrfToken = "";

const summary = {
  baseUrl: BASE,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  account: { email },
  company: null,
  config,
  expected: {
    salesIssuedSubtotalAed: 0,
    salesIssuedVatAed: 0,
    salesIssuedTotalAed: 0,
    invoicePaymentsAed: 0,
    billTotalAed: 0,
    billPaymentsAed: 0,
    postedReceiptExpenseAed: 0,
    postedReceiptVatAed: 0,
    manualRevenueAed: 0,
    manualExpenseAed: 0,
  },
  created: {},
  warnings: [],
  probes: [],
  artifact: ARTIFACT_PATH,
};

function log(message) {
  console.log(`[stress] ${message}`);
}

function count(name, increment = 1) {
  summary.created[name] = (summary.created[name] || 0) + increment;
}

function warn(name, error) {
  const message = error?.message || String(error);
  summary.warnings.push({ name, message });
  console.warn(`[stress] warn: ${name}: ${message.slice(0, 240)}`);
}

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

async function http(name, route, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const okStatuses = options.okStatuses || [200, 201, 204];
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const maxAttempts = Number(options.maxAttempts || 8);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const headers = {
      ...(options.headers || {}),
      ...(cookieJar.size ? { Cookie: cookieHeader() } : {}),
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      ...(csrfToken && mutating ? { "x-csrf-token": csrfToken } : {}),
    };

    let body = options.body;
    if (body !== undefined && typeof body !== "string" && !(body instanceof Buffer)) {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE}${route}`, { ...options, method, headers, body });
    rememberCookies(response.headers);
    const parsed = await parseBody(response);

    if (okStatuses.includes(response.status)) {
      if (mutating && config.writeDelayMs > 0) {
        await sleep(config.writeDelayMs);
      }
      return parsed;
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const retryAfterSeconds =
        safeNumber(response.headers.get("retry-after")) ||
        safeNumber(typeof parsed === "object" && parsed ? parsed.details?.retryAfterSeconds : 0) ||
        15;
      const delayMs = Math.max(1000, retryAfterSeconds * 1000 + 500);
      log(
        `rate limited on ${name}; waiting ${Math.round(delayMs / 1000)}s before retry ${
          attempt + 1
        }/${maxAttempts}`
      );
      await sleep(delayMs);
      continue;
    }

    const detail =
      typeof parsed === "string" ? parsed : parsed ? JSON.stringify(parsed) : response.statusText;
    throw new Error(`${name} failed: ${response.status} ${detail.slice(0, 800)}`);
  }

  throw new Error(`${name} failed after ${maxAttempts} attempts`);
}

async function optional(name, fn) {
  try {
    return await fn();
  } catch (error) {
    warn(name, error);
    return null;
  }
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  return Math.round(safeNumber(value) * 100) / 100;
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function monthStart(date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function monthEnd(date, offset = 0) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + 1, 0));
}

function assertProbe(name, passed, detail) {
  const probe = { name, passed, detail };
  summary.probes.push(probe);
  console.log(`${passed ? "ok" : "fail"}: ${name}`);
  if (!passed) {
    throw new Error(`${name} failed: ${JSON.stringify(detail).slice(0, 600)}`);
  }
}

async function authenticate() {
  await http("liveness", "/health/live");
  await http("readiness", "/health/ready");

  const login = await http("login", "/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  bearerToken = login?.token || login?.accessToken || bearerToken;

  const csrf = await http("csrf token", "/api/csrf-token");
  csrfToken = csrf?.csrfToken || "";
  await http("auth session", "/api/auth/me");
}

async function getOrCreateCompany() {
  const companies = await http("companies", "/api/companies");
  const existing = Array.isArray(companies)
    ? companies.find((company) => company.name === companyName)
    : null;

  if (existing && reuseCompany) {
    summary.company = { id: existing.id, name: existing.name, reused: true };
    log(`Reusing company ${existing.name} (${existing.id})`);
    return existing;
  }

  const name = existing ? `${companyName} ${runStamp}` : companyName;
  const company = await http("create company", "/api/companies", {
    method: "POST",
    body: {
      name,
      legalName: name,
      baseCurrency: "AED",
      locale: "en",
      dateFormat: "DD/MM/YYYY",
      fiscalYearStartMonth: 1,
      defaultVatRate: 0.05,
      companyType: "customer",
      legalStructure: "LLC",
      industry: "Accounting services, advisory, and trading",
      registrationNumber: `NR-STRESS-${runStamp}`,
      businessAddress: "Najma Raida synthetic report stress ledger, Dubai, UAE",
      addressStreet: "Sheikh Zayed Road",
      addressCity: "Dubai",
      addressCountry: "AE",
      contactEmail: email,
      contactPhone: "+971 4 555 0199",
      trnVatNumber: "100123456700003",
      taxRegistrationType: "Standard",
      vatFilingFrequency: "Quarterly",
      corporateTaxId: `CT-STRESS-${runStamp}`,
      emirate: "dubai",
      mohreEstablishmentId: `MOHRE-${runStamp}`,
      wpsEmployerBankName: "Emirates NBD",
      wpsEmployerIban: "AE070331234567890123456",
      wpsEmployerRoutingCode: "302620122",
      onboardingCompleted: true,
    },
  });
  await optional("complete onboarding", () =>
    http("complete onboarding", `/api/companies/${company.id}/onboarding/complete`, {
      method: "POST",
      body: {},
    })
  );
  summary.company = { id: company.id, name: company.name, reused: false };
  log(`Created company ${company.name} (${company.id})`);
  return company;
}

async function loadAccounts(companyId) {
  const accounts = await http("accounts", `/api/companies/${companyId}/accounts`);
  const byCode = new Map(accounts.map((account) => [String(account.code), account]));
  const byType = (type) => accounts.find((account) => account.type === type && account.isActive);
  const pick = (code, type) => byCode.get(code) || byType(type);
  const picked = {
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

  for (const [name, account] of Object.entries(picked)) {
    if (!account?.id) throw new Error(`Missing required account for ${name}`);
  }
  return { accounts, byCode, ...picked };
}

async function seedOpeningBalances(companyId, account, dates) {
  await http("opening journal", `/api/companies/${companyId}/journal`, {
    method: "POST",
    body: {
      date: ymd(monthStart(new Date(), -8)),
      status: "posted",
      memo: "Synthetic opening balance for Najma Raida report stress test",
      source: "report-stress-fixture",
      lines: [
        { accountId: account.bank.id, debit: 1250000, credit: 0, description: "Opening bank" },
        { accountId: account.cash.id, debit: 45000, credit: 0, description: "Opening cash" },
        { accountId: account.inventory.id, debit: 180000, credit: 0, description: "Opening inventory" },
        { accountId: account.equipment.id, debit: 260000, credit: 0, description: "Opening fixed assets" },
        { accountId: account.loan.id, debit: 0, credit: 300000, description: "Opening bank loan" },
        { accountId: account.capital.id, debit: 0, credit: 1435000, description: "Owner capital" },
      ],
    },
  });
  count("journalEntries");

  await http("create USD exchange rate", `/api/companies/${companyId}/exchange-rates`, {
    method: "POST",
    body: { fromCurrency: "USD", toCurrency: "AED", rate: 3.67, effectiveDate: dates.start },
  });
  count("exchangeRates");
}

async function seedCostCenters(companyId) {
  const centers = [];
  for (const name of ["Advisory", "Bookkeeping", "Tax", "Automation"]) {
    const center = await http(`create cost center ${name}`, `/api/companies/${companyId}/cost-centers`, {
      method: "POST",
      body: {
        code: `${name.slice(0, 3).toUpperCase()}-${runStamp}`,
        name,
        description: `Synthetic ${name} cost center`,
        isActive: true,
      },
    });
    centers.push(center);
    count("costCenters");
  }
  return centers;
}

async function createInvoice(companyId, payload) {
  const invoice = await http("create invoice", `/api/companies/${companyId}/invoices`, {
    method: "POST",
    body: payload,
  });
  count("invoices");
  if (payload.issue !== false) {
    await http("issue invoice", `/api/invoices/${invoice.id}/status`, {
      method: "PATCH",
      body: { status: "sent" },
    });
  }
  return { ...invoice, total: safeNumber(invoice.total), subtotal: safeNumber(invoice.subtotal), vatAmount: safeNumber(invoice.vatAmount) };
}

async function seedInvoices(companyId, account, dates) {
  const customers = Array.from({ length: 48 }, (_, index) => {
    const n = String(index + 1).padStart(2, "0");
    return `NR Stress Customer ${n} LLC`;
  });
  const services = [
    "Monthly bookkeeping",
    "VAT compliance review",
    "Corporate tax advisory",
    "Payroll processing",
    "Automation implementation",
    "Management reporting pack",
    "Audit support",
    "CFO advisory",
  ];

  const invoices = [];
  for (let i = 0; i < config.invoices; i += 1) {
    const isUsd = i % 17 === 0;
    const isZeroRated = i % 19 === 0;
    const issue = i % 29 !== 0;
    const amount = 8200 + ((i * 1379) % 11200);
    const quantity = 1 + (i % 3);
    const unitPrice = round2(amount / quantity);
    const date = ymd(addDays(dates.startDate, i % 165));
    const dueDate = ymd(addDays(new Date(date), (i % 6) * 10 - 20));
    const invoice = await createInvoice(companyId, {
      customerName: customers[i % customers.length],
      customerTrn: `10098765${String(i % 10000000).padStart(7, "0")}`.slice(0, 15),
      date,
      dueDate,
      currency: isUsd ? "USD" : "AED",
      exchangeRate: isUsd ? 3.67 : 1,
      issue,
      lines: [
        {
          description: services[i % services.length],
          quantity,
          unitPrice,
          vatRate: isZeroRated ? 0 : 0.05,
        },
      ],
    });
    invoices.push(invoice);

    const rate = isUsd ? 3.67 : 1;
    if (issue) {
      summary.expected.salesIssuedSubtotalAed += invoice.subtotal * rate;
      summary.expected.salesIssuedVatAed += invoice.vatAmount * rate;
      summary.expected.salesIssuedTotalAed += invoice.total * rate;
    }

    if (issue && i % 3 === 0) {
      await http("invoice full payment", `/api/companies/${companyId}/invoices/${invoice.id}/payments`, {
        method: "POST",
        body: {
          amount: invoice.total,
          date: ymd(addDays(new Date(date), 8)),
          method: "bank",
          reference: `STRESS-PAY-${runStamp}-${i}`,
          paymentAccountId: account.bank.id,
        },
      });
      summary.expected.invoicePaymentsAed += invoice.total * rate;
      count("invoicePayments");
    } else if (issue && i % 5 === 0) {
      const amountPaid = round2(invoice.total * 0.45);
      await http("invoice partial payment", `/api/companies/${companyId}/invoices/${invoice.id}/payments`, {
        method: "POST",
        body: {
          amount: amountPaid,
          date: ymd(addDays(new Date(date), 12)),
          method: "bank",
          reference: `STRESS-PPAY-${runStamp}-${i}`,
          paymentAccountId: account.bank.id,
        },
      });
      summary.expected.invoicePaymentsAed += amountPaid * rate;
      count("invoicePayments");
    }

    if ((i + 1) % 25 === 0) log(`Created ${i + 1}/${config.invoices} invoices`);
  }
  return invoices;
}

async function seedReceipts(companyId, account, dates) {
  const categories = [
    ["Rent", account.rentExpense.id],
    ["Software", account.softwareExpense.id],
    ["Office Supplies", account.suppliesExpense.id],
    ["Marketing", account.marketingExpense.id],
    ["Professional Services", account.professionalExpense.id],
    ["Travel", account.travelExpense.id],
    ["Utilities", account.utilitiesExpense.id],
  ];
  const merchants = Array.from({ length: 55 }, (_, index) => `NR Stress Vendor Receipt ${index + 1}`);

  const receipts = [];
  for (let i = 0; i < config.receipts; i += 1) {
    const [category, expenseAccountId] = categories[i % categories.length];
    const amount = round2(280 + ((i * 431) % 9300));
    const vatAmount = i % 11 === 0 ? 0 : round2(amount * 0.05);
    const date = ymd(addDays(dates.startDate, i % 165));
    const receipt = await http("create receipt", `/api/companies/${companyId}/receipts`, {
      method: "POST",
      body: {
        merchant: merchants[i % merchants.length],
        category,
        amount,
        vatAmount,
        currency: "AED",
        exchangeRate: 1,
        date,
        notes: "Synthetic Najma Raida stress receipt",
      },
    });
    receipts.push(receipt);
    count("receipts");

    if (i % 4 !== 0) {
      await http("post receipt", `/api/receipts/${receipt.id}/post`, {
        method: "POST",
        body: { accountId: expenseAccountId, paymentAccountId: account.bank.id },
      });
      summary.expected.postedReceiptExpenseAed += amount;
      summary.expected.postedReceiptVatAed += vatAmount;
      count("postedReceipts");
    }

    if ((i + 1) % 25 === 0) log(`Created ${i + 1}/${config.receipts} receipts`);
  }
  return receipts;
}

async function seedBills(companyId, dates, account) {
  const vendors = Array.from({ length: 46 }, (_, index) => `NR Stress Supplier ${index + 1} LLC`);
  const categories = [
    ["Software", account.softwareExpense.id],
    ["Utilities", account.utilitiesExpense.id],
    ["Professional Services", account.professionalExpense.id],
    ["Marketing", account.marketingExpense.id],
    ["Office Supplies", account.suppliesExpense.id],
  ];

  const bills = [];
  for (let i = 0; i < config.bills; i += 1) {
    const [category, accountId] = categories[i % categories.length];
    const isUsd = i % 23 === 0;
    const amount = round2(650 + ((i * 887) % 15000));
    const date = ymd(addDays(dates.startDate, i % 165));
    const dueDate = ymd(addDays(new Date(date), (i % 5) * 9 - 12));
    const bill = await http("create bill", `/api/companies/${companyId}/bills`, {
      method: "POST",
      body: {
        vendor_name: vendors[i % vendors.length],
        vendor_trn: `10044444${String(i % 10000000).padStart(7, "0")}`.slice(0, 15),
        bill_number: `STRESS-BILL-${runStamp}-${String(i + 1).padStart(4, "0")}`,
        bill_date: date,
        due_date: dueDate,
        currency: isUsd ? "USD" : "AED",
        exchange_rate: isUsd ? 3.67 : 1,
        category,
        notes: "Synthetic Najma Raida stress vendor bill",
        line_items: [
          {
            description: category,
            quantity: 1,
            unit_price: amount,
            vat_rate: i % 13 === 0 ? 0 : 5,
            account_id: accountId,
          },
        ],
      },
    });
    bills.push(bill);
    count("bills");
    await http("approve bill", `/api/bills/${bill.id}/approve`, { method: "POST", body: {} });

    const total = safeNumber(bill.total_amount);
    const rate = isUsd ? 3.67 : 1;
    summary.expected.billTotalAed += total * rate;

    if (i % 4 === 0) {
      const payment = round2(total * (i % 8 === 0 ? 1 : 0.5));
      await http("pay bill", `/api/bills/${bill.id}/payments`, {
        method: "POST",
        body: {
          payment_date: ymd(addDays(new Date(date), 10)),
          amount: payment,
          payment_method: "bank_transfer",
          reference: `STRESS-BPAY-${runStamp}-${i}`,
          notes: "Synthetic Najma Raida bill payment",
        },
      });
      summary.expected.billPaymentsAed += payment * rate;
      count("billPayments");
    }

    if ((i + 1) % 25 === 0) log(`Created ${i + 1}/${config.bills} bills`);
  }
  return bills;
}

async function seedManualJournals(companyId, account, dates, costCenters) {
  const expenseAccounts = [
    account.professionalExpense,
    account.softwareExpense,
    account.marketingExpense,
    account.utilitiesExpense,
    account.travelExpense,
  ];

  for (let i = 0; i < config.journals; i += 1) {
    const date = ymd(addDays(dates.startDate, i % 165));
    const center = costCenters[i % costCenters.length];
    if (i % 3 === 0) {
      const amount = round2(3500 + ((i * 113) % 9000));
      await http("manual revenue journal", `/api/companies/${companyId}/journal`, {
        method: "POST",
        body: {
          date,
          status: "posted",
          memo: `Synthetic advisory revenue allocation ${i + 1}`,
          source: "report-stress-fixture",
          lines: [
            { accountId: account.bank.id, debit: amount, credit: 0, description: "Bank receipt" },
            {
              accountId: account.revenue.id,
              costCenterId: center?.id,
              debit: 0,
              credit: amount,
              description: "Manual advisory revenue",
            },
          ],
        },
      });
      summary.expected.manualRevenueAed += amount;
    } else {
      const expense = expenseAccounts[i % expenseAccounts.length];
      const amount = round2(900 + ((i * 97) % 5200));
      await http("manual expense journal", `/api/companies/${companyId}/journal`, {
        method: "POST",
        body: {
          date,
          status: "posted",
          memo: `Synthetic accrual expense allocation ${i + 1}`,
          source: "report-stress-fixture",
          lines: [
            {
              accountId: expense.id,
              costCenterId: center?.id,
              debit: amount,
              credit: 0,
              description: "Manual accrual expense",
            },
            { accountId: account.ap.id, debit: 0, credit: amount, description: "Accrued payable" },
          ],
        },
      });
      summary.expected.manualExpenseAed += amount;
    }
    count("journalEntries");
    if ((i + 1) % 20 === 0) log(`Created ${i + 1}/${config.journals} manual journals`);
  }
}

async function seedPayroll(companyId, dates) {
  for (let i = 0; i < config.employees; i += 1) {
    await http("create employee", `/api/companies/${companyId}/employees`, {
      method: "POST",
      body: {
        employeeNumber: `NR-STRESS-E${String(i + 1).padStart(3, "0")}-${runStamp}`,
        fullName: `Najma Raida Stress Employee ${i + 1}`,
        nationality: i % 3 === 0 ? "UAE" : i % 3 === 1 ? "India" : "Pakistan",
        bankName: i % 2 === 0 ? "Emirates NBD" : "ADCB",
        bankAccountNumber: `9876500${String(i).padStart(3, "0")}`,
        iban: `AE07033123456789012${String(3400 + i).padStart(4, "0")}`,
        routingCode: "302620122",
        department: i % 2 === 0 ? "Accounting" : "Operations",
        designation: i % 2 === 0 ? "Accountant" : "Bookkeeper",
        joinDate: "2024-01-01",
        basicSalary: 8500 + i * 600,
        housingAllowance: 2500 + i * 120,
        transportAllowance: 650,
        otherAllowance: 350,
        status: "active",
      },
    });
    count("employees");
  }

  const now = new Date();
  for (let offset = 0; offset < 3; offset += 1) {
    const periodDate = monthStart(now, -offset);
    const run = await http("create payroll run", `/api/companies/${companyId}/payroll-runs`, {
      method: "POST",
      body: { periodMonth: periodDate.getUTCMonth() + 1, periodYear: periodDate.getUTCFullYear() },
    });
    count("payrollRuns");
    await http("calculate payroll", `/api/payroll-runs/${run.id}/calculate`, {
      method: "POST",
      body: {},
    });
    if (offset > 0) {
      await optional("approve payroll run", () =>
        http("approve payroll run", `/api/payroll-runs/${run.id}/approve`, {
          method: "POST",
          body: {},
        })
      );
      await optional("generate WPS SIF", () =>
        http("generate WPS SIF", `/api/payroll-runs/${run.id}/generate-sif`)
      );
    }
  }
}

async function seedInventoryAndAssets(companyId, account, dates) {
  for (let i = 0; i < 15; i += 1) {
    const product = await http("create product", `/api/companies/${companyId}/products`, {
      method: "POST",
      body: {
        name: `NR Stress Product ${i + 1}`,
        sku: `NR-STRESS-SKU-${runStamp}-${i + 1}`,
        description: "Synthetic report stress product",
        unitPrice: String(900 + i * 175),
        costPrice: String(420 + i * 90),
        vatRate: "0.05",
        unit: "each",
        currentStock: 20 + i,
        lowStockThreshold: i % 4 === 0 ? 35 : 5,
      },
    });
    count("products");
    for (const movement of [
      { type: "purchase", quantity: 35 + i, unitCost: String(420 + i * 90), reference: `STOCK-IN-${i}` },
      { type: "sale", quantity: 11 + (i % 6), unitCost: String(420 + i * 90), reference: `STOCK-OUT-${i}` },
    ]) {
      await http("inventory movement", `/api/products/${product.id}/movements`, {
        method: "POST",
        body: { ...movement, notes: "Synthetic stress inventory movement" },
      });
      count("inventoryMovements");
    }
  }

  for (let i = 0; i < 12; i += 1) {
    const asset = await optional("create fixed asset", () =>
      http("create fixed asset", `/api/companies/${companyId}/fixed-assets`, {
        method: "POST",
        body: {
          assetName: `NR Stress Fixed Asset ${i + 1}`,
          assetNumber: `NR-FA-${runStamp}-${i + 1}`,
          category: i % 2 === 0 ? "Computers & Software" : "Furniture & Fixtures",
          purchaseDate: ymd(addDays(dates.startDate, i * 7)),
          purchaseCost: 9500 + i * 1750,
          salvageValue: 500,
          usefulLifeYears: i % 2 === 0 ? 3 : 5,
          depreciationMethod: "straight_line",
          location: "Dubai HQ",
          serialNumber: `NR-SER-${runStamp}-${i + 1}`,
          notes: "Synthetic stress fixed asset",
          paymentAccountId: account.bank.id,
        },
      })
    );
    if (asset?.id) count("fixedAssets");
  }
}

async function seedExpenseClaims(companyId, dates) {
  for (let i = 0; i < 18; i += 1) {
    const claim = await http("create expense claim", `/api/companies/${companyId}/expense-claims`, {
      method: "POST",
      body: {
        title: `NR Stress Expense Claim ${i + 1}`,
        description: "Synthetic stress claim",
        currency: "AED",
        items: [
          {
            expense_date: ymd(addDays(dates.startDate, i * 3)),
            category: i % 2 === 0 ? "Travel" : "Meals",
            description: "Synthetic reimbursable item",
            amount: 250 + i * 45,
            vat_amount: round2((250 + i * 45) * 0.05),
            merchant_name: `Claim Merchant ${i + 1}`,
          },
        ],
      },
    });
    count("expenseClaims");
    await http("submit expense claim", `/api/expense-claims/${claim.id}/submit`, {
      method: "POST",
      body: {},
    });
    if (i % 2 === 0) {
      await http("approve expense claim", `/api/expense-claims/${claim.id}/approve`, {
        method: "POST",
        body: { review_notes: "Synthetic stress approval" },
      });
    }
  }
}

async function seedBudgetAndTax(companyId, account, dates) {
  const year = new Date(dates.end).getUTCFullYear();
  const budget = await http("create budget plan", `/api/companies/${companyId}/budget-plans`, {
    method: "POST",
    body: {
      name: `NR Stress Budget ${year}`,
      fiscalYear: year,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      notes: "Synthetic stress budget",
    },
  });
  count("budgetPlans");

  for (const [accountId, category, amount] of [
    [account.revenue.id, "Revenue", 260000],
    [account.salariesExpense.id, "Payroll", 125000],
    [account.softwareExpense.id, "Technology", 24000],
    [account.marketingExpense.id, "Marketing", 18000],
  ]) {
    await http("create budget line", `/api/budget-plans/${budget.id}/lines`, {
      method: "POST",
      body: {
        accountId,
        category,
        description: `${category} stress budget`,
        jan: amount,
        feb: amount,
        mar: amount,
        apr: amount,
        may: amount,
        jun: amount,
        jul: amount,
        aug: amount,
        sep: amount,
        oct: amount,
        nov: amount,
        dec: amount,
      },
    });
    count("budgetLines");
  }
  await optional("approve budget", () =>
    http("approve budget", `/api/budget-plans/${budget.id}/approve`, { method: "POST", body: {} })
  );

  await optional("generate VAT return", () =>
    http("generate VAT return", `/api/companies/${companyId}/vat-returns/generate`, {
      method: "POST",
      body: { periodStart: dates.start, periodEnd: dates.end, dueDate: ymd(addDays(new Date(), 28)) },
    })
  );
  await optional("create corporate tax return", async () => {
    const ctReturn = await http("create corporate tax return", `/api/companies/${companyId}/corporate-tax/returns`, {
      method: "POST",
      body: {
        taxPeriodStart: `${year}-01-01`,
        taxPeriodEnd: `${year}-12-31`,
        totalRevenue: round2(summary.expected.salesIssuedSubtotalAed + summary.expected.manualRevenueAed),
        totalExpenses: round2(summary.expected.billTotalAed + summary.expected.postedReceiptExpenseAed),
        totalDeductions: 25000,
        exemptionThreshold: 375000,
        taxRate: 0.09,
        status: "draft",
      },
    });
    count("corporateTaxReturns");
    await http("compute corporate tax return", `/api/corporate-tax/returns/${ctReturn.id}/compute`, {
      method: "POST",
      body: { adjustments: [{ label: "Stress entertainment add-back", amount: 7500, direction: "add_back" }] },
    });
  });

  return budget;
}

async function seedBank(companyId, account, dates) {
  const bankAccount = await http("create bank account", `/api/companies/${companyId}/bank-accounts`, {
    method: "POST",
    body: {
      nameEn: "Najma Raida Stress Operating Account",
      bankName: "Emirates NBD",
      accountNumber: `NRSTRESS${runStamp}`,
      iban: "AE070331234567890123456",
      currency: "AED",
      glAccountId: account.bank.id,
    },
  });
  count("bankAccounts");

  const rows = ["date,description,debit,credit,balance,reference"];
  let balance = 1250000;
  for (let i = 0; i < config.bankTransactions; i += 1) {
    const credit = i % 3 === 0 ? round2(2500 + ((i * 191) % 17500)) : 0;
    const debit = credit ? 0 : round2(300 + ((i * 173) % 8500));
    balance = round2(balance + credit - debit);
    rows.push(
      `${ymd(addDays(dates.startDate, i % 165))},NR stress bank txn ${i + 1},${debit || ""},${credit || ""},${balance},BANK-STRESS-${runStamp}-${i + 1}`
    );
  }
  await http("import bank statement", `/api/companies/${companyId}/bank-statements/import`, {
    method: "POST",
    body: { bankAccountId: bankAccount.id, csvContent: rows.join("\n") },
  });
  count("bankStatementImports");
  count("bankTransactions", config.bankTransactions);
}

async function probeReports(companyId, dates) {
  const start = dates.start;
  const end = dates.end;
  const [invoices, receipts, bills, journals, payrollRuns] = await Promise.all([
    http("invoice list", `/api/companies/${companyId}/invoices?limit=1000`),
    http("receipt list", `/api/companies/${companyId}/receipts`),
    http("bill list", `/api/companies/${companyId}/bills`),
    http("journal list", `/api/companies/${companyId}/journal`),
    http("payroll runs", `/api/companies/${companyId}/payroll-runs`),
  ]);

  assertProbe("Invoice volume loaded", Array.isArray(invoices) && invoices.length >= config.invoices, {
    expected: config.invoices,
    actual: invoices?.length || 0,
  });
  assertProbe("Receipt volume loaded", Array.isArray(receipts) && receipts.length >= config.receipts, {
    expected: config.receipts,
    actual: receipts?.length || 0,
  });
  assertProbe("Bill volume loaded", Array.isArray(bills) && bills.length >= config.bills, {
    expected: config.bills,
    actual: bills?.length || 0,
  });
  assertProbe("Journal volume loaded", Array.isArray(journals) && journals.length >= config.journals, {
    expectedAtLeast: config.journals,
    actual: journals?.length || 0,
  });
  assertProbe("Payroll runs loaded", Array.isArray(payrollRuns) && payrollRuns.length >= 3, {
    actual: payrollRuns?.length || 0,
  });

  const pl = await http("P&L report", `/api/companies/${companyId}/reports/pl?startDate=${start}&endDate=${end}`);
  const expectedRevenueFloor = round2(summary.expected.salesIssuedSubtotalAed * 0.95);
  assertProbe("P&L revenue reflects loaded sales", safeNumber(pl.totalRevenue) >= expectedRevenueFloor, {
    actualRevenue: round2(pl.totalRevenue),
    expectedSalesSubtotalAed: round2(summary.expected.salesIssuedSubtotalAed),
    expectedRevenueFloor,
  });
  assertProbe("P&L expenses reflect loaded costs", safeNumber(pl.totalExpenses) > 0, {
    totalExpenses: round2(pl.totalExpenses),
    expectedBillsAed: round2(summary.expected.billTotalAed),
    expectedPostedReceiptExpenseAed: round2(summary.expected.postedReceiptExpenseAed),
  });

  const trialBalance = await http(
    "trial balance report",
    `/api/companies/${companyId}/reports/trial-balance?from=${start}&to=${end}`
  );
  assertProbe("Trial balance balances", safeNumber(trialBalance?.totals?.difference) <= 0.05, {
    totals: trialBalance?.totals,
  });

  const balance = await http(
    "balance sheet report",
    `/api/companies/${companyId}/reports/balance-sheet?startDate=${start}&endDate=${end}`
  );
  const bsDifference = Math.abs(
    safeNumber(balance.totalAssets) -
      (safeNumber(balance.totalLiabilities) + safeNumber(balance.totalEquity))
  );
  assertProbe("Balance sheet balances", bsDifference <= 0.05, {
    totalAssets: round2(balance.totalAssets),
    totalLiabilities: round2(balance.totalLiabilities),
    totalEquity: round2(balance.totalEquity),
    difference: round2(bsDifference),
  });

  const salesByProduct = await http(
    "sales by product/service",
    `/api/companies/${companyId}/reports/sales-product-service?startDate=${start}&endDate=${end}`
  );
  const salesDiff = Math.abs(
    safeNumber(salesByProduct?.totals?.amountAed) - summary.expected.salesIssuedSubtotalAed
  );
  assertProbe("Sales by product/service ties to issued invoice subtotal", salesDiff <= 1, {
    reportAmountAed: round2(salesByProduct?.totals?.amountAed),
    expectedIssuedSubtotalAed: round2(summary.expected.salesIssuedSubtotalAed),
    difference: round2(salesDiff),
    rows: salesByProduct?.rows?.length || 0,
  });

  const vatSummary = await http(
    "VAT summary",
    `/api/companies/${companyId}/reports/vat-summary?startDate=${start}&endDate=${end}`
  );
  const aging = await http("aging report", `/api/reports/${companyId}/aging`);
  const costCenters = await http(
    "cost-center profitability",
    `/api/companies/${companyId}/cost-centers/profitability?startDate=${start}&endDate=${end}`
  );
  const balanceSummaries = await http("balance summaries", `/api/companies/${companyId}/reports/balance-summaries`);
  const bankReport = await optional("bank statement report", () =>
    http("bank statement report", `/api/companies/${companyId}/bank-statements/report`)
  );

  summary.reportSnapshots = {
    pl: {
      totalRevenue: round2(pl.totalRevenue),
      totalExpenses: round2(pl.totalExpenses),
      netProfit: round2(pl.netProfit),
    },
    trialBalance: trialBalance?.totals,
    balanceSheet: {
      totalAssets: round2(balance.totalAssets),
      totalLiabilities: round2(balance.totalLiabilities),
      totalEquity: round2(balance.totalEquity),
      difference: round2(bsDifference),
    },
    salesByProduct: salesByProduct?.totals,
    vatSummary,
    agingRows: Array.isArray(aging) ? aging.length : 0,
    costCenterTotals: costCenters?.totals,
    balanceSummaryKeys: Object.keys(balanceSummaries || {}),
    bankReport: bankReport
      ? {
          totalTransactions: bankReport.totalTransactions,
          reconciledCount: bankReport.reconciledCount,
          unreconciledCount: bankReport.unreconciledCount,
        }
      : null,
  };
}

async function main() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  await authenticate();
  const company = await getOrCreateCompany();
  const companyId = company.id;
  const account = await loadAccounts(companyId);
  const now = new Date();
  const dates = {
    startDate: monthStart(now, -5),
    start: ymd(monthStart(now, -5)),
    end: ymd(monthEnd(now, 0)),
  };

  log("Seeding opening balances, exchange rates, and cost centers");
  await seedOpeningBalances(companyId, account, dates);
  const costCenters = await seedCostCenters(companyId);

  log("Seeding high-volume invoices");
  await seedInvoices(companyId, account, dates);
  log("Seeding high-volume receipts");
  await seedReceipts(companyId, account, dates);
  log("Seeding high-volume vendor bills");
  await seedBills(companyId, dates, account);
  log("Seeding manual general journals");
  await seedManualJournals(companyId, account, dates, costCenters);
  log("Seeding payroll");
  await seedPayroll(companyId, dates);
  log("Seeding inventory, fixed assets, claims, budget, tax, and bank");
  await seedInventoryAndAssets(companyId, account, dates);
  await seedExpenseClaims(companyId, dates);
  await seedBudgetAndTax(companyId, account, dates);
  await seedBank(companyId, account, dates);

  for (const key of Object.keys(summary.expected)) {
    summary.expected[key] = round2(summary.expected[key]);
  }

  log("Running report probes");
  await probeReports(companyId, dates);

  summary.finishedAt = new Date().toISOString();
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  log(`complete: ${ARTIFACT_PATH}`);
  log(`company: ${summary.company.name} (${summary.company.id})`);
}

main().catch(async (error) => {
  summary.finishedAt = new Date().toISOString();
  summary.failure = error?.message || String(error);
  await fs.mkdir(ARTIFACT_DIR, { recursive: true }).catch(() => {});
  await fs.writeFile(ARTIFACT_PATH, `${JSON.stringify(summary, null, 2)}\n`).catch(() => {});
  console.error(error);
  process.exit(1);
});
