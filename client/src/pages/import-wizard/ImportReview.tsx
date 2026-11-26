import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTranslation, type Locale } from "@/lib/i18n";
import type { Issue, Job } from "../ImportWizard";
import { fixStepKeys, hasNoData, issueText, statusLabel } from "./issues";

export default function ImportReview({
  job,
  locale,
  onValidate,
  onCommit,
  isValidating,
  isCommitting,
}: {
  job: Job;
  locale: Locale;
  onValidate: () => void;
  onCommit: () => void;
  isValidating: boolean;
  isCommitting: boolean;
}) {
  const { t } = useTranslation();
  const fixSteps = job.status === "committed" ? [] : fixStepKeys(job);
  const errors = useMemo(() => job.issues.filter((i) => i.level === "error"), [job]);
  const warnings = useMemo(() => job.issues.filter((i) => i.level === "warning"), [job]);
  const columns = job.rows[0] ? Object.keys(job.rows[0]) : [];
  const detectedRows = Number(job.summary.detectedRows) || 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t["importWizard.step2"]}
          <Badge variant="outline">{statusLabel(job.status, t)}</Badge>
        </CardTitle>
        <CardDescription>
          {job.rowCount} {t["importWizard.rows"]}
          {job.summary.mapping
            ? ` · ${t["importWizard.mapped"]}:${Object.entries(job.summary.mapping)
                .map(([k, v]) => `⁨${v} → ${k}⁩`)
                .join(", ")}`
            : ""}
          {job.summary.unmappedColumns?.length
            ? ` · ${t["importWizard.unmapped"]}:${job.summary.unmappedColumns.join(", ")}`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {columns.length > 0 && (
          <div className="max-h-80 overflow-auto rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col}>{col}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {job.rows.slice(0, 50).map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col} className="whitespace-nowrap text-xs">
                        {row[col] == null ? "" : String(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <IssueList
          title={t["importWizard.errors"]}
          issues={errors}
          tone="error"
          locale={locale}
          detectedRows={detectedRows}
        />
        <IssueList
          title={t["importWizard.warnings"]}
          issues={warnings}
          tone="warning"
          locale={locale}
          detectedRows={detectedRows}
        />
        {hasNoData(job) && (
          <p
            className="flex items-start gap-2 text-sm text-destructive"
            data-testid="text-import-no-rows"
            role="alert"
          >
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {t["importWizard.noRows"]}
          </p>
        )}
        {job.rowCount > 0 && !errors.length && !warnings.length && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            {t["importWizard.noIssues"]}
          </p>
        )}
        {fixSteps.length > 0 && (
          <div className="space-y-1 text-sm font-medium" data-testid="text-import-next-fix">
            {fixSteps.map((key) => (
              <p key={key}>{t[key]}</p>
            ))}
          </div>
        )}
        {job.status === "previewed" && job.rowCount > 0 && !errors.length && (
          <p className="text-sm font-medium" data-testid="text-import-next-validate">
            {t["importWizard.readyToValidate"]}
          </p>
        )}
        {job.status === "validated" && !errors.length && (
          <p className="text-sm font-medium" data-testid="text-import-next-commit">
            {t["importWizard.readyToCommit"]}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onValidate}
            disabled={job.status === "committed" || isValidating}
            data-testid="button-import-validate"
          >
            {t[isValidating ? "importWizard.validating" : "importWizard.validate"]}
          </Button>
          <Button
            onClick={onCommit}
            disabled={job.status !== "validated" || isCommitting}
            data-testid="button-import-commit"
          >
            {t[isCommitting ? "importWizard.committing" : "importWizard.commit"]}
          </Button>
        </div>
        {job.result && (
          <pre className="overflow-auto rounded bg-muted p-3 text-xs" dir="ltr">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function IssueList({
  title,
  issues,
  tone,
  locale,
  detectedRows,
}: {
  title: string;
  issues: Issue[];
  tone: "error" | "warning";
  locale: Locale;
  detectedRows: number;
}) {
  const { t } = useTranslation();
  if (!issues.length) return null;
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {title} ({issues.length})
      </p>
      <ul className="space-y-1 text-sm">
        {issues.slice(0, 100).map((i, idx) => (
          <li key={idx} className="flex gap-2">
            <Icon
              className={
                tone === "error" ? "mt-0.5 h-4 w-4 text-destructive" : "mt-0.5 h-4 w-4 text-warning"
              }
            />
            <span>
              {i.row ? `#${i.row} · ` : ""}
              {issueText(i, locale, t, detectedRows)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
