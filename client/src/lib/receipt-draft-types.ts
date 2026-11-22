import type { ConfidenceBand, ReviewSnapshot, ValidationIssue } from "@shared/receipt-confidence";

export interface ExtractedData {
  merchant?: string;
  date?: string;
  invoiceNumber?: string | null;
  subtotal?: number;
  vatPercentage?: number;
  vatAmount?: number;
  total?: number;
  currency?: string;
  rawText: string;
  category?: string;
  lineItems?: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  confidence?: number;
  suggestedCategory?: string;
  classifier?: { method?: string; confidence?: number; reason?: string } | null;
  // Confidence banding and review routing (R05-23)
  confidenceBand?: ConfidenceBand;
  reviewReasons?: string[];
  reviewReasonCodes?: string[];
  validationIssues?: Pick<ValidationIssue, "code">[];
  reviewed?: boolean;
  original?: ReviewSnapshot;
  ocrSource?: string;
  // FTA tax-invoice signals (R05-17)
  supplierTrn?: string | null;
  isTaxInvoice?: boolean;
  simplifiedInvoice?: boolean;
  reverseChargeSuggested?: boolean;
  // Set after the server reported an exact duplicate and the user chose to upload anyway.
  confirmDuplicate?: boolean;
}

export interface ProcessedReceipt {
  id: string;
  companyId: string;
  file: File;
  preview: string;
  status: "pending" | "processing" | "completed" | "saved" | "error" | "save_error";
  progress: number;
  data?: ExtractedData;
  error?: string;
  /** True when the server rejected the save as an exact duplicate (409). */
  duplicate?: boolean;
}
