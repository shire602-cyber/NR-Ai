import type { 
  User, InsertUser,
  Company, InsertCompany,
  CompanyUser, InsertCompanyUser,
  Account, InsertAccount,
  JournalEntry, InsertJournalEntry,
  JournalLine, InsertJournalLine,
  Invoice, InsertInvoice,
  InvoiceLine, InsertInvoiceLine,
  Receipt, InsertReceipt
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Companies
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyByName(name: string): Promise<Company | undefined>;
  getCompaniesByUserId(userId: string): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  
  // Company Users
  createCompanyUser(companyUser: InsertCompanyUser): Promise<CompanyUser>;
  getUserRole(companyId: string, userId: string): Promise<CompanyUser | undefined>;
  
  // Accounts
  getAccount(id: string): Promise<Account | undefined>;
  getAccountsByCompanyId(companyId: string): Promise<Account[]>;
  getAccountByCode(companyId: string, code: string): Promise<Account | undefined>;
  createAccount(account: InsertAccount): Promise<Account>;
  
  // Journal Entries
  getJournalEntry(id: string): Promise<JournalEntry | undefined>;
  getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
  
  // Journal Lines
  createJournalLine(line: InsertJournalLine): Promise<JournalLine>;
  getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]>;
  
  // Invoices
  getInvoice(id: string): Promise<Invoice | undefined>;
  getInvoicesByCompanyId(companyId: string): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoiceStatus(id: string, status: string): Promise<Invoice>;
  
  // Invoice Lines
  createInvoiceLine(line: InsertInvoiceLine): Promise<InvoiceLine>;
  getInvoiceLinesByInvoiceId(invoiceId: string): Promise<InvoiceLine[]>;
  
  // Receipts
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  getReceiptsByCompanyId(companyId: string): Promise<Receipt[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private companies: Map<string, Company>;
  private companyUsers: Map<string, CompanyUser>;
  private accounts: Map<string, Account>;
  private journalEntries: Map<string, JournalEntry>;
  private journalLines: Map<string, JournalLine>;
  private invoices: Map<string, Invoice>;
  private invoiceLines: Map<string, InvoiceLine>;
  private receipts: Map<string, Receipt>;

  constructor() {
    this.users = new Map();
    this.companies = new Map();
    this.companyUsers = new Map();
    this.accounts = new Map();
    this.journalEntries = new Map();
    this.journalLines = new Map();
    this.invoices = new Map();
    this.invoiceLines = new Map();
    this.receipts = new Map();
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.email === email);
  }

  async createUser(insertUser: InsertUser & { passwordHash?: string }): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      email: insertUser.email,
      name: insertUser.name,
      passwordHash: (insertUser as any).passwordHash || '',
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  // Companies
  async getCompany(id: string): Promise<Company | undefined> {
    return this.companies.get(id);
  }

  async getCompanyByName(name: string): Promise<Company | undefined> {
    return Array.from(this.companies.values()).find(c => c.name === name);
  }

  async getCompaniesByUserId(userId: string): Promise<Company[]> {
    const userCompanyIds = Array.from(this.companyUsers.values())
      .filter(cu => cu.userId === userId)
      .map(cu => cu.companyId);
    
    return Array.from(this.companies.values())
      .filter(c => userCompanyIds.includes(c.id));
  }

  async createCompany(insertCompany: InsertCompany): Promise<Company> {
    const id = randomUUID();
    const company: Company = {
      id,
      ...insertCompany,
      createdAt: new Date(),
    };
    this.companies.set(id, company);
    return company;
  }

  // Company Users
  async createCompanyUser(insertCompanyUser: InsertCompanyUser): Promise<CompanyUser> {
    const id = randomUUID();
    const companyUser: CompanyUser = {
      id,
      ...insertCompanyUser,
      createdAt: new Date(),
    };
    this.companyUsers.set(id, companyUser);
    return companyUser;
  }

  async getUserRole(companyId: string, userId: string): Promise<CompanyUser | undefined> {
    return Array.from(this.companyUsers.values()).find(
      cu => cu.companyId === companyId && cu.userId === userId
    );
  }

  // Accounts
  async getAccount(id: string): Promise<Account | undefined> {
    return this.accounts.get(id);
  }

  async getAccountsByCompanyId(companyId: string): Promise<Account[]> {
    return Array.from(this.accounts.values())
      .filter(a => a.companyId === companyId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getAccountByCode(companyId: string, code: string): Promise<Account | undefined> {
    return Array.from(this.accounts.values()).find(
      a => a.companyId === companyId && a.code === code
    );
  }

  async createAccount(insertAccount: InsertAccount): Promise<Account> {
    const id = randomUUID();
    const account: Account = {
      id,
      ...insertAccount,
      createdAt: new Date(),
    };
    this.accounts.set(id, account);
    return account;
  }

  // Journal Entries
  async getJournalEntry(id: string): Promise<JournalEntry | undefined> {
    return this.journalEntries.get(id);
  }

  async getJournalEntriesByCompanyId(companyId: string): Promise<JournalEntry[]> {
    return Array.from(this.journalEntries.values())
      .filter(je => je.companyId === companyId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async createJournalEntry(insertEntry: InsertJournalEntry): Promise<JournalEntry> {
    const id = randomUUID();
    const entry: JournalEntry = {
      id,
      ...insertEntry,
      createdAt: new Date(),
    };
    this.journalEntries.set(id, entry);
    return entry;
  }

  // Journal Lines
  async createJournalLine(insertLine: InsertJournalLine): Promise<JournalLine> {
    const id = randomUUID();
    const line: JournalLine = {
      id,
      ...insertLine,
    };
    this.journalLines.set(id, line);
    return line;
  }

  async getJournalLinesByEntryId(entryId: string): Promise<JournalLine[]> {
    return Array.from(this.journalLines.values())
      .filter(jl => jl.entryId === entryId);
  }

  // Invoices
  async getInvoice(id: string): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }

  async getInvoicesByCompanyId(companyId: string): Promise<Invoice[]> {
    return Array.from(this.invoices.values())
      .filter(inv => inv.companyId === companyId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  async createInvoice(insertInvoice: InsertInvoice): Promise<Invoice> {
    const id = randomUUID();
    const invoice: Invoice = {
      id,
      ...insertInvoice,
      createdAt: new Date(),
    };
    this.invoices.set(id, invoice);
    return invoice;
  }

  async updateInvoiceStatus(id: string, status: string): Promise<Invoice> {
    const invoice = this.invoices.get(id);
    if (!invoice) {
      throw new Error('Invoice not found');
    }
    const updated = { ...invoice, status };
    this.invoices.set(id, updated);
    return updated;
  }

  // Invoice Lines
  async createInvoiceLine(insertLine: InsertInvoiceLine): Promise<InvoiceLine> {
    const id = randomUUID();
    const line: InvoiceLine = {
      id,
      ...insertLine,
    };
    this.invoiceLines.set(id, line);
    return line;
  }

  async getInvoiceLinesByInvoiceId(invoiceId: string): Promise<InvoiceLine[]> {
    return Array.from(this.invoiceLines.values())
      .filter(il => il.invoiceId === invoiceId);
  }

  // Receipts
  async createReceipt(insertReceipt: InsertReceipt): Promise<Receipt> {
    const id = randomUUID();
    const receipt: Receipt = {
      id,
      ...insertReceipt,
      createdAt: new Date(),
    };
    this.receipts.set(id, receipt);
    return receipt;
  }

  async getReceiptsByCompanyId(companyId: string): Promise<Receipt[]> {
    return Array.from(this.receipts.values())
      .filter(r => r.companyId === companyId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export const storage = new MemStorage();
