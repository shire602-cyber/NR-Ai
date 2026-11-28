/**
 * Small HTTP helpers shared by the report routes: access checks, deprecation
 * headers for legacy aliases (R12-05) and xlsx/csv output with numeric cells
 * (R11-10).
 */
import type { Request, Response } from "express";
import { storage } from "../storage";
import { DomainError } from "../errors";
import { csvCell } from "../../shared/csv";
import { buildGenericWorkbook, type GenericExportSheet } from "../services/excel-export.service";

export async function assertReportAccess(req: Request, companyId: string): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new DomainError("UNAUTHORIZED", 401);
  const ok = await storage.hasCompanyAccess(userId, companyId);
  if (!ok) throw new DomainError("ACCESS_DENIED", 403, undefined, "Access denied");
}

/** Mark a legacy alias as deprecated and point at the canonical route. */
export function deprecate(res: Response, successor: string): void {
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", `<${successor}>; rel="successor-version"`);
}

export type ExportFormat = "json" | "xlsx" | "csv";

export function readFormat(value: unknown): ExportFormat {
  if (value === undefined || value === "" || value === "json") return "json";
  if (value === "xlsx" || value === "csv") return value;
  throw new DomainError(
    "INVALID_EXPORT_FORMAT",
    400,
    undefined,
    "format must be json, xlsx or csv"
  );
}

export function toCsv(sheet: GenericExportSheet): string {
  const header = sheet.columns.map((c) => csvCell(c.header)).join(",");
  const body = sheet.rows.map((r) => sheet.columns.map((c) => csvCell(r[c.key])).join(","));
  return "﻿" + [header, ...body].join("\r\n") + "\r\n";
}

export async function sendTabular(
  res: Response,
  format: "xlsx" | "csv",
  filenameBase: string,
  sheets: GenericExportSheet[]
): Promise<void> {
  const safe = filenameBase.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "report";
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.csv"`);
    res.send(sheets.map(toCsv).join("\r\n"));
    return;
  }
  const buf = await buildGenericWorkbook(sheets, { title: filenameBase });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${safe}.xlsx"`);
  res.send(buf);
}
