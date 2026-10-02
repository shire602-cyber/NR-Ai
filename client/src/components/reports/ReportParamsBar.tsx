import type { ReportParamKind } from "@shared/report-result";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  dubaiToday,
  AS_OF_PRESETS,
  RANGE_PRESETS,
  type AsOfPreset,
  type RangePreset,
} from "@/lib/report-presets";
import { reportUiRule } from "@/lib/report-ui-rules";
import {
  comparisonChoices,
  withAsOfPreset,
  withRangePreset,
  type ReportViewState,
  type ViewComparison,
} from "@/lib/reportRunApi";
import { ReportFilterField } from "./ReportFilterFields";
import { messages as pageMessages } from "./ReportParamsBar.i18n";

const CUSTOM = "custom";

interface Props {
  reportId: string;
  kinds: readonly ReportParamKind[];
  state: ReportViewState;
  onChange: (next: ReportViewState) => void;
  companyId: string | undefined;
  fiscalStartMonth: number;
  /** Consolidation shows the range for a P&L and the as-of day for a balance sheet. */
  showRange?: boolean;
  showAsOf?: boolean;
}

export function ReportParamsBar({
  reportId,
  kinds,
  state,
  onChange,
  companyId,
  fiscalStartMonth,
  showRange,
  showAsOf,
}: Props) {
  const tr = pageMessages.useT();
  const rule = reportUiRule(reportId);
  const defaults = { fiscalStartMonth };
  const wantRange = (showRange ?? true) && kinds.includes("range");
  const wantAsOf = (showAsOf ?? true) && kinds.includes("asOf");
  const choices = comparisonChoices(reportId, kinds);
  const today = dubaiToday();
  const rangeInvalid = wantRange && state.from > state.to;
  const asOfInFuture = wantAsOf && rule.noFutureAsOf === true && state.asOf > today;
  const filterKeys = rule.filters.filter((k) => k !== "companyIds" && k !== "statement");

  const rangeLabel: Record<RangePreset, string> = {
    thisMonth: tr("thisMonth"),
    lastMonth: tr("lastMonth"),
    thisQuarter: tr("thisQuarter"),
    lastQuarter: tr("lastQuarter"),
    thisYear: tr("thisYear"),
    lastYear: tr("lastYear"),
    last30Days: tr("last30Days"),
    last90Days: tr("last90Days"),
  };
  const asOfLabel: Record<AsOfPreset, string> = {
    today: tr("today"),
    lastMonthEnd: tr("lastMonthEnd"),
    lastQuarterEnd: tr("lastQuarterEnd"),
    lastYearEnd: tr("lastYearEnd"),
  };
  const compareLabel: Record<ViewComparison, string> = {
    none: tr("compareNone"),
    priorPeriod: tr("comparePriorPeriod"),
    priorYear: tr("comparePriorYear"),
    custom: tr("compareCustom"),
  };

  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="report-params-bar">
      {wantRange ? (
        <>
          <div className="space-y-1.5 min-w-[11rem]">
            <Label>{tr("period")}</Label>
            <Select
              value={state.rangePreset}
              onValueChange={(v) =>
                onChange(
                  v === CUSTOM
                    ? { ...state, rangePreset: CUSTOM }
                    : withRangePreset(state, v as RangePreset, defaults)
                )
              }
            >
              <SelectTrigger data-testid="select-range-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_PRESETS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {rangeLabel[p]}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>{tr("customRange")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-from">{tr("from")}</Label>
            <Input
              id="report-from"
              type="date"
              value={state.from}
              max={state.to || undefined}
              onChange={(e) => onChange({ ...state, rangePreset: CUSTOM, from: e.target.value })}
              data-testid="input-from"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-to">{tr("to")}</Label>
            <Input
              id="report-to"
              type="date"
              value={state.to}
              min={state.from || undefined}
              onChange={(e) => onChange({ ...state, rangePreset: CUSTOM, to: e.target.value })}
              data-testid="input-to"
            />
          </div>
        </>
      ) : null}

      {wantAsOf ? (
        <>
          <div className="space-y-1.5 min-w-[11rem]">
            <Label>{tr("asOfDay")}</Label>
            <Select
              value={state.asOfPreset}
              onValueChange={(v) =>
                onChange(
                  v === CUSTOM
                    ? { ...state, asOfPreset: CUSTOM }
                    : withAsOfPreset(state, v as AsOfPreset, defaults)
                )
              }
            >
              <SelectTrigger data-testid="select-asof-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AS_OF_PRESETS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {asOfLabel[p]}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>{tr("customDay")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-asof">{tr("asOfDate")}</Label>
            <Input
              id="report-asof"
              type="date"
              value={state.asOf}
              max={rule.noFutureAsOf ? today : undefined}
              onChange={(e) => onChange({ ...state, asOfPreset: CUSTOM, asOf: e.target.value })}
              data-testid="input-asof"
            />
          </div>
        </>
      ) : null}

      {choices.length > 0 ? (
        <div className="space-y-1.5 min-w-[12rem]">
          <Label>{tr("comparison")}</Label>
          <Select
            value={state.compare}
            onValueChange={(v) => onChange({ ...state, compare: v as ViewComparison })}
          >
            <SelectTrigger data-testid="select-compare">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {choices.map((c) => (
                <SelectItem key={c} value={c}>
                  {compareLabel[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {choices.length > 0 && state.compare === "custom" && kinds.includes("range") ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="report-cmp-from">{tr("compareFrom")}</Label>
            <Input
              id="report-cmp-from"
              type="date"
              value={state.compareFrom}
              onChange={(e) => onChange({ ...state, compareFrom: e.target.value })}
              data-testid="input-compare-from"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-cmp-to">{tr("compareTo")}</Label>
            <Input
              id="report-cmp-to"
              type="date"
              value={state.compareTo}
              onChange={(e) => onChange({ ...state, compareTo: e.target.value })}
              data-testid="input-compare-to"
            />
          </div>
        </>
      ) : null}
      {choices.length > 0 && state.compare === "custom" && !kinds.includes("range") ? (
        <div className="space-y-1.5">
          <Label htmlFor="report-cmp-asof">{tr("compareAsOf")}</Label>
          <Input
            id="report-cmp-asof"
            type="date"
            value={state.compareAsOf}
            onChange={(e) => onChange({ ...state, compareAsOf: e.target.value })}
            data-testid="input-compare-asof"
          />
        </div>
      ) : null}

      {filterKeys.map((key) => (
        <ReportFilterField
          key={key}
          filterKey={key}
          companyId={companyId}
          value={state.filters[key] ?? ""}
          onChange={(value) => onChange({ ...state, filters: { ...state.filters, [key]: value } })}
        />
      ))}

      {rangeInvalid ? (
        <p
          role="alert"
          className="basis-full text-sm text-destructive"
          data-testid="params-range-error"
        >
          {tr("invalidRange")}
        </p>
      ) : null}
      {asOfInFuture ? (
        <p
          role="alert"
          className="basis-full text-sm text-destructive"
          data-testid="params-asof-error"
        >
          {tr("futureAsOf")}
        </p>
      ) : null}
    </div>
  );
}

/** True while the choices would be refused by the server (the viewer does not send them). */
export function paramsAreValid(
  reportId: string,
  kinds: readonly ReportParamKind[],
  state: ReportViewState,
  showRange = true,
  showAsOf = true
): boolean {
  const rule = reportUiRule(reportId);
  if (showRange && kinds.includes("range") && state.from > state.to) return false;
  if (showAsOf && kinds.includes("asOf") && rule.noFutureAsOf && state.asOf > dubaiToday())
    return false;
  return true;
}
