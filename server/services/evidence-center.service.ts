import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
// @ts-ignore - pdfkit has no type declarations
import PDFDocument from "pdfkit";

import { storage } from "../storage";
import { pool } from "../db";
import { getCloseChecklist } from "./month-end.service";
import { getVatWorkpaperDetail, listVatWorkpapers } from "./firm-vat-workspace.service";
import type {
  EvidenceAuditEntry,
  EvidenceCenterResponse,
  EvidenceIssue,
  EvidenceOwnerAction,
  EvidenceProofLine,
  EvidenceRefundPack,
  EvidenceTimelineItem,
  EvidenceWorkflow,
  EvidenceWorkflowId,
} from "../../shared/evidence-center";
import {
  formatEvidenceRequestDraft,
  scoreEvidenceReadiness,
  scoreFromOpenItems,
  statusFromScore,
} from "../../shared/evidence-center";

type AnyRecord = Record<string, any>;

interface EvidenceZipEntry {
  path: string;
  data: Buffer;
  modifiedAt?: Date;
}

interface EvidenceBundleManifestEntry {
  sourceType: string;
  sourceId: string | null;
  label: string;
  documentNumber: string | null;
  party: string | null;
  date: string | null;
  status: string;
  evidenceStatus: EvidenceProofLine["documentStatus"];
  sourceFile: string | null;
  zipPath: string | null;
  included: boolean;
  reason: string | null;
}

const OUTPUT_VAT_CATEGORIES = new Set([
  "standard_sale",
  "tourist_refund",
  "reverse_charge_output",
  "zero_rated_sale",
  "exempt_sale",
  "import",
  "import_adjustment",
]);

const INPUT_VAT_CATEGORIES = new Set(["standard_expense", "reverse_charge_input"]);

function toMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function isoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function currentQuarter(now = new Date()) {
  const startMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(now.getUTCFullYear(), startMonth, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), startMonth + 3, 0, 23, 59, 59, 999));
  return { start, end };
}

function currentMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

function inRange(value: Date | string | null | undefined, start: Date, end: Date): boolean {
  const date = value instanceof Date ? value : value ? new Date(value) : null;
  return !!date && !Number.isNaN(date.getTime()) && date >= start && date <= end;
}

async function optionalRows<T = AnyRecord>(sql: string, params: unknown[]): Promise<T[]> {
  try {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } catch {
    return [];
  }
}

function makeIssue(input: EvidenceIssue): EvidenceIssue {
  return { resolutionStatus: "open", ...input };
}

function parseJsonRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function actionFromLogAction(action: string): EvidenceAuditEntry["action"] | null {
  if (action === "resolve") return "resolve";
  if (action === "waive") return "waive";
  if (action === "request_reviewed") return "request_reviewed";
  if (action === "refund_pack_exported") return "refund_pack_exported";
  return null;
}

function activityLogToEvidenceAuditEntry(log: AnyRecord): EvidenceAuditEntry | null {
  const action = actionFromLogAction(String(log.action || ""));
  if (!action) return null;

  const metadata = parseJsonRecord(log.metadata);
  if (metadata.source !== "evidence-center") return null;

  return {
    id: String(log.id),
    action,
    entityType: String(log.entityType || ""),
    entityId: log.entityId ? String(log.entityId) : null,
    description: String(log.description || ""),
    reason: typeof metadata.reason === "string" ? metadata.reason : undefined,
    actorId: log.userId ? String(log.userId) : null,
    createdAt: isoDate(log.createdAt) || new Date().toISOString(),
  };
}

function applyIssueAudit(
  issues: EvidenceIssue[],
  auditTrail: EvidenceAuditEntry[]
): EvidenceIssue[] {
  return issues.map((issue) => {
    const latest = auditTrail.find(
      (entry) =>
        entry.entityType === "evidence_issue" &&
        entry.entityId === issue.id &&
        (entry.action === "resolve" || entry.action === "waive")
    );

    if (!latest) return { resolutionStatus: "open", ...issue };

    return {
      ...issue,
      resolutionStatus: latest.action === "resolve" ? "resolved" : "waived",
      resolutionReason: latest.reason,
      resolvedAt: latest.createdAt,
    };
  });
}

function openIssues(issues: EvidenceIssue[]): EvidenceIssue[] {
  return issues.filter((issue) => (issue.resolutionStatus ?? "open") === "open");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildRefundPackSummary(
  companyId: string,
  companyName: string,
  input: {
    periodStart: string;
    periodEnd: string;
    proofLineCount: number;
    readyAttachmentCount: number;
    missingAttachmentCount: number;
    gapCount: number;
  }
): EvidenceRefundPack {
  const companySlug = slug(companyName) || companyId.slice(0, 8);
  const periodSlug = `${input.periodStart}_${input.periodEnd}`;

  return {
    workbookHref: `/api/companies/${companyId}/evidence-center/refund-pack.xlsx`,
    coverHref: `/api/companies/${companyId}/evidence-center/refund-pack-cover.pdf`,
    bundleHref: `/api/companies/${companyId}/evidence-center/refund-pack.zip`,
    workbookFilename: `evidence-refund-pack-${companySlug}-${periodSlug}.xlsx`,
    coverFilename: `evidence-refund-pack-cover-${companySlug}-${periodSlug}.pdf`,
    bundleFilename: `evidence-refund-pack-${companySlug}-${periodSlug}.zip`,
    sheetCount: 6,
    proofLineCount: input.proofLineCount,
    readyAttachmentCount: input.readyAttachmentCount,
    missingAttachmentCount: input.missingAttachmentCount,
    gapCount: input.gapCount,
    contents: [
      "PDF-ready cover summary",
      "VAT refund totals",
      "Proof index with source row references",
      "Missing evidence gap report",
      "Pre-filing risk scan",
      "Evidence action audit trail",
      "Source-evidence ZIP manifest with available attachments",
    ],
  };
}

function safeZipSegment(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return (cleaned || fallback).slice(0, 140);
}

function safeZipPath(parts: string[]): string {
  return parts
    .map((part, index) => safeZipSegment(part, index === parts.length - 1 ? "file" : "folder"))
    .filter(Boolean)
    .join("/");
}

function uniqueZipPath(candidate: string, used: Set<string>): string {
  const normalized = candidate.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }

  const parsed = path.posix.parse(normalized);
  for (let index = 2; index < 1000; index += 1) {
    const next = path.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }

  throw new Error("Unable to allocate unique ZIP path");
}

function sourceBaseName(line: EvidenceProofLine): string {
  return safeZipSegment(
    [line.date?.slice(0, 10), line.documentNumber, line.party, line.sourceId]
      .filter(Boolean)
      .join(" "),
    line.id.replace(/[:/\\]/g, "-")
  );
}

function normalizeUploadReference(reference: string | null | undefined): string | null {
  const value = (reference ?? "").trim();
  const isUploadsReference = /^\/?uploads\//i.test(value);
  if (
    !value ||
    /^https?:\/\//i.test(value) ||
    /^data:/i.test(value) ||
    (!isUploadsReference && path.isAbsolute(value))
  ) {
    return null;
  }
  return value.replace(/^\/?uploads\/?/i, "").replace(/^\/+/, "");
}

function resolveUploadReference(reference: string | null | undefined): string | null {
  const relative = normalizeUploadReference(reference);
  if (!relative) return null;

  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  const absolutePath = path.resolve(uploadsRoot, relative);
  if (absolutePath !== uploadsRoot && !absolutePath.startsWith(uploadsRoot + path.sep)) {
    return null;
  }
  return absolutePath;
}

function dataUrlToBuffer(
  value: string | null | undefined
): { buffer: Buffer; extension: string; mimeType: string } | null {
  if (!value) return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  const mimeType = match?.[1] ?? "image/jpeg";
  const raw = match?.[2] ?? value;
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) return null;

  const extension =
    mimeType === "image/png"
      ? "png"
      : mimeType === "image/webp"
        ? "webp"
        : mimeType === "application/pdf"
          ? "pdf"
          : "jpg";
  return { buffer, extension, mimeType };
}

function manifestEntry(
  line: EvidenceProofLine,
  input: {
    sourceFile: string | null;
    zipPath: string | null;
    included: boolean;
    reason: string | null;
  }
): EvidenceBundleManifestEntry {
  return {
    sourceType: line.sourceType,
    sourceId: line.sourceId ?? null,
    label: line.label,
    documentNumber: line.documentNumber ?? null,
    party: line.party ?? null,
    date: line.date?.slice(0, 10) ?? null,
    status: line.status,
    evidenceStatus: line.documentStatus,
    sourceFile: input.sourceFile,
    zipPath: input.zipPath,
    included: input.included,
    reason: input.reason,
  };
}

async function readUploadZipEntry(input: {
  line: EvidenceProofLine;
  folder: string;
  fileName: string | null | undefined;
  uploadReference: string | null | undefined;
  usedPaths: Set<string>;
}): Promise<{ entry: EvidenceZipEntry | null; manifest: EvidenceBundleManifestEntry }> {
  const fileName = safeZipSegment(input.fileName, "source-file");
  const zipPath = uniqueZipPath(
    safeZipPath([input.folder, `${sourceBaseName(input.line)}-${fileName}`]),
    input.usedPaths
  );
  const absolutePath = resolveUploadReference(input.uploadReference);

  if (!absolutePath) {
    return {
      entry: null,
      manifest: manifestEntry(input.line, {
        sourceFile: input.fileName ?? null,
        zipPath: null,
        included: false,
        reason: "File reference is missing, external, absolute, or outside upload storage.",
      }),
    };
  }

  try {
    const data = await fs.readFile(absolutePath);
    return {
      entry: { path: zipPath, data },
      manifest: manifestEntry(input.line, {
        sourceFile: input.fileName ?? path.basename(absolutePath),
        zipPath,
        included: true,
        reason: null,
      }),
    };
  } catch {
    return {
      entry: null,
      manifest: manifestEntry(input.line, {
        sourceFile: input.fileName ?? path.basename(absolutePath),
        zipPath: null,
        included: false,
        reason: "File is referenced in the app but missing from upload storage.",
      }),
    };
  }
}

function textZipEntry(input: {
  line: EvidenceProofLine;
  folder: string;
  fileName: string;
  text: string;
  usedPaths: Set<string>;
  reason: string | null;
}): { entry: EvidenceZipEntry; manifest: EvidenceBundleManifestEntry } {
  const zipPath = uniqueZipPath(
    safeZipPath([input.folder, `${sourceBaseName(input.line)}-${input.fileName}`]),
    input.usedPaths
  );
  return {
    entry: { path: zipPath, data: Buffer.from(input.text, "utf8") },
    manifest: manifestEntry(input.line, {
      sourceFile: input.fileName,
      zipPath,
      included: true,
      reason: input.reason,
    }),
  };
}

function binaryZipEntry(input: {
  line: EvidenceProofLine;
  folder: string;
  fileName: string;
  data: Buffer;
  usedPaths: Set<string>;
  reason: string | null;
}): { entry: EvidenceZipEntry; manifest: EvidenceBundleManifestEntry } {
  const zipPath = uniqueZipPath(
    safeZipPath([input.folder, `${sourceBaseName(input.line)}-${input.fileName}`]),
    input.usedPaths
  );
  return {
    entry: { path: zipPath, data: input.data },
    manifest: manifestEntry(input.line, {
      sourceFile: input.fileName,
      zipPath,
      included: true,
      reason: input.reason,
    }),
  };
}

async function collectEvidenceBundleSources(
  center: EvidenceCenterResponse
): Promise<{ entries: EvidenceZipEntry[]; manifestEntries: EvidenceBundleManifestEntry[] }> {
  const entries: EvidenceZipEntry[] = [];
  const manifestEntries: EvidenceBundleManifestEntry[] = [];
  const usedPaths = new Set<string>();
  const proofLines = center.proofDrilldowns;
  const proofBySource = new Map(
    proofLines.map((line) => [`${line.sourceType}:${line.sourceId}`, line])
  );

  const [receipts, documents, vatWorkpapers] = await Promise.all([
    storage.getReceiptsByCompanyId(center.company.id).catch(() => []),
    storage.getDocuments(center.company.id).catch(() => []),
    listVatWorkpapers([center.company.id], center.company.id, { clientOnly: false }).catch(
      () => []
    ),
  ]);
  const receiptsById = new Map((receipts as AnyRecord[]).map((receipt) => [receipt.id, receipt]));
  const documentsById = new Map(
    (documents as AnyRecord[]).map((document) => [document.id, document])
  );
  const latestVatWorkpaper = vatWorkpapers[0] ?? null;
  const vatWorkpaperDetail = latestVatWorkpaper
    ? await getVatWorkpaperDetail(latestVatWorkpaper.id).catch(() => null)
    : null;
  const vatRowsById = new Map(
    ((vatWorkpaperDetail?.rows ?? []) as AnyRecord[]).map((row) => [row.id, row])
  );
  const vatAttachmentsByRow = new Map<string, AnyRecord[]>();
  for (const attachment of (vatWorkpaperDetail?.attachments ?? []) as AnyRecord[]) {
    if (!attachment.rowId) continue;
    const group = vatAttachmentsByRow.get(attachment.rowId) ?? [];
    group.push(attachment);
    vatAttachmentsByRow.set(attachment.rowId, group);
  }

  for (const line of proofLines) {
    if (line.sourceType === "receipt") {
      const receipt = receiptsById.get(line.sourceId);
      let includedReceiptFile = false;

      if (receipt?.imagePath) {
        const result = await readUploadZipEntry({
          line,
          folder: "attachments/receipts",
          fileName: `receipt-${line.sourceId}.jpg`,
          uploadReference: receipt.imagePath,
          usedPaths,
        });
        if (result.entry) {
          entries.push(result.entry);
          includedReceiptFile = true;
        }
        manifestEntries.push(result.manifest);
      }

      if (!includedReceiptFile && receipt?.imageData) {
        const decoded = dataUrlToBuffer(receipt.imageData);
        if (decoded) {
          const result = binaryZipEntry({
            line,
            folder: "attachments/receipts",
            fileName: `receipt-${line.sourceId}.${decoded.extension}`,
            data: decoded.buffer,
            usedPaths,
            reason: "Legacy base64 receipt image included from the receipt record.",
          });
          entries.push(result.entry);
          manifestEntries.push(result.manifest);
          includedReceiptFile = true;
        }
      }

      if (!includedReceiptFile && receipt?.rawText) {
        const result = textZipEntry({
          line,
          folder: "source-text/receipts",
          fileName: `receipt-${line.sourceId}-ocr.txt`,
          text: receipt.rawText,
          usedPaths,
          reason:
            "Only OCR/source text is available; upload the original image for stronger refund support.",
        });
        entries.push(result.entry);
        manifestEntries.push(result.manifest);
        includedReceiptFile = true;
      }

      if (!includedReceiptFile) {
        manifestEntries.push(
          manifestEntry(line, {
            sourceFile: null,
            zipPath: null,
            included: false,
            reason: "No receipt image or source text is available for this proof row.",
          })
        );
      }
      continue;
    }

    if (line.sourceType === "vat_workpaper_row") {
      const row = vatRowsById.get(line.sourceId);
      const attachments = vatAttachmentsByRow.get(line.sourceId ?? "") ?? [];
      const linkedDocumentId = line.sourceDocumentId ?? row?.sourceDocumentId ?? null;
      let includedVatEvidence = false;

      for (const attachment of attachments) {
        if (attachment.filePath) {
          const result = await readUploadZipEntry({
            line,
            folder: "attachments/vat-workpapers",
            fileName: attachment.fileName,
            uploadReference: attachment.filePath,
            usedPaths,
          });
          if (result.entry) {
            entries.push(result.entry);
            includedVatEvidence = true;
          }
          manifestEntries.push(result.manifest);
        }

        if (attachment.extractedText && !attachment.filePath) {
          const result = textZipEntry({
            line,
            folder: "source-text/vat-workpapers",
            fileName: `${attachment.fileName || "vat-evidence"}-extracted.txt`,
            text: attachment.extractedText,
            usedPaths,
            reason:
              "VAT workpaper extracted text is included because the original file is not stored.",
          });
          entries.push(result.entry);
          manifestEntries.push(result.manifest);
          includedVatEvidence = true;
        }
      }

      if (linkedDocumentId) {
        const document = documentsById.get(linkedDocumentId);
        if (document) {
          const result = await readUploadZipEntry({
            line,
            folder: "attachments/document-vault",
            fileName: document.fileName || document.name || `document-${linkedDocumentId}`,
            uploadReference: document.fileUrl,
            usedPaths,
          });
          if (result.entry) {
            entries.push(result.entry);
            includedVatEvidence = true;
          }
          manifestEntries.push(result.manifest);
        } else {
          manifestEntries.push(
            manifestEntry(line, {
              sourceFile: linkedDocumentId,
              zipPath: null,
              included: false,
              reason: "Linked document id was not found in this company's Document Vault.",
            })
          );
        }
      }

      if (!includedVatEvidence) {
        manifestEntries.push(
          manifestEntry(line, {
            sourceFile: null,
            zipPath: null,
            included: false,
            reason: "No stored VAT workpaper attachment or linked Document Vault file was found.",
          })
        );
      }
      continue;
    }

    if (line.sourceType === "invoice") {
      const result = textZipEntry({
        line,
        folder: "generated-records/invoices",
        fileName: `invoice-${line.documentNumber || line.sourceId || "record"}.txt`,
        text: [
          `Generated invoice record`,
          `Invoice: ${line.documentNumber || "N/A"}`,
          `Date: ${line.date?.slice(0, 10) || "N/A"}`,
          `Customer: ${line.party || "N/A"}`,
          `Taxable amount: ${line.amount}`,
          `VAT amount: ${line.vatAmount ?? 0}`,
          `Status: ${line.status}`,
          "",
          "This is an app-generated record summary. Download the official invoice PDF from the invoices module when a signed/issued copy is required.",
        ].join("\n"),
        usedPaths,
        reason:
          "Generated accounting record summary included; download the official PDF from the invoices module if needed.",
      });
      entries.push(result.entry);
      manifestEntries.push(result.manifest);
      continue;
    }

    const knownLine = proofBySource.get(`${line.sourceType}:${line.sourceId}`) ?? line;
    manifestEntries.push(
      manifestEntry(knownLine, {
        sourceFile: null,
        zipPath: null,
        included: false,
        reason: "This proof source type does not have a bundleable file source yet.",
      })
    );
  }

  return { entries, manifestEntries };
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(dateInput: Date | undefined): { date: number; time: number } {
  const date = dateInput && !Number.isNaN(dateInput.getTime()) ? dateInput : new Date();
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function buildStoredZip(entries: EvidenceZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path.replace(/\\/g, "/"), "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const stamp = dosDateTime(entry.modifiedAt);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(stamp.time, 10);
    localHeader.writeUInt16LE(stamp.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(stamp.time, 12);
    centralHeader.writeUInt16LE(stamp.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function workflow(input: {
  id: EvidenceWorkflowId;
  title: string;
  score: number;
  metric: string;
  description: string;
  primaryHref: string;
  primaryAction: string;
  bullets: string[];
  issues: EvidenceIssue[];
  proofCount?: number;
}): EvidenceWorkflow {
  return {
    id: input.id,
    title: input.title,
    status: statusFromScore(input.score),
    score: Math.max(0, Math.min(100, Math.round(input.score))),
    metric: input.metric,
    description: input.description,
    primaryHref: input.primaryHref,
    primaryAction: input.primaryAction,
    bullets: input.bullets,
    issueCount: input.issues.length,
    proofCount: input.proofCount ?? 0,
  };
}

export async function buildEvidenceCenter(companyId: string): Promise<EvidenceCenterResponse> {
  const company = await storage.getCompany(companyId);
  if (!company) {
    throw new Error("Company not found");
  }

  const quarter = currentQuarter();
  const month = currentMonth();
  const [invoices, receipts, vatReturns, ctReturns, complianceTasks] = await Promise.all([
    storage.getInvoicesByCompanyId(companyId).catch(() => []),
    storage.getReceiptsByCompanyId(companyId).catch(() => []),
    storage.getVatReturnsByCompanyId(companyId).catch(() => []),
    storage.getCorporateTaxReturnsByCompanyId(companyId).catch(() => []),
    storage.getComplianceTasks(companyId).catch(() => []),
  ]);
  const actionTrail = (await storage.getActivityLogsByCompany(companyId, 100).catch(() => []))
    .map((log: AnyRecord) => activityLogToEvidenceAuditEntry(log))
    .filter((entry): entry is EvidenceAuditEntry => Boolean(entry))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const [documentRequirementRows, documentRows, bankRows, vendorBillRows] = await Promise.all([
    optionalRows<AnyRecord>(
      `SELECT id, document_type, description, due_date, status
       FROM document_requirements
       WHERE company_id = $1
         AND status NOT IN ('received', 'waived')
       ORDER BY due_date ASC
       LIMIT 50`,
      [companyId]
    ),
    optionalRows<AnyRecord>(
      `SELECT category, COUNT(*)::int AS count
       FROM documents
       WHERE company_id = $1
         AND COALESCE(is_archived, false) = false
       GROUP BY category`,
      [companyId]
    ),
    optionalRows<AnyRecord>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE is_reconciled = true)::int AS reconciled,
         COUNT(*) FILTER (WHERE is_reconciled = false)::int AS unreconciled
       FROM bank_transactions
       WHERE company_id = $1
         AND transaction_date >= $2::date
         AND transaction_date <= $3::date`,
      [companyId, isoDay(month.start), isoDay(month.end)]
    ),
    optionalRows<AnyRecord>(
      `SELECT id, bill_number, vendor_name, bill_date, subtotal, vat_amount, status
       FROM vendor_bills
       WHERE company_id = $1
         AND bill_date >= $2::date
         AND bill_date <= $3::date
       ORDER BY bill_date DESC
       LIMIT 200`,
      [companyId, isoDay(quarter.start), isoDay(quarter.end)]
    ),
  ]);

  const vatWorkpapers = await listVatWorkpapers([companyId], companyId, {
    clientOnly: false,
  }).catch(() => []);
  const latestVatWorkpaper = vatWorkpapers[0] ?? null;
  const vatWorkpaperDetail = latestVatWorkpaper
    ? await getVatWorkpaperDetail(latestVatWorkpaper.id).catch(() => null)
    : null;
  const vatRows = vatWorkpaperDetail?.rows ?? [];
  const approvedVatRows = vatRows.filter((row: AnyRecord) => row.status === "approved");
  const draftVatRows = vatRows.filter((row: AnyRecord) => row.status === "draft");
  const inputVatRows = approvedVatRows.filter((row: AnyRecord) =>
    INPUT_VAT_CATEGORIES.has(row.rowCategory)
  );
  const outputVatRows = approvedVatRows.filter((row: AnyRecord) =>
    OUTPUT_VAT_CATEGORIES.has(row.rowCategory)
  );
  const vatTotals = (vatWorkpaperDetail?.totals ??
    latestVatWorkpaper?.totalsSnapshot ??
    {}) as AnyRecord;

  const latestCtReturn = [...ctReturns].sort(
    (a: AnyRecord, b: AnyRecord) =>
      new Date(b.taxPeriodEnd).getTime() - new Date(a.taxPeriodEnd).getTime()
  )[0] as AnyRecord | undefined;

  const closeChecklist = await getCloseChecklist(
    companyId,
    isoDay(month.start),
    isoDay(month.end)
  ).catch(() => []);
  const incompleteCloseItems = closeChecklist.filter((item) => item.status !== "complete");

  const periodInvoices = invoices.filter((invoice: AnyRecord) =>
    inRange(invoice.date, quarter.start, quarter.end)
  );
  const periodReceipts = receipts.filter((receipt: AnyRecord) =>
    inRange(receipt.date ?? receipt.createdAt, quarter.start, quarter.end)
  );
  const openDocumentRequirements = documentRequirementRows.filter(
    (row) => row.status !== "received" && row.status !== "waived"
  );
  const now = new Date();
  const openComplianceTasks = complianceTasks.filter(
    (task: AnyRecord) => task.status !== "completed" && task.status !== "cancelled"
  );
  const overdueComplianceTasks = openComplianceTasks.filter(
    (task: AnyRecord) => new Date(task.dueDate).getTime() < now.getTime()
  );
  const bankSummary = bankRows[0] ?? { total: 0, reconciled: 0, unreconciled: 0 };
  const documentCategoryCount = new Map(
    documentRows.map((row) => [String(row.category), Number(row.count || 0)])
  );

  const missingEvidence: EvidenceIssue[] = [];
  const filingRiskScan: EvidenceIssue[] = [];

  if (!company.trnVatNumber) {
    const issue = makeIssue({
      id: "company:missing-trn",
      severity: "critical",
      workflowId: "missing_evidence",
      title: "Company TRN is missing",
      detail: "VAT and official filing drafts need the company TRN before they can be finalized.",
      href: "/company-profile",
      actionLabel: "Add TRN",
    });
    missingEvidence.push(issue);
    filingRiskScan.push({ ...issue, workflowId: "filing_risk_scan" });
  }

  if (!latestVatWorkpaper) {
    missingEvidence.push(
      makeIssue({
        id: "vat:no-workpaper",
        severity: "warning",
        workflowId: "refund_pack",
        title: "No VAT evidence workpaper exists yet",
        detail:
          "Create the period workpaper before relying on VAT return or refund support totals.",
        href: "/vat-filing",
        actionLabel: "Open VAT workpaper",
      })
    );
  }

  if (draftVatRows.length > 0) {
    filingRiskScan.push(
      makeIssue({
        id: "vat:draft-rows",
        severity: "warning",
        workflowId: "filing_risk_scan",
        title: `${draftVatRows.length} VAT workpaper row(s) still draft`,
        detail: "Draft rows are excluded from VAT 201 totals until reviewed and approved.",
        href: "/vat-filing",
        actionLabel: "Review rows",
      })
    );
  }

  for (const row of inputVatRows) {
    if (!row.sourceDocumentId && row.sourceMethod !== "generated") {
      missingEvidence.push(
        makeIssue({
          id: `vat-input-proof:${row.id}`,
          severity: "warning",
          workflowId: "refund_pack",
          title: `Input VAT proof needed for ${row.invoiceNumber || row.counterpartyName || "row"}`,
          detail:
            "Refund support is stronger when each input VAT row links to the source tax invoice or receipt.",
          sourceType: "vat_workpaper_row",
          sourceId: row.id,
          href: "/vat-filing",
          amount: toMoney(row.vatAmount),
          actionLabel: "Attach proof",
        })
      );
    }
    if (!row.counterpartyTrn && toMoney(row.vatAmount) > 0) {
      filingRiskScan.push(
        makeIssue({
          id: `vat-input-trn:${row.id}`,
          severity: "warning",
          workflowId: "filing_risk_scan",
          title: `Supplier TRN missing on ${row.invoiceNumber || "input VAT row"}`,
          detail:
            "Input VAT recovery may be challenged when the supplier TRN is absent from the evidence row.",
          sourceType: "vat_workpaper_row",
          sourceId: row.id,
          href: "/vat-filing",
        })
      );
    }
  }

  for (const requirement of openDocumentRequirements) {
    const overdue = new Date(requirement.due_date).getTime() < now.getTime();
    missingEvidence.push(
      makeIssue({
        id: `document-requirement:${requirement.id}`,
        severity: overdue ? "critical" : "warning",
        workflowId: "missing_evidence",
        title: `Missing ${String(requirement.document_type).replace(/_/g, " ")}`,
        detail: requirement.description || `Required document is ${requirement.status}.`,
        sourceType: "document_requirement",
        sourceId: requirement.id,
        href: "/document-vault",
        actionLabel: "Request document",
      })
    );
  }

  for (const receipt of periodReceipts) {
    const hasSourceImage = Boolean(receipt.imagePath || receipt.imageData || receipt.rawText);
    if (toMoney(receipt.vatAmount) > 0 && !hasSourceImage) {
      missingEvidence.push(
        makeIssue({
          id: `receipt-proof:${receipt.id}`,
          severity: "warning",
          workflowId: "refund_pack",
          title: `Tax invoice image missing for ${receipt.merchant || "receipt"}`,
          detail: "Claimed input VAT should be backed by a readable tax invoice or receipt image.",
          sourceType: "receipt",
          sourceId: receipt.id,
          href: "/receipts",
          amount: toMoney(receipt.vatAmount),
          actionLabel: "Upload receipt",
        })
      );
    }
    if (toMoney(receipt.vatAmount) > 0 && !receipt.posted) {
      filingRiskScan.push(
        makeIssue({
          id: `receipt-unposted:${receipt.id}`,
          severity: "warning",
          workflowId: "filing_risk_scan",
          title: `Input VAT receipt is not posted`,
          detail: `${receipt.merchant || "Receipt"} has VAT but is not posted to the ledger yet.`,
          sourceType: "receipt",
          sourceId: receipt.id,
          href: "/receipts",
        })
      );
    }
  }

  for (const invoice of periodInvoices) {
    if (toMoney(invoice.vatAmount) > 0 && !invoice.customerTrn) {
      filingRiskScan.push(
        makeIssue({
          id: `invoice-customer-trn:${invoice.id}`,
          severity: "info",
          workflowId: "filing_risk_scan",
          title: `Customer TRN missing on invoice ${invoice.number}`,
          detail:
            "Output VAT is still reported, but missing customer tax details weaken evidence quality.",
          sourceType: "invoice",
          sourceId: invoice.id,
          href: "/invoices",
        })
      );
    }
    if (invoice.status === "draft") {
      filingRiskScan.push(
        makeIssue({
          id: `invoice-draft:${invoice.id}`,
          severity: "warning",
          workflowId: "filing_risk_scan",
          title: `Draft invoice in VAT period: ${invoice.number}`,
          detail: "Draft invoices are not issued evidence and should be resolved before filing.",
          sourceType: "invoice",
          sourceId: invoice.id,
          href: "/invoices",
        })
      );
    }
  }

  for (const bill of vendorBillRows) {
    if (toMoney(bill.vat_amount) > 0 && ["draft", "pending"].includes(String(bill.status))) {
      filingRiskScan.push(
        makeIssue({
          id: `vendor-bill-pending:${bill.id}`,
          severity: "warning",
          workflowId: "filing_risk_scan",
          title: `Supplier bill pending: ${bill.bill_number || bill.vendor_name || "bill"}`,
          detail: "Pending supplier bills with VAT should be approved before claiming input VAT.",
          sourceType: "vendor_bill",
          sourceId: bill.id,
          href: "/bill-pay",
          amount: toMoney(bill.vat_amount),
        })
      );
    }
  }

  if (Number(bankSummary.unreconciled || 0) > 0) {
    filingRiskScan.push(
      makeIssue({
        id: "bank:unreconciled",
        severity: "warning",
        workflowId: "month_end_cockpit",
        title: `${bankSummary.unreconciled} bank transaction(s) unreconciled this month`,
        detail: "Close and tax evidence should be reviewed after bank reconciliation is current.",
        href: "/bank-reconciliation",
        actionLabel: "Reconcile bank",
      })
    );
  }

  if (!latestCtReturn) {
    missingEvidence.push(
      makeIssue({
        id: "ct:no-return",
        severity: "warning",
        workflowId: "corporate_tax_workpaper",
        title: "Corporate tax workpaper is not started",
        detail: "Start a CT workpaper so taxable-profit adjustments can be tracked from evidence.",
        href: "/corporate-tax",
        actionLabel: "Open corporate tax",
      })
    );
  } else if (!Array.isArray(latestCtReturn.workpaper?.adjustments)) {
    filingRiskScan.push(
      makeIssue({
        id: `ct:no-adjustments:${latestCtReturn.id}`,
        severity: "info",
        workflowId: "corporate_tax_workpaper",
        title: "Corporate tax bridge has no adjustment review",
        detail:
          "Confirm disallowable expenses, exempt income, related-party items, and loss relief before filing.",
        href: "/corporate-tax",
        sourceType: "corporate_tax_return",
        sourceId: latestCtReturn.id,
      })
    );
  }

  for (const item of incompleteCloseItems) {
    filingRiskScan.push(
      makeIssue({
        id: `month-end:${item.id}`,
        severity: "warning",
        workflowId: "month_end_cockpit",
        title: item.title,
        detail: item.details || item.description,
        href: "/month-end",
        actionLabel: "Open close",
      })
    );
  }

  for (const task of overdueComplianceTasks.slice(0, 10) as AnyRecord[]) {
    filingRiskScan.push(
      makeIssue({
        id: `compliance-task:${task.id}`,
        severity: "critical",
        workflowId: "filing_timeline",
        title: `Overdue: ${task.title}`,
        detail: `Due ${isoDate(task.dueDate)?.slice(0, 10) || "date unknown"}.`,
        href: "/compliance-calendar",
        sourceType: "compliance_task",
        sourceId: task.id,
      })
    );
  }

  const proofDrilldowns: EvidenceProofLine[] = [
    ...outputVatRows.slice(0, 8).map((row: AnyRecord) => ({
      id: `vat-output:${row.id}`,
      label: "VAT output row",
      sourceType: "vat_workpaper_row",
      sourceId: row.id,
      sourceDocumentId: row.sourceDocumentId ?? null,
      documentNumber: row.invoiceNumber,
      date: isoDate(row.documentDate),
      party: row.counterpartyName,
      amount: toMoney(row.taxableAmount),
      vatAmount: toMoney(row.vatAmount),
      status: row.status,
      proofStatus: row.sourceDocumentId ? "ready" : "needs_review",
      documentStatus: row.sourceDocumentId ? "attached" : "needs_review",
      documentLabel: row.sourceDocumentId ? "Linked source document" : "No source file linked",
      documentPreview: row.sourceDocumentId
        ? `Document ${row.sourceDocumentId} linked to this output VAT row.`
        : "Review whether the generated invoice or source document is linked before filing.",
      documentHref: row.sourceDocumentId ? "/document-vault" : "/vat-filing",
      attachmentCount: row.sourceDocumentId ? 1 : 0,
      href: "/vat-filing",
    })),
    ...inputVatRows.slice(0, 8).map((row: AnyRecord) => ({
      id: `vat-input:${row.id}`,
      label: "VAT input row",
      sourceType: "vat_workpaper_row",
      sourceId: row.id,
      sourceDocumentId: row.sourceDocumentId ?? null,
      documentNumber: row.invoiceNumber,
      date: isoDate(row.documentDate),
      party: row.counterpartyName,
      amount: toMoney(row.taxableAmount),
      vatAmount: toMoney(row.vatAmount),
      status: row.status,
      proofStatus: row.sourceDocumentId ? "ready" : "needs_review",
      documentStatus: row.sourceDocumentId ? "attached" : "missing",
      documentLabel: row.sourceDocumentId ? "Linked tax invoice" : "Tax invoice not linked",
      documentPreview: row.sourceDocumentId
        ? `Document ${row.sourceDocumentId} supports the input VAT claim.`
        : "Input VAT recovery should have a readable supplier tax invoice or receipt image.",
      documentHref: row.sourceDocumentId ? "/document-vault" : "/vat-filing",
      attachmentCount: row.sourceDocumentId ? 1 : 0,
      href: "/vat-filing",
    })),
    ...periodInvoices.slice(0, 6).map((invoice: AnyRecord) => ({
      id: `invoice:${invoice.id}`,
      label: "Sales invoice",
      sourceType: "invoice",
      sourceId: invoice.id,
      documentNumber: invoice.number,
      date: isoDate(invoice.date),
      party: invoice.customerName,
      amount: toMoney(invoice.total || invoice.baseCurrencyAmount),
      vatAmount: toMoney(invoice.vatAmount),
      status: invoice.status,
      proofStatus: invoice.status === "draft" ? "needs_review" : "ready",
      documentStatus: invoice.status === "draft" ? "needs_review" : "generated",
      documentLabel: invoice.status === "draft" ? "Draft invoice" : "Generated invoice record",
      documentPreview:
        invoice.status === "draft"
          ? "Draft invoices are not issued evidence until finalized."
          : "Invoice record is available from the sales module.",
      documentHref: "/invoices",
      attachmentCount: invoice.status === "draft" ? 0 : 1,
      href: "/invoices",
    })),
    ...periodReceipts.slice(0, 6).map((receipt: AnyRecord) => {
      const hasImage = Boolean(receipt.imagePath || receipt.imageData);
      const hasSourceText = Boolean(receipt.rawText);
      return {
        id: `receipt:${receipt.id}`,
        label: "Purchase receipt",
        sourceType: "receipt",
        sourceId: receipt.id,
        documentNumber: receipt.invoiceNumber ?? receipt.receiptNumber ?? null,
        date: isoDate(receipt.date ?? receipt.createdAt),
        party: receipt.merchant,
        amount: toMoney((receipt.amount || 0) + (receipt.vatAmount || 0)),
        vatAmount: toMoney(receipt.vatAmount),
        status: receipt.posted ? "posted" : "unposted",
        proofStatus: hasImage || hasSourceText ? "ready" : "missing",
        documentStatus: hasImage ? "attached" : hasSourceText ? "source_text" : "missing",
        documentLabel: hasImage
          ? "Receipt image attached"
          : hasSourceText
            ? "OCR/source text only"
            : "Receipt image missing",
        documentPreview: hasImage
          ? "Readable receipt image is attached to this source row."
          : hasSourceText
            ? "Source text exists, but a readable tax invoice image is stronger refund support."
            : "No readable source file is attached for this input VAT claim.",
        documentHref: "/receipts",
        attachmentCount: hasImage ? 1 : 0,
        href: "/receipts",
      };
    }),
  ];

  const vatOutputAmount = toMoney(vatTotals.box8TotalAmount);
  const vatOutputVat = toMoney(vatTotals.box8TotalVat);
  const vatInputAmount = toMoney(vatTotals.box11TotalAmount);
  const vatInputVat = toMoney(vatTotals.box13RecoverableTax ?? vatTotals.box11TotalVat);
  const vatNetPayable = toMoney(vatTotals.box14PayableTax ?? vatOutputVat - vatInputVat);
  const refundExposure = Math.max(0, toMoney(vatInputVat - vatOutputVat));
  const salesEvidenceAmount = toMoney(
    periodInvoices.reduce((sum: number, invoice: AnyRecord) => sum + toMoney(invoice.total), 0)
  );
  const purchaseEvidenceAmount = toMoney(
    periodReceipts.reduce(
      (sum: number, receipt: AnyRecord) =>
        sum + toMoney(receipt.amount) + toMoney(receipt.vatAmount),
      0
    )
  );
  const corporateTaxPayable = toMoney(latestCtReturn?.taxPayable);

  const timeline: EvidenceTimelineItem[] = [
    ...openComplianceTasks.slice(0, 8).map((task: AnyRecord) => ({
      id: `task:${task.id}`,
      title: task.title,
      dueDate: isoDate(task.dueDate) || new Date().toISOString(),
      category: task.category,
      status: task.status,
      consequence:
        task.category === "vat_filing"
          ? "VAT penalties, blocked refund support, or late payment exposure."
          : "Compliance task can block close, filing, or document readiness.",
      readinessScore: task.status === "completed" ? 100 : new Date(task.dueDate) < now ? 20 : 70,
      href: "/compliance-calendar",
    })),
  ];

  if (latestVatWorkpaper) {
    timeline.push({
      id: `vat-workpaper:${latestVatWorkpaper.id}`,
      title: "VAT workpaper due",
      dueDate: isoDate(latestVatWorkpaper.dueDate) || new Date().toISOString(),
      category: "vat_filing",
      status: latestVatWorkpaper.status,
      consequence: "Incomplete evidence can delay filing and weaken refund support.",
      readinessScore: scoreFromOpenItems(draftVatRows.length, vatRows.length || 1),
      href: "/vat-filing",
    });
  }

  if (latestCtReturn) {
    const ctDueDate = new Date(latestCtReturn.taxPeriodEnd);
    ctDueDate.setUTCMonth(ctDueDate.getUTCMonth() + 9);
    timeline.push({
      id: `ct:${latestCtReturn.id}`,
      title: "Corporate tax filing deadline",
      dueDate: ctDueDate.toISOString(),
      category: "corporate_tax",
      status: latestCtReturn.status,
      consequence: "Unreviewed taxable-profit adjustments can create incorrect CT exposure.",
      readinessScore: latestCtReturn.status === "filed" ? 100 : latestCtReturn.workpaper ? 75 : 45,
      href: "/corporate-tax",
    });
  }

  timeline.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const auditedMissingEvidence = applyIssueAudit(missingEvidence, actionTrail);
  const auditedFilingRiskScan = applyIssueAudit(filingRiskScan, actionTrail);
  const openMissingEvidence = openIssues(auditedMissingEvidence);
  const openFilingRiskScan = openIssues(auditedFilingRiskScan);
  const allIssues = [...openMissingEvidence, ...openFilingRiskScan];
  const readinessScore = scoreEvidenceReadiness(allIssues);
  const proofReady = proofDrilldowns.filter((line) => line.proofStatus === "ready").length;
  const proofScore = scoreFromOpenItems(
    proofDrilldowns.length - proofReady,
    proofDrilldowns.length
  );
  const refundProofGaps = openMissingEvidence.filter((issue) => issue.workflowId === "refund_pack");
  const refundScore = scoreEvidenceReadiness(refundProofGaps);
  const missingScore = scoreEvidenceReadiness(openMissingEvidence);
  const riskScore = scoreEvidenceReadiness(openFilingRiskScan);
  const closeScore = scoreFromOpenItems(incompleteCloseItems.length, closeChecklist.length);
  const ctScore = latestCtReturn ? (latestCtReturn.workpaper ? 85 : 65) : 35;
  const overdueTimelineCount = timeline.filter(
    (item) => new Date(item.dueDate) < now && item.status !== "completed"
  ).length;

  const ownerActions: EvidenceOwnerAction[] = [];
  const firstCritical = allIssues.find((issue) => issue.severity === "critical");
  if (firstCritical) {
    ownerActions.push({
      id: "critical-evidence",
      priority: "now",
      title: firstCritical.title,
      detail: firstCritical.detail,
      href: firstCritical.href || "/evidence-center",
      actionLabel: firstCritical.actionLabel || "Resolve now",
    });
  }
  if (refundExposure > 0) {
    ownerActions.push({
      id: "refund-pack",
      priority: "now",
      title: `Refund support needed for AED ${refundExposure.toLocaleString("en-AE")}`,
      detail: `${refundProofGaps.length} evidence gap(s) should be closed before relying on the refund claim.`,
      href: "/vat-filing",
      actionLabel: "Build refund pack",
    });
  }
  if (incompleteCloseItems.length > 0) {
    ownerActions.push({
      id: "month-end",
      priority: "next",
      title: `${incompleteCloseItems.length} month-end check(s) open`,
      detail: "Close the month before trusting tax, reports, or cash decisions.",
      href: "/month-end",
      actionLabel: "Open close cockpit",
    });
  }
  if (!latestCtReturn) {
    ownerActions.push({
      id: "ct-workpaper",
      priority: "next",
      title: "Start the corporate tax workpaper",
      detail: "Pull revenue and expense totals into the CT bridge and review UAE tax adjustments.",
      href: "/corporate-tax",
      actionLabel: "Open CT workpaper",
    });
  }
  if (ownerActions.length === 0) {
    ownerActions.push({
      id: "monitor",
      priority: "monitor",
      title: "Evidence pack is in good shape",
      detail: "Keep recording source rows and proof links as new documents arrive.",
      href: "/evidence-center",
      actionLabel: "Monitor evidence",
    });
  }

  const requestDraft = formatEvidenceRequestDraft({
    companyName: company.name,
    defaultRecipient: company.contactEmail ?? null,
    issues: openMissingEvidence,
  });

  const refundPack = buildRefundPackSummary(company.id, company.name, {
    periodStart: isoDay(quarter.start),
    periodEnd: isoDay(quarter.end),
    proofLineCount: proofDrilldowns.length,
    readyAttachmentCount: proofDrilldowns.filter((line) => line.attachmentCount > 0).length,
    missingAttachmentCount: proofDrilldowns.filter(
      (line) => line.documentStatus === "missing" || line.documentStatus === "needs_review"
    ).length,
    gapCount: openMissingEvidence.length,
  });

  const workflows: EvidenceWorkflow[] = [
    workflow({
      id: "refund_pack",
      title: "Refund Pack Builder",
      score: refundScore,
      metric:
        refundExposure > 0
          ? `AED ${refundExposure.toLocaleString("en-AE")} refund exposure`
          : "No refund exposure",
      description:
        "Builds a refund-ready support pack from input VAT rows, attachments, and evidence gaps.",
      primaryHref: "/vat-filing",
      primaryAction: "Open VAT evidence",
      bullets: [
        `${inputVatRows.length} approved input VAT row(s)`,
        `${refundProofGaps.length} refund evidence gap(s)`,
        `${documentCategoryCount.get("tax_certificate") || 0} tax certificate document(s) in vault`,
      ],
      issues: refundProofGaps,
      proofCount: inputVatRows.length,
    }),
    workflow({
      id: "proof_drilldown",
      title: "Every Number Has Proof",
      score: proofScore,
      metric: `${proofReady}/${proofDrilldowns.length} proof lines ready`,
      description:
        "Shows the exact invoices, receipts, and workpaper rows behind each headline number.",
      primaryHref: "/evidence-center#proof-drilldown",
      primaryAction: "Review proof",
      bullets: [
        `VAT output rows: ${outputVatRows.length}`,
        `VAT input rows: ${inputVatRows.length}`,
        `Current-period invoices: ${periodInvoices.length}`,
      ],
      issues: openMissingEvidence.filter((issue) => issue.sourceType === "vat_workpaper_row"),
      proofCount: proofDrilldowns.length,
    }),
    workflow({
      id: "corporate_tax_workpaper",
      title: "Corporate Tax Workpaper",
      score: ctScore,
      metric: latestCtReturn
        ? `AED ${corporateTaxPayable.toLocaleString("en-AE")} CT payable`
        : "Not started",
      description:
        "Turns accounting profit into a taxable-profit bridge with add-backs, deductions, relief, and loss review.",
      primaryHref: "/corporate-tax",
      primaryAction: "Open corporate tax",
      bullets: [
        latestCtReturn ? `Latest status: ${latestCtReturn.status}` : "No CT return found",
        latestCtReturn?.workpaper ? "Workpaper data exists" : "Adjustment review needed",
        "Uses UAE zero-rate band and existing CT computation engine",
      ],
      issues: allIssues.filter((issue) => issue.workflowId === "corporate_tax_workpaper"),
      proofCount: latestCtReturn ? 1 : 0,
    }),
    workflow({
      id: "missing_evidence",
      title: "Missing Evidence Inbox",
      score: missingScore,
      metric: `${openMissingEvidence.length} open item(s)`,
      description:
        "Collects missing documents, TRNs, tax invoices, and source proof into one queue.",
      primaryHref: "/evidence-center#missing-evidence",
      primaryAction: "Work inbox",
      bullets: [
        `${openDocumentRequirements.length} document requirement(s) open`,
        `${periodReceipts.length} receipt(s) scanned in VAT period`,
        `${openMissingEvidence.filter((issue) => issue.severity === "critical").length} critical blocker(s)`,
      ],
      issues: openMissingEvidence,
      proofCount: documentRows.length,
    }),
    workflow({
      id: "client_request_autopilot",
      title: "Client Request Autopilot",
      score: openMissingEvidence.length ? 90 : 100,
      metric: `${requestDraft.itemCount} request item(s) drafted`,
      description:
        "Creates a focused draft message for missing evidence without sending anything automatically.",
      primaryHref: "/evidence-center#request-draft",
      primaryAction: "Review draft",
      bullets: [
        "Draft only - no email, WhatsApp, or upload side effect",
        "Uses current missing evidence queue",
        "Reminds users not to send OTPs or credentials",
      ],
      issues: [],
      proofCount: requestDraft.itemCount,
    }),
    workflow({
      id: "month_end_cockpit",
      title: "Month-End Close Cockpit",
      score: closeScore,
      metric: `${closeChecklist.length - incompleteCloseItems.length}/${closeChecklist.length} checks complete`,
      description:
        "Combines bank, invoices, receipts, anomaly review, AI inbox, reports, and lock readiness.",
      primaryHref: "/month-end",
      primaryAction: "Open month-end",
      bullets: [
        `${Number(bankSummary.reconciled || 0)}/${Number(bankSummary.total || 0)} bank transaction(s) reconciled`,
        `${incompleteCloseItems.length} close blocker(s)`,
        `Period ${isoDay(month.start)} to ${isoDay(month.end)}`,
      ],
      issues: openFilingRiskScan.filter((issue) => issue.workflowId === "month_end_cockpit"),
      proofCount: closeChecklist.length,
    }),
    workflow({
      id: "filing_risk_scan",
      title: "Error Detector Before Filing",
      score: riskScore,
      metric: `${openFilingRiskScan.length} risk signal(s)`,
      description:
        "Flags missing TRNs, draft rows, unposted input VAT, pending bills, and close blockers.",
      primaryHref: "/evidence-center#risk-scan",
      primaryAction: "Review risks",
      bullets: [
        `${openFilingRiskScan.filter((issue) => issue.severity === "critical").length} critical risk(s)`,
        `${draftVatRows.length} draft VAT workpaper row(s)`,
        `${vendorBillRows.length} supplier bill(s) in VAT period`,
      ],
      issues: openFilingRiskScan,
      proofCount: openFilingRiskScan.length,
    }),
    workflow({
      id: "smart_excel_import",
      title: "Smart Import From Excel",
      score: latestVatWorkpaper ? 95 : 75,
      metric: latestVatWorkpaper ? "VAT paste/import ready" : "Create workpaper first",
      description:
        "Accepts spreadsheet-style VAT rows and maps columns such as Date, Vendor, Sr. Number, and Amount.",
      primaryHref: "/vat-filing",
      primaryAction: "Paste VAT rows",
      bullets: [
        "Supports tab-delimited Excel paste",
        "Normalizes DD/MM/YYYY evidence dates",
        "Defaults pasted rows into the active VAT category",
      ],
      issues: latestVatWorkpaper
        ? []
        : openMissingEvidence.filter((issue) => issue.id === "vat:no-workpaper"),
      proofCount: vatRows.length,
    }),
    workflow({
      id: "filing_timeline",
      title: "Filing Timeline With Consequences",
      score: scoreFromOpenItems(overdueTimelineCount, timeline.length),
      metric: `${timeline.length} deadline(s) tracked`,
      description: "Shows deadlines together with the operational consequence and readiness score.",
      primaryHref: "/compliance-calendar",
      primaryAction: "Open calendar",
      bullets: [
        `${overdueTimelineCount} overdue deadline(s)`,
        `${openComplianceTasks.length} open compliance task(s)`,
        "VAT and CT deadlines are tied back to evidence readiness",
      ],
      issues: openFilingRiskScan.filter((issue) => issue.workflowId === "filing_timeline"),
      proofCount: timeline.length,
    }),
    workflow({
      id: "owner_actions",
      title: "Owner-Friendly What Should I Do?",
      score: readinessScore,
      metric: `${ownerActions.length} recommended action(s)`,
      description: "Translates accounting evidence into plain business actions for the owner.",
      primaryHref: "/evidence-center#owner-actions",
      primaryAction: "Review actions",
      bullets: ownerActions.slice(0, 3).map((action) => action.title),
      issues: allIssues.filter((issue) => issue.severity === "critical"),
      proofCount: ownerActions.length,
    }),
  ];

  return {
    company: {
      id: company.id,
      name: company.name,
      trnVatNumber: company.trnVatNumber ?? null,
      contactEmail: company.contactEmail ?? null,
    },
    generatedAt: new Date().toISOString(),
    period: {
      vatStart: isoDay(quarter.start),
      vatEnd: isoDay(quarter.end),
      monthStart: isoDay(month.start),
      monthEnd: isoDay(month.end),
    },
    readinessScore,
    totals: {
      vatOutputAmount,
      vatOutputVat,
      vatInputAmount,
      vatInputVat,
      vatNetPayable,
      refundExposure,
      salesEvidenceAmount,
      purchaseEvidenceAmount,
      corporateTaxPayable,
    },
    workflows,
    missingEvidence: auditedMissingEvidence.slice(0, 50),
    filingRiskScan: auditedFilingRiskScan.slice(0, 50),
    proofDrilldowns,
    filingTimeline: timeline.slice(0, 20),
    ownerActions: ownerActions.slice(0, 6),
    refundPack,
    actionTrail: actionTrail.slice(0, 20),
    clientRequestDraft: requestDraft,
  };
}

const HEADER_FILL = "FF0F172A";
const HEADER_FONT = "FFFFFFFF";
const SECTION_FILL = "FFE6F1EC";
const MONEY_FORMAT = '"AED" #,##0.00;[Red]-"AED" #,##0.00';

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.font = { bold: true, color: { argb: HEADER_FONT } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function addWorksheetFromRows(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: Array<{ header: string; key: string; width?: number; money?: boolean }>,
  rows: AnyRecord[]
) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = columns.map(({ header, key, width }) => ({
    header,
    key,
    width: width ?? Math.max(14, header.length + 4),
  }));
  styleHeader(sheet.getRow(1));

  for (const rowData of rows) {
    sheet.addRow(rowData);
  }

  for (const column of columns) {
    if (!column.money) continue;
    const worksheetColumn = sheet.getColumn(column.key);
    worksheetColumn.numFmt = MONEY_FORMAT;
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  return sheet;
}

export async function buildEvidenceRefundPackWorkbook(
  center: EvidenceCenterResponse
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Muhasib.ai";
  workbook.lastModifiedBy = "Muhasib.ai";
  workbook.created = new Date(center.generatedAt);
  workbook.modified = new Date();
  workbook.company = center.company.name;
  workbook.title = "Evidence Refund Pack";

  const cover = workbook.addWorksheet("Cover");
  cover.columns = [
    { key: "label", width: 32 },
    { key: "value", width: 72 },
  ];
  cover.addRow(["Evidence Refund Pack", center.company.name]);
  cover.getRow(1).height = 26;
  cover.getRow(1).font = { bold: true, size: 16 };
  cover.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } };
  cover.addRows([
    ["VAT period", `${center.period.vatStart} to ${center.period.vatEnd}`],
    ["Generated", center.generatedAt],
    ["Evidence readiness", `${center.readinessScore}%`],
    ["Refund exposure", center.totals.refundExposure],
    [
      "Open evidence gaps",
      center.missingEvidence.filter(
        (issue) => issue.resolutionStatus !== "resolved" && issue.resolutionStatus !== "waived"
      ).length,
    ],
    ["Proof rows", center.proofDrilldowns.length],
    [
      "Linked attachments",
      center.proofDrilldowns.filter((line) => line.attachmentCount > 0).length,
    ],
    [
      "Important limitation",
      "This workbook indexes source evidence. Original attachments remain in the app document workspace unless separately downloaded.",
    ],
  ]);
  cover.getCell("B5").numFmt = MONEY_FORMAT;
  cover.eachRow((row) => {
    row.eachCell((cell) => {
      cell.alignment = { vertical: "top", wrapText: true };
    });
  });

  addWorksheetFromRows(
    workbook,
    "VAT Summary",
    [
      { header: "Metric", key: "metric", width: 34 },
      { header: "Amount", key: "amount", width: 22, money: true },
      { header: "Comment", key: "comment", width: 60 },
    ],
    [
      {
        metric: "Output taxable amount",
        amount: center.totals.vatOutputAmount,
        comment: "VAT 201 output base from approved rows.",
      },
      { metric: "Output VAT", amount: center.totals.vatOutputVat, comment: "VAT due on outputs." },
      {
        metric: "Input taxable amount",
        amount: center.totals.vatInputAmount,
        comment: "VAT 201 input base from approved rows.",
      },
      {
        metric: "Recoverable input VAT",
        amount: center.totals.vatInputVat,
        comment: "Recoverable input tax before evidence gap review.",
      },
      {
        metric: "Net VAT payable",
        amount: center.totals.vatNetPayable,
        comment: "Negative means refund exposure.",
      },
      {
        metric: "Refund exposure",
        amount: center.totals.refundExposure,
        comment: "Input VAT above output VAT.",
      },
    ]
  );

  addWorksheetFromRows(
    workbook,
    "Proof Index",
    [
      { header: "Source", key: "label", width: 22 },
      { header: "Date", key: "date", width: 16 },
      { header: "Party", key: "party", width: 32 },
      { header: "Document No.", key: "documentNumber", width: 18 },
      { header: "Status", key: "status", width: 16 },
      { header: "Proof", key: "proofStatus", width: 16 },
      { header: "Evidence file", key: "documentLabel", width: 26 },
      { header: "Amount", key: "amount", width: 18, money: true },
      { header: "VAT", key: "vatAmount", width: 18, money: true },
      { header: "Preview", key: "documentPreview", width: 64 },
    ],
    center.proofDrilldowns.map((line) => ({
      ...line,
      date: line.date?.slice(0, 10) ?? "",
      vatAmount: line.vatAmount ?? 0,
    }))
  );

  addWorksheetFromRows(
    workbook,
    "Missing Evidence",
    [
      { header: "Severity", key: "severity", width: 14 },
      { header: "Status", key: "resolutionStatus", width: 16 },
      { header: "Title", key: "title", width: 40 },
      { header: "Detail", key: "detail", width: 70 },
      { header: "Source", key: "sourceType", width: 22 },
      { header: "Amount", key: "amount", width: 18, money: true },
      { header: "Resolution reason", key: "resolutionReason", width: 44 },
    ],
    center.missingEvidence.map((issue) => ({
      ...issue,
      amount: issue.amount ?? 0,
      sourceType: issue.sourceType ?? "company",
      resolutionStatus: issue.resolutionStatus ?? "open",
      resolutionReason: issue.resolutionReason ?? "",
    }))
  );

  addWorksheetFromRows(
    workbook,
    "Filing Risks",
    [
      { header: "Severity", key: "severity", width: 14 },
      { header: "Status", key: "resolutionStatus", width: 16 },
      { header: "Title", key: "title", width: 42 },
      { header: "Detail", key: "detail", width: 76 },
      { header: "Source", key: "sourceType", width: 22 },
    ],
    center.filingRiskScan.map((issue) => ({
      ...issue,
      sourceType: issue.sourceType ?? "company",
      resolutionStatus: issue.resolutionStatus ?? "open",
    }))
  );

  addWorksheetFromRows(
    workbook,
    "Audit Trail",
    [
      { header: "Time", key: "createdAt", width: 24 },
      { header: "Action", key: "action", width: 22 },
      { header: "Entity", key: "entityType", width: 22 },
      { header: "Entity ID", key: "entityId", width: 34 },
      { header: "Description", key: "description", width: 72 },
      { header: "Reason", key: "reason", width: 50 },
    ],
    center.actionTrail.map((entry) => ({
      ...entry,
      reason: entry.reason ?? "",
      entityId: entry.entityId ?? "",
    }))
  );

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

export async function buildEvidenceRefundPackCoverPdf(
  center: EvidenceCenterResponse
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fontSize(20).text("Evidence Refund Pack", { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor("#475569").text(center.company.name);
    doc.text(`VAT period: ${center.period.vatStart} to ${center.period.vatEnd}`);
    doc.text(`Generated: ${center.generatedAt}`);
    doc.moveDown();

    doc.fillColor("#0f172a").fontSize(14).text("Summary", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    doc.text(`Evidence readiness: ${center.readinessScore}%`);
    doc.text(`Refund exposure: AED ${center.totals.refundExposure.toLocaleString("en-AE")}`);
    doc.text(`Proof rows indexed: ${center.proofDrilldowns.length}`);
    doc.text(
      `Source files linked: ${center.proofDrilldowns.filter((line) => line.attachmentCount > 0).length}`
    );
    doc.text(
      `Open missing evidence: ${
        center.missingEvidence.filter(
          (issue) => issue.resolutionStatus !== "resolved" && issue.resolutionStatus !== "waived"
        ).length
      }`
    );
    doc.moveDown();

    doc.fontSize(14).text("Pack Contents", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(11);
    for (const item of center.refundPack.contents) {
      doc.text(`- ${item}`);
    }
    doc.moveDown();

    doc.fontSize(14).text("Important Limitation", { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor("#475569");
    doc.text(
      "This cover and workbook index the evidence available in the app. Original attachments remain controlled inside the app document workspace unless separately downloaded by an authorized user.",
      { align: "left" }
    );

    doc.end();
  });
}

export async function buildEvidenceRefundPackZip(center: EvidenceCenterResponse): Promise<Buffer> {
  const [workbook, cover, sourceBundle] = await Promise.all([
    buildEvidenceRefundPackWorkbook(center),
    buildEvidenceRefundPackCoverPdf(center),
    collectEvidenceBundleSources(center),
  ]);
  const includedCount = sourceBundle.manifestEntries.filter((entry) => entry.included).length;
  const missingEntries = sourceBundle.manifestEntries.filter((entry) => !entry.included);
  const generatedAt = new Date().toISOString();

  const manifest = {
    generatedAt,
    company: center.company,
    period: center.period,
    refundExposure: center.totals.refundExposure,
    readinessScore: center.readinessScore,
    files: {
      workbook: safeZipPath(["core", center.refundPack.workbookFilename]),
      cover: safeZipPath(["core", center.refundPack.coverFilename]),
      sourceFilesIncluded: includedCount,
      sourceFilesMissing: missingEntries.length,
    },
    sourceEvidence: sourceBundle.manifestEntries,
  };
  const missingText =
    missingEntries.length > 0
      ? missingEntries
          .map(
            (entry, index) =>
              `${index + 1}. ${entry.label} ${entry.documentNumber ?? ""}`.trim() +
              `\n   Source: ${entry.sourceType} ${entry.sourceId ?? "N/A"}` +
              `\n   Reason: ${entry.reason ?? "Unavailable"}`
          )
          .join("\n\n")
      : "No missing source files were detected while building this bundle.\n";

  const entries: EvidenceZipEntry[] = [
    {
      path: manifest.files.workbook,
      data: workbook,
    },
    {
      path: manifest.files.cover,
      data: cover,
    },
    {
      path: "README.txt",
      data: Buffer.from(
        [
          "Evidence Refund Pack",
          "",
          `Company: ${center.company.name}`,
          `VAT period: ${center.period.vatStart} to ${center.period.vatEnd}`,
          `Generated: ${generatedAt}`,
          "",
          "Contents:",
          "- core/: workbook and PDF cover generated by the app",
          "- attachments/: original source files that were present in upload storage",
          "- source-text/: OCR/text fallbacks where no original file was stored",
          "- generated-records/: summaries for app-generated accounting records",
          "- manifest.json: exact included/missing source-evidence inventory",
          "- attachments-missing.txt: files that must still be uploaded or retrieved",
          "",
          "Security note: only company-scoped evidence references under app upload storage are bundled. External URLs, absolute paths, and missing files are listed in the manifest instead of read from disk.",
        ].join("\n"),
        "utf8"
      ),
    },
    {
      path: "manifest.json",
      data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
    },
    {
      path: "attachments-missing.txt",
      data: Buffer.from(missingText, "utf8"),
    },
    ...sourceBundle.entries,
  ];

  return buildStoredZip(entries);
}
