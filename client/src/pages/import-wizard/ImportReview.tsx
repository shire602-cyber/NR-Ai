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
import type { Locale } from "@/lib/i18n";
import type { Issue, Job } from "../ImportWizard";

const COPY = {
  en: {
    step2: "2. Review the mapping",
    mapped: "Mapped columns",
    unmapped: "Ignored columns",
    rows: "rows",
    validate: "Validate against my books",
    commit: "Commit import",
    warnings: "Warnings",
    noIssues: "No issues found.",
    validating: "Validating...",
    committing: "Committing...",
    noRows:
      "No data rows were found in this file. Check that it is the right export, that it has a header row and at least one data row, then choose it again.",
    fixErrors:
      "Fix the errors in your CSV file, then choose it again and run Preview. The import cannot be committed while errors remain.",
    readyToValidate: "Next: validate the file against your books.",
    readyToCommit: "Validation passed. Review the rows above, then commit the import.",
  },
  ar: {
    step2: "٢. راجع مطابقة الأعمدة",
    mapped: "الأعمدة المطابقة",
    unmapped: "الأعمدة المتجاهلة",
    rows: "صفوف",
    validate: "التحقق مقابل دفاتري",
    commit: "تأكيد الاستيراد",
    warnings: "تحذيرات",
    noIssues: "لا توجد مشكلات.",
    validating: "جارٍ التحقق...",
    committing: "جارٍ التأكيد...",
    noRows:
      "لم نجد أي صفوف بيانات في هذا الملف. تأكد من أنه التصدير الصحيح وأن به صف عناوين وصفًا واحدًا على الأقل من البيانات، ثم اخترْه مرة أخرى.",
    fixErrors:
      "صحّح الأخطاء في ملف CSV ثم اخترْه مرة أخرى ونفّذ المعاينة. لا يمكن تأكيد الاستيراد ما دامت الأخطاء قائمة.",
    readyToValidate: "الخطوة التالية: تحقّق من الملف مقابل دفاترك.",
    readyToCommit: "اكتمل التحقق بنجاح. راجع الصفوف أعلاه ثم أكّد الاستيراد.",
  },
};

export default function ImportReview({
  job,
  locale,
  statusLabels,
  errorsLabel,
  onValidate,
  onCommit,
  isValidating,
  isCommitting,
}: {
  job: Job;
  locale: Locale;
  statusLabels: Record<string, string>;
  errorsLabel: string;
  onValidate: () => void;
  onCommit: () => void;
  isValidating: boolean;
  isCommitting: boolean;
}) {
  const c = COPY[locale];
  const errors = useMemo(() => job.issues.filter((i) => i.level === "error"), [job]);
  const warnings = useMemo(() => job.issues.filter((i) => i.level === "warning"), [job]);
  const columns = job.rows[0] ? Object.keys(job.rows[0]) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {c.step2}
          <Badge variant="outline">{statusLabels[job.status] ?? job.status}</Badge>
        </CardTitle>
        <CardDescription>
          {job.rowCount} {c.rows}
          {job.summary.mapping
            ? ` · ${c.mapped}: ${Object.entries(job.summary.mapping)
                .map(([k, v]) => `⁨${v} → ${k}⁩`)
                .join(", ")}`
            : ""}
          {job.summary.unmappedColumns?.length
            ? ` · ${c.unmapped}: ${job.summary.unmappedColumns.join(", ")}`
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
        <IssueList title={errorsLabel} issues={errors} tone="error" />
        <IssueList title={c.warnings} issues={warnings} tone="warning" />
        {job.rowCount === 0 && job.rows.length === 0 && (
          <p
            className="flex items-start gap-2 text-sm text-destructive"
            data-testid="text-import-no-rows"
            role="alert"
          >
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {c.noRows}
          </p>
        )}
        {job.rowCount > 0 && !errors.length && !warnings.length && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            {c.noIssues}
          </p>
        )}
        {job.status !== "committed" && (errors.length > 0 || job.rowCount === 0) && (
          <p className="text-sm font-medium" data-testid="text-import-next-fix">
            {c.fixErrors}
          </p>
        )}
        {job.status === "previewed" && job.rowCount > 0 && !errors.length && (
          <p className="text-sm font-medium" data-testid="text-import-next-validate">
            {c.readyToValidate}
          </p>
        )}
        {job.status === "validated" && !errors.length && (
          <p className="text-sm font-medium" data-testid="text-import-next-commit">
            {c.readyToCommit}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onValidate}
            disabled={job.status === "committed" || isValidating}
            data-testid="button-import-validate"
          >
            {isValidating ? c.validating : c.validate}
          </Button>
          <Button
            onClick={onCommit}
            disabled={job.status !== "validated" || isCommitting}
            data-testid="button-import-commit"
          >
            {isCommitting ? c.committing : c.commit}
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
}: {
  title: string;
  issues: Issue[];
  tone: "error" | "warning";
}) {
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
              {i.message}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
