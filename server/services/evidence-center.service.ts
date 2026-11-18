import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
// @ts-expect-error - pdfkit has no type declarations
import PDFDocument from "pdfkit";

import { storage } from "../storage";
import { pool } from "../db";
import { getCloseChecklist } from "./month-end.service";
import { buildCtReturnWorkbook } from "./ct-workpaper-export.service";
import { ctFilingDeadline } from "./corporate-tax/deadlines";
import { getCtProfile, listRelatedParties } from "./corporate-tax/repository";
import { getVatWorkpaperDetail, listVatWorkpapers } from "./firm-vat-workspace.service";
import type {
  EvidenceAuditEntry,
  EvidenceCopyRef,
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
  EVIDENCE_AUDIT_TEMPLATES,
  describeEvidenceText,
  evidenceCopy,
  parseServerCopy,
} from "../../shared/server-copy";
import {
  formatEvidenceRequestDraft,
  scoreEvidenceReadiness,
  scoreFromOpenItems,
  statusFromScore,
} from "../../shared/evidence-center";

type AnyRecord = Record<string, unknown>;

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

function isoDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
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

function inRange(value: unknown, start: Date, end: Date): boolean {
  const date = value instanceof Date ? value : value ? new Date(value as string | number) : null;
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

/**
 * Request-scoped registry that pairs every English sentence composed for the payload with its
 * stable key + params (shared/server-copy.ts EVIDENCE_TEMPLATES). The English text stays in the
 * payload (exports, back-compat); the client renders `copy` from its en/ar catalogs.
 */
function createEvidenceCopy() {
  const byText = new Map<string, EvidenceCopyRef>();
  /** English sentence for `key`, remembered so `ref(text)` can return its descriptor. */
  const ec = (key: string, params: Record<string, string | number> = {}): string => {
    const { text, copy } = evidenceCopy(key, params);
    byText.set(text, copy);
    return text;
  };
  /** Adopt a sentence composed elsewhere (month-end checklist) when it matches a known template. */
  const adopt = (text: string | null | undefined): string => {
    const value = text ?? "";
    const d = describeEvidenceText(value);
    if (d) byText.set(value, d);
    return value;
  };
  const ref = (text: string | null | undefined): EvidenceCopyRef | undefined =>
    text ? byText.get(text) : undefined;
  return { ec, adopt, ref };
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
    const group = vatAttachmentsByRow.get(attachment.rowId as string) ?? [];
    group.push(attachment);
    vatAttachmentsByRow.set(attachment.rowId as string, group);
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
          uploadReference: receipt.imagePath as string,
          usedPaths,
        });
        if (result.entry) {
          entries.push(result.entry);
          includedReceiptFile = true;
        }
        manifestEntries.push(result.manifest);
      }

      if (!includedReceiptFile && receipt?.imageData) {
        const decoded = dataUrlToBuffer(receipt.imageData as string);
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
          text: receipt.rawText as string,
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
            fileName: attachment.fileName as string | null | undefined,
            uploadReference: attachment.filePath as string,
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
            text: attachment.extractedText as string,
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
            fileName: (document.fileName ||
              document.name ||
              `document-${linkedDocumentId}`) as string,
            uploadReference: document.fileUrl as string | null | undefined,
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
              sourceFile: linkedDocumentId as string,
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

  const { ec, adopt, ref } = createEvidenceCopy();
  const quarter = currentQuarter();
  const month = currentMonth();
  const [invoices, receipts, _vatReturns, ctReturns, complianceTasks] = await Promise.all([
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
    INPUT_VAT_CATEGORIES.has(row.rowCategory as string)
  );
  const outputVatRows = approvedVatRows.filter((row: AnyRecord) =>
    OUTPUT_VAT_CATEGORIES.has(row.rowCategory as string)
  );
  const vatTotals = (vatWorkpaperDetail?.totals ??
    latestVatWorkpaper?.totalsSnapshot ??
    {}) as AnyRecord;

  const latestCtReturn = latestLiveCtReturn(ctReturns as AnyRecord[]);

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
    (task: AnyRecord) => new Date(task.dueDate as string | Date).getTime() < now.getTime()
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
      title: ec("evidence.issue.missingTrn.title"),
      detail: ec("evidence.issue.missingTrn.detail"),
      href: "/company-profile",
      actionLabel: ec("evidence.action.addTrn"),
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
        title: ec("evidence.issue.noWorkpaper.title"),
        detail: ec("evidence.issue.noWorkpaper.detail"),
        href: "/vat-filing",
        actionLabel: ec("evidence.action.openVatWorkpaper"),
      })
    );
  }

  if (draftVatRows.length > 0) {
    filingRiskScan.push(
      makeIssue({
        id: "vat:draft-rows",
        severity: "warning",
        workflowId: "filing_risk_scan",
        title: ec("evidence.issue.draftRows.title", { count: draftVatRows.length }),
        detail: ec("evidence.issue.draftRows.detail"),
        href: "/vat-filing",
        actionLabel: ec("evidence.action.reviewRows"),
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
          title: (() => {
            const rowRef = String(row.invoiceNumber || row.counterpartyName || "");
            return rowRef
              ? ec("evidence.issue.inputProof.title", { ref: rowRef })
              : ec("evidence.issue.inputProofRow.title");
          })(),
          detail: ec("evidence.issue.inputProof.detail"),
          sourceType: "vat_workpaper_row",
          sourceId: row.id,
          href: "/vat-filing",
          amount: toMoney(row.vatAmount),
          actionLabel: ec("evidence.action.attachProof"),
        })
      );
    }
    if (!row.counterpartyTrn && toMoney(row.vatAmount) > 0) {
      filingRiskScan.push(
        makeIssue({
          id: `vat-input-trn:${row.id}`,
          severity: "warning",
          workflowId: "filing_risk_scan",
          title: row.invoiceNumber
            ? ec("evidence.issue.supplierTrn.title", { ref: String(row.invoiceNumber) })
            : ec("evidence.issue.supplierTrnRow.title"),
          detail: ec("evidence.issue.supplierTrn.detail"),
          sourceType: "vat_workpaper_row",
          sourceId: row.id,
          href: "/vat-filing",
        })
      );
    }
  }

  for (const requirement of openDocumentRequirements) {
    const overdue = new Date(requirement.due_date as string | Date).getTime() < now.getTime();
    missingEvidence.push(
      makeIssue({
        id: `document-requirement:${requirement.id}`,
        severity: overdue ? "critical" : "warning",
        workflowId: "missing_evidence",
        title: ec("evidence.issue.docRequirement.title", {
          type: String(requirement.document_type).replace(/_/g, " "),
        }),
        detail: (requirement.description ||
          ec("evidence.issue.docRequirement.detail", {
            status: String(requirement.status),
          })) as string,
        sourceType: "document_requirement",
        sourceId: requirement.id as string | null | undefined,
        href: "/document-vault",
        actionLabel: ec("evidence.action.requestDocument"),
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
          title: receipt.merchant
            ? ec("evidence.issue.receiptImage.title", { merchant: String(receipt.merchant) })
            : ec("evidence.issue.receiptImageGeneric.title"),
          detail: ec("evidence.issue.receiptImage.detail"),
          sourceType: "receipt",
          sourceId: receipt.id,
          href: "/receipts",
          amount: toMoney(receipt.vatAmount),
          actionLabel: ec("evidence.action.uploadReceipt"),
        })
      );
    }
    if (toMoney(receipt.vatAmount) > 0 && !receipt.posted) {
      filingRiskScan.push(
        makeIssue({
          id: `receipt-unposted:${receipt.id}`,
          severity: "warning",
          workflowId: "filing_risk_scan",
          title: ec("evidence.issue.receiptUnposted.title"),
          detail: receipt.merchant
            ? ec("evidence.issue.receiptUnposted.detail", { merchant: String(receipt.merchant) })
            : ec("evidence.issue.receiptUnpostedGeneric.detail"),
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
          title: ec("evidence.issue.customerTrn.title", { number: String(invoice.number) }),
          detail: ec("evidence.issue.customerTrn.detail"),
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
          title: ec("evidence.issue.draftInvoice.title", { number: String(invoice.number) }),
          detail: ec("evidence.issue.draftInvoice.detail"),
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
          title:
            bill.bill_number || bill.vendor_name
              ? ec("evidence.issue.billPending.title", {
                  ref: String(bill.bill_number || bill.vendor_name),
                })
              : ec("evidence.issue.billPendingGeneric.title"),
          detail: ec("evidence.issue.billPending.detail"),
          sourceType: "vendor_bill",
          sourceId: bill.id as string | null | undefined,
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
        title: ec("evidence.issue.bankUnreconciled.title", {
          count: String(bankSummary.unreconciled),
        }),
        detail: ec("evidence.issue.bankUnreconciled.detail"),
        href: "/bank-reconciliation",
        actionLabel: ec("evidence.action.reconcileBank"),
      })
    );
  }

  if (!latestCtReturn) {
    missingEvidence.push(
      makeIssue({
        id: "ct:no-return",
        severity: "warning",
        workflowId: "corporate_tax_workpaper",
        title: ec("evidence.issue.ctNotStarted.title"),
        detail: ec("evidence.issue.ctNotStarted.detail"),
        href: "/corporate-tax",
        actionLabel: ec("evidence.action.openCorporateTax"),
      })
    );
  } else if (!Array.isArray((latestCtReturn.workpaper as AnyRecord | undefined)?.adjustments)) {
    filingRiskScan.push(
      makeIssue({
        id: `ct:no-adjustments:${latestCtReturn.id}`,
        severity: "info",
        workflowId: "corporate_tax_workpaper",
        title: ec("evidence.issue.ctNoAdjustments.title"),
        detail: ec("evidence.issue.ctNoAdjustments.detail"),
        href: "/corporate-tax",
        sourceType: "corporate_tax_return",
        sourceId: latestCtReturn.id as string | null | undefined,
      })
    );
  }

  for (const item of incompleteCloseItems) {
    filingRiskScan.push(
      makeIssue({
        id: `month-end:${item.id}`,
        severity: "warning",
        workflowId: "month_end_cockpit",
        title: adopt(item.title),
        detail: adopt(item.details || item.description),
        href: "/month-end",
        actionLabel: ec("evidence.action.openClose"),
      })
    );
  }

  for (const task of overdueComplianceTasks.slice(0, 10) as AnyRecord[]) {
    filingRiskScan.push(
      makeIssue({
        id: `compliance-task:${task.id}`,
        severity: "critical",
        workflowId: "filing_timeline",
        title: ec("evidence.issue.overdueTask.title", { title: String(task.title) }),
        detail: isoDate(task.dueDate)
          ? ec("evidence.issue.overdueTask.detail", {
              date: String(isoDate(task.dueDate)).slice(0, 10),
            })
          : ec("evidence.issue.overdueTaskNoDate.detail"),
        href: "/compliance-calendar",
        sourceType: "compliance_task",
        sourceId: task.id as string | null | undefined,
      })
    );
  }

  const proofDrilldowns: EvidenceProofLine[] = [
    ...outputVatRows.slice(0, 8).map(
      (row: AnyRecord): EvidenceProofLine => ({
        id: `vat-output:${row.id}`,
        label: ec("evidence.proof.label.vatOutput"),
        sourceType: "vat_workpaper_row",
        sourceId: row.id as string | null | undefined,
        sourceDocumentId: (row.sourceDocumentId ?? null) as string | null | undefined,
        documentNumber: row.invoiceNumber as string | null | undefined,
        date: isoDate(row.documentDate),
        party: row.counterpartyName as string | null | undefined,
        amount: toMoney(row.taxableAmount),
        vatAmount: toMoney(row.vatAmount),
        status: row.status as string,
        proofStatus: row.sourceDocumentId ? "ready" : "needs_review",
        documentStatus: row.sourceDocumentId ? "attached" : "needs_review",
        documentLabel: row.sourceDocumentId
          ? ec("evidence.proof.doc.linkedSource")
          : ec("evidence.proof.doc.noSourceLinked"),
        documentPreview: row.sourceDocumentId
          ? ec("evidence.proof.preview.outputLinked", { id: String(row.sourceDocumentId) })
          : ec("evidence.proof.preview.outputUnlinked"),
        documentHref: row.sourceDocumentId ? "/document-vault" : "/vat-filing",
        attachmentCount: row.sourceDocumentId ? 1 : 0,
        href: "/vat-filing",
      })
    ),
    ...inputVatRows.slice(0, 8).map(
      (row: AnyRecord): EvidenceProofLine => ({
        id: `vat-input:${row.id}`,
        label: ec("evidence.proof.label.vatInput"),
        sourceType: "vat_workpaper_row",
        sourceId: row.id as string | null | undefined,
        sourceDocumentId: (row.sourceDocumentId ?? null) as string | null | undefined,
        documentNumber: row.invoiceNumber as string | null | undefined,
        date: isoDate(row.documentDate),
        party: row.counterpartyName as string | null | undefined,
        amount: toMoney(row.taxableAmount),
        vatAmount: toMoney(row.vatAmount),
        status: row.status as string,
        proofStatus: row.sourceDocumentId ? "ready" : "needs_review",
        documentStatus: row.sourceDocumentId ? "attached" : "missing",
        documentLabel: row.sourceDocumentId
          ? ec("evidence.proof.doc.linkedTaxInvoice")
          : ec("evidence.proof.doc.taxInvoiceNotLinked"),
        documentPreview: row.sourceDocumentId
          ? ec("evidence.proof.preview.inputLinked", { id: String(row.sourceDocumentId) })
          : ec("evidence.proof.preview.inputUnlinked"),
        documentHref: row.sourceDocumentId ? "/document-vault" : "/vat-filing",
        attachmentCount: row.sourceDocumentId ? 1 : 0,
        href: "/vat-filing",
      })
    ),
    ...periodInvoices.slice(0, 6).map(
      (invoice: AnyRecord): EvidenceProofLine => ({
        id: `invoice:${invoice.id}`,
        label: ec("evidence.proof.label.salesInvoice"),
        sourceType: "invoice",
        sourceId: invoice.id as string | null | undefined,
        documentNumber: invoice.number as string | null | undefined,
        date: isoDate(invoice.date),
        party: invoice.customerName as string | null | undefined,
        amount: toMoney(invoice.total || invoice.baseCurrencyAmount),
        vatAmount: toMoney(invoice.vatAmount),
        status: invoice.status as string,
        proofStatus: invoice.status === "draft" ? "needs_review" : "ready",
        documentStatus: invoice.status === "draft" ? "needs_review" : "generated",
        documentLabel:
          invoice.status === "draft"
            ? ec("evidence.proof.doc.draftInvoice")
            : ec("evidence.proof.doc.generatedInvoice"),
        documentPreview:
          invoice.status === "draft"
            ? ec("evidence.proof.preview.draftInvoice")
            : ec("evidence.proof.preview.invoiceAvailable"),
        documentHref: "/invoices",
        attachmentCount: invoice.status === "draft" ? 0 : 1,
        href: "/invoices",
      })
    ),
    ...periodReceipts.slice(0, 6).map((receipt: AnyRecord): EvidenceProofLine => {
      const hasImage = Boolean(receipt.imagePath || receipt.imageData);
      const hasSourceText = Boolean(receipt.rawText);
      return {
        id: `receipt:${receipt.id}`,
        label: ec("evidence.proof.label.purchaseReceipt"),
        sourceType: "receipt",
        sourceId: receipt.id as string | null | undefined,
        documentNumber: (receipt.invoiceNumber ?? receipt.receiptNumber ?? null) as
          | string
          | null
          | undefined,
        date: isoDate(receipt.date ?? receipt.createdAt),
        party: receipt.merchant as string | null | undefined,
        amount: toMoney(((receipt.amount as number) || 0) + ((receipt.vatAmount as number) || 0)),
        vatAmount: toMoney(receipt.vatAmount),
        status: receipt.posted ? "posted" : "unposted",
        proofStatus: hasImage || hasSourceText ? "ready" : "missing",
        documentStatus: hasImage ? "attached" : hasSourceText ? "source_text" : "missing",
        documentLabel: hasImage
          ? ec("evidence.proof.doc.receiptAttached")
          : hasSourceText
            ? ec("evidence.proof.doc.ocrOnly")
            : ec("evidence.proof.doc.receiptMissing"),
        documentPreview: hasImage
          ? ec("evidence.proof.preview.receiptAttached")
          : hasSourceText
            ? ec("evidence.proof.preview.sourceTextOnly")
            : ec("evidence.proof.preview.receiptMissing"),
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
      title: task.title as string,
      dueDate: isoDate(task.dueDate) || new Date().toISOString(),
      category: task.category as string,
      status: task.status as string,
      consequence:
        task.category === "vat_filing"
          ? ec("evidence.timeline.consequence.vat")
          : ec("evidence.timeline.consequence.task"),
      readinessScore:
        task.status === "completed" ? 100 : new Date(task.dueDate as string | Date) < now ? 20 : 70,
      href: "/compliance-calendar",
    })),
  ];

  if (latestVatWorkpaper) {
    timeline.push({
      id: `vat-workpaper:${latestVatWorkpaper.id}`,
      title: ec("evidence.timeline.vatWorkpaperDue"),
      dueDate: isoDate(latestVatWorkpaper.dueDate) || new Date().toISOString(),
      category: "vat_filing",
      status: latestVatWorkpaper.status,
      consequence: ec("evidence.timeline.consequence.vatWorkpaper"),
      readinessScore: scoreFromOpenItems(draftVatRows.length, vatRows.length || 1),
      href: "/vat-filing",
    });
  }

  if (latestCtReturn) {
    // R08-03: 9 months after period end with end-of-month clamping
    // (31 Dec 2025 -> 30 Sep 2026; setUTCMonth overflowed to 1 Oct).
    const ctDueDate = ctFilingDeadline(ctIsoDay(latestCtReturn.taxPeriodEnd));
    timeline.push({
      id: `ct:${latestCtReturn.id}`,
      title: ec("evidence.timeline.ctDeadline"),
      dueDate: `${ctDueDate}T00:00:00.000Z`,
      category: "corporate_tax",
      status: latestCtReturn.status as string,
      consequence: ec("evidence.timeline.consequence.ct"),
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
      actionLabel: firstCritical.actionLabel || ec("evidence.action.resolveNow"),
    });
  }
  if (refundExposure > 0) {
    ownerActions.push({
      id: "refund-pack",
      priority: "now",
      title: ec("evidence.owner.refund.title", { amount: refundExposure.toLocaleString("en-AE") }),
      detail: ec("evidence.owner.refund.detail", { count: refundProofGaps.length }),
      href: "/vat-filing",
      actionLabel: ec("evidence.action.buildRefundPack"),
    });
  }
  if (incompleteCloseItems.length > 0) {
    ownerActions.push({
      id: "month-end",
      priority: "next",
      title: ec("evidence.owner.monthEnd.title", { count: incompleteCloseItems.length }),
      detail: ec("evidence.owner.monthEnd.detail"),
      href: "/month-end",
      actionLabel: ec("evidence.action.openCloseCockpit"),
    });
  }
  if (!latestCtReturn) {
    ownerActions.push({
      id: "ct-workpaper",
      priority: "next",
      title: ec("evidence.owner.ct.title"),
      detail: ec("evidence.owner.ct.detail"),
      href: "/corporate-tax",
      actionLabel: ec("evidence.action.openCtWorkpaper"),
    });
  }
  if (ownerActions.length === 0) {
    ownerActions.push({
      id: "monitor",
      priority: "monitor",
      title: ec("evidence.owner.monitor.title"),
      detail: ec("evidence.owner.monitor.detail"),
      href: "/evidence-center",
      actionLabel: ec("evidence.action.monitorEvidence"),
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
      title: ec("evidence.workflow.refundPack.title"),
      score: refundScore,
      metric:
        refundExposure > 0
          ? ec("evidence.workflow.refundPack.metric", {
              amount: refundExposure.toLocaleString("en-AE"),
            })
          : ec("evidence.workflow.refundPack.noExposure"),
      description: ec("evidence.workflow.refundPack.description"),
      primaryHref: "/vat-filing",
      primaryAction: ec("evidence.action.openVatEvidence"),
      bullets: [
        ec("evidence.workflow.refundPack.bullet.inputRows", { count: inputVatRows.length }),
        ec("evidence.workflow.refundPack.bullet.gaps", { count: refundProofGaps.length }),
        ec("evidence.workflow.refundPack.bullet.certs", {
          count: documentCategoryCount.get("tax_certificate") || 0,
        }),
      ],
      issues: refundProofGaps,
      proofCount: inputVatRows.length,
    }),
    workflow({
      id: "proof_drilldown",
      title: ec("evidence.workflow.proof.title"),
      score: proofScore,
      metric: ec("evidence.workflow.proof.metric", {
        ready: proofReady,
        total: proofDrilldowns.length,
      }),
      description: ec("evidence.workflow.proof.description"),
      primaryHref: "/evidence-center#proof-drilldown",
      primaryAction: ec("evidence.action.reviewProof"),
      bullets: [
        ec("evidence.workflow.proof.bullet.output", { count: outputVatRows.length }),
        ec("evidence.workflow.proof.bullet.input", { count: inputVatRows.length }),
        ec("evidence.workflow.proof.bullet.invoices", { count: periodInvoices.length }),
      ],
      issues: openMissingEvidence.filter((issue) => issue.sourceType === "vat_workpaper_row"),
      proofCount: proofDrilldowns.length,
    }),
    workflow({
      id: "corporate_tax_workpaper",
      title: ec("evidence.workflow.ct.title"),
      score: ctScore,
      metric: latestCtReturn
        ? ec("evidence.workflow.ct.metric", {
            amount: corporateTaxPayable.toLocaleString("en-AE"),
          })
        : ec("evidence.workflow.ct.notStarted"),
      description: ec("evidence.workflow.ct.description"),
      primaryHref: "/corporate-tax",
      primaryAction: ec("evidence.action.openCorporateTax"),
      bullets: [
        latestCtReturn
          ? ec("evidence.workflow.ct.bullet.status", { status: String(latestCtReturn.status) })
          : ec("evidence.workflow.ct.bullet.noReturn"),
        latestCtReturn?.workpaper
          ? ec("evidence.workflow.ct.bullet.workpaperExists")
          : ec("evidence.workflow.ct.bullet.adjustmentNeeded"),
        ec("evidence.workflow.ct.bullet.engine"),
      ],
      issues: allIssues.filter((issue) => issue.workflowId === "corporate_tax_workpaper"),
      proofCount: latestCtReturn ? 1 : 0,
    }),
    workflow({
      id: "missing_evidence",
      title: ec("evidence.workflow.missing.title"),
      score: missingScore,
      metric: ec("evidence.workflow.missing.metric", { count: openMissingEvidence.length }),
      description: ec("evidence.workflow.missing.description"),
      primaryHref: "/evidence-center#missing-evidence",
      primaryAction: ec("evidence.action.workInbox"),
      bullets: [
        ec("evidence.workflow.missing.bullet.requirements", {
          count: openDocumentRequirements.length,
        }),
        ec("evidence.workflow.missing.bullet.receipts", { count: periodReceipts.length }),
        ec("evidence.workflow.missing.bullet.critical", {
          count: openMissingEvidence.filter((issue) => issue.severity === "critical").length,
        }),
      ],
      issues: openMissingEvidence,
      proofCount: documentRows.length,
    }),
    workflow({
      id: "client_request_autopilot",
      title: ec("evidence.workflow.request.title"),
      score: openMissingEvidence.length ? 90 : 100,
      metric: ec("evidence.workflow.request.metric", { count: requestDraft.itemCount }),
      description: ec("evidence.workflow.request.description"),
      primaryHref: "/evidence-center#request-draft",
      primaryAction: ec("evidence.action.reviewDraft"),
      bullets: [
        ec("evidence.workflow.request.bullet.draftOnlyNoSend"),
        ec("evidence.workflow.request.bullet.queue"),
        ec("evidence.workflow.request.bullet.otp"),
      ],
      issues: [],
      proofCount: requestDraft.itemCount,
    }),
    workflow({
      id: "month_end_cockpit",
      title: ec("evidence.workflow.monthEnd.title"),
      score: closeScore,
      metric: ec("evidence.workflow.monthEnd.metric", {
        done: closeChecklist.length - incompleteCloseItems.length,
        total: closeChecklist.length,
      }),
      description: ec("evidence.workflow.monthEnd.description"),
      primaryHref: "/month-end",
      primaryAction: ec("evidence.action.openMonthEnd"),
      bullets: [
        ec("evidence.workflow.monthEnd.bullet.bank", {
          reconciled: Number(bankSummary.reconciled || 0),
          total: Number(bankSummary.total || 0),
        }),
        ec("evidence.workflow.monthEnd.bullet.blockers", { count: incompleteCloseItems.length }),
        ec("evidence.workflow.monthEnd.bullet.period", {
          start: isoDay(month.start),
          end: isoDay(month.end),
        }),
      ],
      issues: openFilingRiskScan.filter((issue) => issue.workflowId === "month_end_cockpit"),
      proofCount: closeChecklist.length,
    }),
    workflow({
      id: "filing_risk_scan",
      title: ec("evidence.workflow.risk.title"),
      score: riskScore,
      metric: ec("evidence.workflow.risk.metric", { count: openFilingRiskScan.length }),
      description: ec("evidence.workflow.risk.description"),
      primaryHref: "/evidence-center#risk-scan",
      primaryAction: ec("evidence.action.reviewRisks"),
      bullets: [
        ec("evidence.workflow.risk.bullet.critical", {
          count: openFilingRiskScan.filter((issue) => issue.severity === "critical").length,
        }),
        ec("evidence.workflow.risk.bullet.draftRows", { count: draftVatRows.length }),
        ec("evidence.workflow.risk.bullet.bills", { count: vendorBillRows.length }),
      ],
      issues: openFilingRiskScan,
      proofCount: openFilingRiskScan.length,
    }),
    workflow({
      id: "smart_excel_import",
      title: ec("evidence.workflow.excel.title"),
      score: latestVatWorkpaper ? 95 : 75,
      metric: latestVatWorkpaper
        ? ec("evidence.workflow.excel.ready")
        : ec("evidence.workflow.excel.createFirst"),
      description: ec("evidence.workflow.excel.description"),
      primaryHref: "/vat-filing",
      primaryAction: ec("evidence.action.pasteVatRows"),
      bullets: [
        ec("evidence.workflow.excel.bullet.tab"),
        ec("evidence.workflow.excel.bullet.dates"),
        ec("evidence.workflow.excel.bullet.category"),
      ],
      issues: latestVatWorkpaper
        ? []
        : openMissingEvidence.filter((issue) => issue.id === "vat:no-workpaper"),
      proofCount: vatRows.length,
    }),
    workflow({
      id: "filing_timeline",
      title: ec("evidence.workflow.timeline.title"),
      score: scoreFromOpenItems(overdueTimelineCount, timeline.length),
      metric: ec("evidence.workflow.timeline.metric", { count: timeline.length }),
      description: ec("evidence.workflow.timeline.description"),
      primaryHref: "/compliance-calendar",
      primaryAction: ec("evidence.action.openCalendar"),
      bullets: [
        ec("evidence.workflow.timeline.bullet.overdue", { count: overdueTimelineCount }),
        ec("evidence.workflow.timeline.bullet.openTasks", { count: openComplianceTasks.length }),
        ec("evidence.workflow.timeline.bullet.tied"),
      ],
      issues: openFilingRiskScan.filter((issue) => issue.workflowId === "filing_timeline"),
      proofCount: timeline.length,
    }),
    workflow({
      id: "owner_actions",
      title: ec("evidence.workflow.owner.title"),
      score: readinessScore,
      metric: ec("evidence.workflow.owner.metric", { count: ownerActions.length }),
      description: ec("evidence.workflow.owner.description"),
      primaryHref: "/evidence-center#owner-actions",
      primaryAction: ec("evidence.action.reviewActions"),
      bullets: ownerActions.slice(0, 3).map((action) => action.title),
      issues: allIssues.filter((issue) => issue.severity === "critical"),
      proofCount: ownerActions.length,
    }),
  ];

  const withIssueCopy = (issue: EvidenceIssue): EvidenceIssue => ({
    ...issue,
    copy: {
      title: ref(issue.title),
      detail: ref(issue.detail),
      actionLabel: ref(issue.actionLabel),
    },
  });

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
    workflows: workflows.map((item) => ({
      ...item,
      copy: {
        title: ref(item.title),
        metric: ref(item.metric),
        description: ref(item.description),
        primaryAction: ref(item.primaryAction),
        bullets: item.bullets.map((bullet) => ref(bullet) ?? null),
      },
    })),
    missingEvidence: auditedMissingEvidence.slice(0, 50).map(withIssueCopy),
    filingRiskScan: auditedFilingRiskScan.slice(0, 50).map(withIssueCopy),
    proofDrilldowns: proofDrilldowns.map((line) => ({
      ...line,
      copy: {
        label: ref(line.label),
        documentLabel: ref(line.documentLabel),
        documentPreview: ref(line.documentPreview),
      },
    })),
    filingTimeline: timeline.slice(0, 20).map((item) => ({
      ...item,
      copy: { title: ref(item.title), consequence: ref(item.consequence) },
    })),
    ownerActions: ownerActions.slice(0, 6).map((action) => ({
      ...action,
      copy: {
        title: ref(action.title),
        detail: ref(action.detail),
        actionLabel: ref(action.actionLabel),
      },
    })),
    refundPack,
    actionTrail: actionTrail.slice(0, 20).map((entry) => {
      const description = parseServerCopy(entry.description, EVIDENCE_AUDIT_TEMPLATES);
      return description ? { ...entry, copy: { description } } : entry;
    }),
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

// ─── Corporate tax evidence pack (W4-A, R08-22) ─────────────────────────────

export interface CtEvidenceAdjustment {
  id: string;
  category: string;
  label: string;
  amount: number;
  source: "manual" | "ledger";
  support: "ledger_account" | "notes" | "missing";
  notes: string | null;
}

export interface CtEvidencePack {
  companyId: string;
  companyName: string;
  generatedAt: string;
  ctReturn: {
    id: string;
    status: string;
    taxPeriodStart: string;
    taxPeriodEnd: string;
    filingDeadline: string;
    taxableIncome: number;
    taxPayable: number;
    amendmentNumber: number;
    reviewedBy: string | null;
    filedAt: string | null;
  } | null;
  workpaperRowCount: number;
  adjustments: CtEvidenceAdjustment[];
  relatedParties: Array<{
    id: string;
    name: string;
    relationship: string;
    jurisdiction: string | null;
    transactionValue: number;
  }>;
  transferPricing: {
    disclosureFormRequired: boolean;
    masterLocalFileRequired: boolean;
    relatedPartyTransactionsTotal: number;
  } | null;
  deferredTax: { net: number; itemCount: number } | null;
  checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    detail: string;
    /** Stable keys + params for the client catalogs (English label/detail stay for the workbook). */
    copy?: { label: EvidenceCopyRef; detail: EvidenceCopyRef };
  }>;
  readinessScore: number;
  adviserReviewPending: boolean;
  workbookFilename: string;
  filingNotice: string;
}

function ctIsoDay(value: unknown): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime())
    ? ""
    : new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
}

/** The live (non-void, non-superseded) CT return for the latest period. */
function latestLiveCtReturn(ctReturns: AnyRecord[]): AnyRecord | undefined {
  return [...ctReturns]
    .filter((r) => r.status !== "void" && r.status !== "amended")
    .sort(
      (a, b) =>
        new Date(b.taxPeriodEnd as string | Date).getTime() -
          new Date(a.taxPeriodEnd as string | Date).getTime() ||
        (Number(b.amendmentNumber) || 0) - (Number(a.amendmentNumber) || 0)
    )[0];
}

export async function buildCtEvidencePack(companyId: string): Promise<CtEvidencePack> {
  const company = await storage.getCompany(companyId);
  if (!company) throw new Error("Company not found");
  const [ctReturns, relatedParties, profile] = await Promise.all([
    storage.getCorporateTaxReturnsByCompanyId(companyId).catch(() => []),
    listRelatedParties(companyId),
    getCtProfile(companyId),
  ]);
  const latest = latestLiveCtReturn(ctReturns as AnyRecord[]);
  const wp = (latest?.workpaper ?? {}) as AnyRecord;
  const rawAdjustments = [
    ...((Array.isArray(wp.ledgerAdjustments) ? wp.ledgerAdjustments : []) as AnyRecord[]),
    ...((Array.isArray(wp.adjustments) ? wp.adjustments : []) as AnyRecord[]),
  ];
  const adjustments: CtEvidenceAdjustment[] = rawAdjustments.map((a) => {
    const source = a.source === "ledger" ? "ledger" : "manual";
    const notes = typeof a.notes === "string" && a.notes.trim() ? a.notes.trim() : null;
    return {
      id: String(a.id),
      category: String(a.category),
      label: String(a.label ?? a.category),
      amount: Number(a.amount) || 0,
      source,
      support: source === "ledger" && a.accountId ? "ledger_account" : notes ? "notes" : "missing",
      notes,
    };
  });
  const tp = wp.transferPricing as AnyRecord | undefined;
  const periodEnd = latest ? ctIsoDay(latest.taxPeriodEnd) : "";
  const checks: CtEvidencePack["checks"] = [];
  const addCheck = (
    key: string,
    passed: boolean,
    detailKey: string,
    detailParams: Record<string, string | number> = {}
  ) => {
    const label = evidenceCopy(`evidence.ct.check.${key}`);
    const detail = evidenceCopy(detailKey, detailParams);
    checks.push({
      key,
      label: label.text,
      passed,
      detail: detail.text,
      copy: { label: label.copy, detail: detail.copy },
    });
  };
  addCheck(
    "return_exists",
    Boolean(latest),
    latest ? "evidence.ct.detail.status" : "evidence.ct.detail.noReturn",
    latest ? { status: String(latest.status) } : {}
  );
  addCheck(
    "computed",
    Boolean(wp.computation),
    wp.computedAt ? "evidence.ct.detail.computedOn" : "evidence.ct.detail.notComputed",
    wp.computedAt ? { date: String(wp.computedAt).slice(0, 10) } : {}
  );
  addCheck(
    "reviewed",
    Boolean(latest?.reviewedBy),
    latest?.reviewedBy ? "evidence.ct.detail.reviewerRecorded" : "evidence.ct.detail.noReviewer"
  );
  const unsupported = adjustments.filter((a) => a.support === "missing").length;
  addCheck(
    "adjustments_supported",
    unsupported === 0,
    adjustments.length === 0
      ? "evidence.ct.detail.noAdjustments"
      : "evidence.ct.detail.adjustmentsSupported",
    adjustments.length === 0
      ? {}
      : { supported: adjustments.length - unsupported, total: adjustments.length }
  );
  const needsRegister =
    Boolean(tp?.disclosureFormRequired) || Number(tp?.relatedPartyTransactionsTotal) > 0;
  addCheck(
    "related_party_register",
    !needsRegister || relatedParties.length > 0,
    needsRegister ? "evidence.ct.detail.relatedRecorded" : "evidence.ct.detail.noRelatedActivity",
    needsRegister ? { count: relatedParties.length } : {}
  );
  const readinessScore = Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);
  const slug =
    String(company.name ?? "company")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "company";
  return {
    companyId,
    companyName: company.name,
    generatedAt: new Date().toISOString(),
    ctReturn: latest
      ? {
          id: latest.id as string,
          status: latest.status as string,
          taxPeriodStart: ctIsoDay(latest.taxPeriodStart),
          taxPeriodEnd: periodEnd,
          filingDeadline: ctFilingDeadline(periodEnd),
          taxableIncome: Number(latest.taxableIncome) || 0,
          taxPayable: Number(latest.taxPayable) || 0,
          amendmentNumber: Number(latest.amendmentNumber) || 0,
          reviewedBy: (latest.reviewedBy as string | null | undefined) ?? null,
          filedAt: latest.filedAt ? new Date(latest.filedAt as string | Date).toISOString() : null,
        }
      : null,
    workpaperRowCount: Array.isArray(wp.rows) ? wp.rows.length : 0,
    adjustments,
    relatedParties: relatedParties.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      jurisdiction: p.jurisdiction,
      transactionValue: p.transactionValue,
    })),
    transferPricing: tp
      ? {
          disclosureFormRequired: tp.disclosureFormRequired === true,
          masterLocalFileRequired: tp.masterLocalFileRequired === true,
          relatedPartyTransactionsTotal: Number(tp.relatedPartyTransactionsTotal) || 0,
        }
      : null,
    deferredTax: wp.deferredTax
      ? {
          net: Number((wp.deferredTax as AnyRecord).net) || 0,
          itemCount: (((wp.deferredTax as AnyRecord).items ?? []) as unknown[]).length,
        }
      : null,
    checks,
    readinessScore,
    adviserReviewPending: profile.adviserReviewPending,
    workbookFilename: `ct-evidence-pack-${slug}-${periodEnd || "no-return"}.xlsx`,
    filingNotice:
      "Evidence pack for review. Muhasib does not file or submit corporate tax returns to the FTA.",
  };
}

/** CT evidence workbook: the return workbook plus support and register sheets. */
export async function buildCtEvidencePackWorkbook(pack: CtEvidencePack): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  if (pack.ctReturn) {
    const ctReturn = await storage.getCorporateTaxReturn(pack.ctReturn.id);
    const company = await storage.getCompany(pack.companyId);
    if (ctReturn) {
      const base = await buildCtReturnWorkbook(ctReturn, company ?? null);
      await workbook.xlsx.load(base as unknown as ArrayBuffer);
    }
  }
  const summary = workbook.addWorksheet("CT Evidence Summary");
  summary.columns = [
    { key: "a", width: 52 },
    { key: "b", width: 18 },
    { key: "c", width: 60 },
  ];
  summary.addRow([`Corporate tax evidence pack — ${pack.companyName}`]).font = { bold: true };
  summary.addRow([pack.filingNotice]);
  summary.addRow([
    "Readiness score",
    pack.readinessScore,
    pack.adviserReviewPending ? "Adviser review pending" : "Adviser confirmation recorded",
  ]);
  summary.addRow([]);
  summary.addRow(["Check", "Passed", "Detail"]).font = { bold: true };
  for (const c of pack.checks) summary.addRow([c.label, c.passed ? "Yes" : "No", c.detail]);

  const adj = workbook.addWorksheet("Adjustments Support");
  adj.columns = [
    { key: "label", width: 44 },
    { key: "category", width: 26 },
    { key: "amount", width: 18 },
    { key: "source", width: 12 },
    { key: "support", width: 18 },
    { key: "notes", width: 50 },
  ];
  adj.addRow(["Adjustment", "Category", "Amount (AED)", "Source", "Support", "Notes"]).font = {
    bold: true,
  };
  for (const a of pack.adjustments) {
    adj.addRow([a.label, a.category, a.amount, a.source, a.support, a.notes ?? ""]);
  }

  const rp = workbook.addWorksheet("Related Parties");
  rp.columns = [
    { key: "name", width: 40 },
    { key: "relationship", width: 20 },
    { key: "jurisdiction", width: 20 },
    { key: "value", width: 20 },
  ];
  rp.addRow(["Name", "Relationship", "Jurisdiction", "Transactions (AED)"]).font = { bold: true };
  for (const p of pack.relatedParties) {
    rp.addRow([p.name, p.relationship, p.jurisdiction ?? "", p.transactionValue]);
  }
  if (pack.transferPricing) {
    rp.addRow([]);
    rp.addRow([
      "TP disclosure form required",
      pack.transferPricing.disclosureFormRequired ? "Yes" : "No",
    ]);
    rp.addRow([
      "Master File / Local File required",
      pack.transferPricing.masterLocalFileRequired ? "Yes" : "No",
    ]);
  }
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}
