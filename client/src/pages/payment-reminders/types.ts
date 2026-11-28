// Shapes of the /api/chasing/* responses (server/services/payment-chasing.service.ts).

export type AgingBucket = "1-7" | "8-30" | "31-60" | "60+";
export const AGING_BUCKETS: AgingBucket[] = ["1-7", "8-30", "31-60", "60+"];
export const REMINDER_LEVELS = [1, 2, 3, 4] as const;
export type ReminderLevel = (typeof REMINDER_LEVELS)[number];

export interface AgingRow {
  invoice: {
    id: string;
    number: string;
    customerName: string;
    currency: string;
    total: number;
    dueDate: string | null;
    status: string;
    contactId?: string | null;
    chaseLevel?: number;
    lastChasedAt?: string | null;
    doNotChase?: boolean;
  };
  paidAmount: number;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucket;
  recommendedLevel: ReminderLevel;
  nextLevel?: ReminderLevel;
}

export interface OverdueResponse {
  rows: AgingRow[];
  buckets: Record<AgingBucket, number>;
  totalOutstanding: number;
}

export interface QueueResponse {
  queue: AgingRow[];
  config: {
    frequencyDays: number;
    maxLevel: number;
    preferredMethod: string;
    autoChaseEnabled: boolean;
  };
}

export interface ChaseRecord {
  id: string;
  invoiceId: string;
  level: number;
  method: string;
  language: string;
  messageText: string;
  daysOverdueAtSend: number;
  amountAtSend: number;
  status: string;
  sentAt: string;
  paidAt: string | null;
}

export interface Effectiveness {
  totalChases: number;
  uniqueInvoices: number;
  paidAfterChase: number;
  paidWithin7: number;
  paidWithin14: number;
  paidWithin30: number;
  conversionRate: number;
  avgDaysToPayment: number | null;
  byLevel: Record<string, { sent: number; paid: number }>;
}

export interface ReminderTemplate {
  id: string;
  companyId: string | null;
  level: number;
  language: string;
  subject: string | null;
  body: string;
  isDefault: boolean;
}

export interface ChaseConfig {
  companyId: string;
  autoChaseEnabled: boolean;
  chaseFrequencyDays: number;
  maxLevel: number;
  preferredMethod: string;
  doNotChaseContactIds: string;
  defaultLanguage: string;
}

export interface BulkSendResponse {
  sent: number;
  skipped: number;
  failed: number;
  results: Array<{ invoiceId: string; level: number; status: string; error?: string }>;
}

/** Merge fields the payment-reminder renderer knows (RenderContext in the service). */
export const CHASE_FIELDS = [
  "customerName",
  "invoiceNumber",
  "amount",
  "currency",
  "dueDate",
  "daysOverdue",
  "paymentLink",
  "senderName",
] as const;

/** Badge tone of a sent reminder's status. */
export function recordStatusTone(status: string): "danger" | "success" | "neutral" {
  return status === "failed" ? "danger" : status === "paid" ? "success" : "neutral";
}
