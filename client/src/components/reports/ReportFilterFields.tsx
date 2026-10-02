import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/lib/i18n";
import type { ReportFilterKey } from "@/lib/report-ui-rules";
import { messages as pageMessages } from "./ReportParamsBar.i18n";

const ALL = "__all__";
const KNOWN_SOURCES = [
  "manual",
  "invoice",
  "bill",
  "payment",
  "receipt",
  "payroll",
  "depreciation",
  "reversal",
  "system",
];

interface Option {
  value: string;
  label: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

interface Loader {
  path: (companyId: string) => string;
  toOption: (row: any, locale: string) => Option | null;
}

/** What each id filter loads, and how a row becomes a labelled option. */
const LOADERS: Partial<Record<ReportFilterKey, Loader>> = {
  accountId: {
    path: (c) => `/api/companies/${c}/accounts`,
    toOption: (a, locale) =>
      a?.id
        ? {
            value: a.id,
            label:
              `${a.code ?? ""} ${locale === "ar" && a.nameAr ? a.nameAr : (a.nameEn ?? "")}`.trim(),
          }
        : null,
  },
  contactId: {
    path: (c) => `/api/companies/${c}/customer-contacts`,
    toOption: (a, locale) =>
      a?.id
        ? { value: a.id, label: (locale === "ar" && a.nameAr ? a.nameAr : a.name) ?? "" }
        : null,
  },
  bankAccountId: {
    path: (c) => `/api/companies/${c}/bank-accounts`,
    toOption: (a) => (a?.id ? { value: a.id, label: a.nameEn ?? a.bankName ?? "" } : null),
  },
  userId: {
    path: (c) => `/api/companies/${c}/team`,
    toOption: (m) =>
      m?.userId ? { value: m.userId, label: m.user?.name || m.user?.email || "" } : null,
  },
  budgetPlanId: {
    path: (c) => `/api/companies/${c}/budget-plans`,
    toOption: (b) =>
      b?.id ? { value: b.id, label: `${b.name ?? ""} ${b.fiscal_year ?? ""}`.trim() } : null,
  },
  costCenterId: {
    path: (c) => `/api/companies/${c}/cost-centers`,
    toOption: (c) =>
      c?.id ? { value: c.id, label: `${c.code ?? ""} ${c.name ?? ""}`.trim() } : null,
  },
  projectId: {
    path: (c) => `/api/companies/${c}/projects?status=all`,
    toOption: (p) =>
      p?.id ? { value: p.id, label: `${p.code ?? ""} ${p.name ?? ""}`.trim() } : null,
  },
  employeeId: {
    path: (c) => `/api/companies/${c}/employees`,
    toOption: (e) =>
      e?.id
        ? { value: e.id, label: `${e.employee_number ?? ""} ${e.full_name ?? ""}`.trim() }
        : null,
  },
  payrollRunId: {
    path: (c) => `/api/companies/${c}/payroll-runs`,
    toOption: (r) =>
      r?.id ? { value: r.id, label: `${r.period_year}-${pad2(Number(r.period_month))}` } : null,
  },
};

function useOptions(companyId: string | undefined, key: ReportFilterKey) {
  const { locale } = useTranslation();
  const loader = LOADERS[key];
  const path = loader && companyId ? loader.path(companyId) : null;
  const query = useQuery<any[]>({
    // The default query function joins the key into the URL.
    queryKey: path ? [path] : ["report-filter-none", key],
    enabled: Boolean(path),
    staleTime: 5 * 60_000,
  });
  const rows = Array.isArray(query.data) ? query.data : [];
  const options = rows
    .map((row) => loader?.toOption(row, locale) ?? null)
    .filter((o): o is Option => o !== null);
  return { options, isError: query.isError };
}

interface FieldProps {
  filterKey: ReportFilterKey;
  value: string;
  companyId: string | undefined;
  onChange: (value: string) => void;
}

function IdSelect({ filterKey, value, companyId, onChange }: FieldProps) {
  const tr = pageMessages.useT();
  const { options, isError } = useOptions(companyId, filterKey);
  const labels: Partial<Record<ReportFilterKey, [string, string]>> = {
    accountId: [tr("filterAccount"), tr("filterAllAccounts")],
    contactId: [tr("filterContact"), tr("filterAllContacts")],
    bankAccountId: [tr("filterBankAccount"), tr("filterAllBankAccounts")],
    userId: [tr("filterUser"), tr("filterAllUsers")],
    budgetPlanId: [tr("filterBudget"), tr("filterLatestBudget")],
    costCenterId: [tr("filterCostCenter"), tr("filterAllCostCenters")],
    payrollRunId: [tr("filterPayrollRun"), tr("filterAllPayrollRuns")],
    projectId: [tr("filterProject"), tr("filterAllProjects")],
    employeeId: [tr("filterEmployee"), tr("filterAllEmployees")],
  };
  const [label, allLabel] = labels[filterKey] ?? [filterKey, ""];
  return (
    <div className="space-y-1.5 min-w-[11rem]">
      <Label>{label}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger data-testid={`filter-${filterKey}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label || tr("unnamedOption")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isError ? <p className="text-xs text-destructive">{tr("optionsFailed")}</p> : null}
    </div>
  );
}

function TextFilter({ filterKey, value, onChange }: FieldProps) {
  const tr = pageMessages.useT();
  const meta: Partial<Record<ReportFilterKey, [string, string]>> = {
    source: [tr("filterSource"), tr("filterSourcePlaceholder")],
    entityType: [tr("filterEntityType"), tr("filterEntityTypePlaceholder")],
    action: [tr("filterAction"), tr("filterActionPlaceholder")],
  };
  const [label, placeholder] = meta[filterKey] ?? [filterKey, ""];
  const listId = filterKey === "source" ? "report-filter-sources" : undefined;
  return (
    <div className="space-y-1.5 min-w-[11rem]">
      <Label>{label}</Label>
      <Input
        value={value}
        placeholder={placeholder}
        maxLength={100}
        list={listId}
        onChange={(e) => onChange(e.target.value.trim())}
        data-testid={`filter-${filterKey}`}
      />
      {listId ? (
        <datalist id={listId}>
          {KNOWN_SOURCES.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

function TaxYearFilter({ value, onChange }: FieldProps) {
  const tr = pageMessages.useT();
  const thisYear = new Date().getFullYear();
  const earlier = Array.from({ length: 6 }, (_, i) => String(thisYear - 1 - i));
  return (
    <div className="space-y-1.5 min-w-[9rem]">
      <Label>{tr("filterTaxYear")}</Label>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
        <SelectTrigger data-testid="filter-taxYear">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{String(thisYear)}</SelectItem>
          {earlier.map((y) => (
            <SelectItem key={y} value={y}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The filter control a report declares (companyIds and statement have their own picker). */
export function ReportFilterField(props: FieldProps) {
  switch (props.filterKey) {
    case "source":
    case "entityType":
    case "action":
      return <TextFilter {...props} />;
    case "taxYear":
      return <TaxYearFilter {...props} />;
    case "companyIds":
    case "statement":
      return null;
    default:
      return <IdSelect {...props} />;
  }
}
