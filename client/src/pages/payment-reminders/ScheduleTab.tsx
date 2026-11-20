import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatMessage, translateNow, useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AutomaticEmailRules } from "../Reminders";
import { MessageWithChips, TokenEditor, type TokenField } from "./TokenEditor";
import { splitMessage } from "./tokens";
import {
  CHASE_FIELDS,
  REMINDER_LEVELS,
  type ChaseConfig,
  type ReminderLevel,
  type ReminderTemplate,
} from "./types";

type Lang = "en" | "ar";

/** English / العربية segmented switch. */
function LanguageSwitch({ value, onChange }: { value: Lang; onChange: (lang: Lang) => void }) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  return (
    <div
      role="radiogroup"
      className="inline-flex rounded-md border border-border bg-surface-sunken p-0.5"
    >
      {(["en", "ar"] as Lang[]).map((lang) => (
        <button
          key={lang}
          type="button"
          role="radio"
          aria-checked={value === lang}
          onClick={() => onChange(lang)}
          className={cn(
            "min-h-8 rounded px-3 text-caption font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            value === lang
              ? "bg-card text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {lang === "ar" ? tt["invoices.reminders.langAr"] : tt["invoices.reminders.langEn"]}
        </button>
      ))}
    </div>
  );
}

export function ScheduleTab({ companyId }: { companyId?: string }) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const { toast } = useToast();
  const [editing, setEditing] = useState<ReminderTemplate | null>(null);

  const configQuery = useQuery<ChaseConfig>({
    queryKey: ["/api/chasing/config", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/config/${companyId}`),
    enabled: !!companyId,
  });
  const templatesQuery = useQuery<ReminderTemplate[]>({
    queryKey: ["/api/chasing/templates", companyId],
    queryFn: () => apiRequest("GET", `/api/chasing/templates/${companyId}`),
    enabled: !!companyId,
  });

  const saveConfig = useMutation({
    mutationFn: (patch: Partial<ChaseConfig>) =>
      apiRequest("PATCH", `/api/chasing/config/${companyId}`, patch),
    onSuccess: () => {
      toast({ title: t["hr.settingsSaved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/config", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/queue", companyId] });
    },
  });

  const saveTemplate = useMutation({
    mutationFn: (tpl: ReminderTemplate) => {
      const body = {
        level: tpl.level,
        language: tpl.language,
        subject: tpl.subject,
        body: tpl.body,
      };
      // Company wording is updated in place; the standard wording is copied into a company override.
      return tpl.companyId === companyId
        ? apiRequest("PATCH", `/api/chasing/templates/${companyId}/${tpl.id}`, body)
        : apiRequest("POST", `/api/chasing/templates/${companyId}`, body);
    },
    onSuccess: () => {
      toast({ title: t["pages.chasingTemplateSaved"] });
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["/api/chasing/templates", companyId] });
    },
    onError: (e: Error) =>
      toast({
        title: translateNow("toasts.couldNotSaveTemplate"),
        description: e?.message,
        variant: "destructive",
      }),
  });

  const fields: TokenField[] = useMemo(
    () => CHASE_FIELDS.map((key) => ({ key, label: tt[`invoices.reminders.field.${key}`] })),
    [tt]
  );

  const config = configQuery.data;
  const frequency = config?.chaseFrequencyDays ?? 7;
  const maxLevel = config?.maxLevel ?? 4;
  const defaultLang: Lang = config?.defaultLanguage === "ar" ? "ar" : "en";

  /** Company wording first, then the standard wording, for one step and language. */
  const templateFor = (level: number, lang: Lang) => {
    const list = (templatesQuery.data ?? []).filter(
      (tpl) => tpl.level === level && tpl.language === lang
    );
    return list.find((tpl) => tpl.companyId === companyId) ?? list[0] ?? null;
  };

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>{tt["invoices.reminders.howTitle"]}</CardTitle>
          <CardDescription>
            {formatMessage(tt["invoices.reminders.howBody"], { days: frequency })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {configQuery.isLoading ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Label htmlFor="switch-auto-chase">{tt["invoices.reminders.autoLabel"]}</Label>
                  <p className="text-small text-muted-foreground">
                    {tt["invoices.reminders.autoHint"]}
                  </p>
                </div>
                <Switch
                  id="switch-auto-chase"
                  checked={config?.autoChaseEnabled ?? false}
                  onCheckedChange={(v) => saveConfig.mutate({ autoChaseEnabled: v })}
                  data-testid="switch-auto-chase"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="input-frequency">{tt["invoices.reminders.frequencyLabel"]}</Label>
                  <Input
                    id="input-frequency"
                    key={`freq-${frequency}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={365}
                    defaultValue={frequency}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      // The server accepts 1..365; say so here instead of returning a 400.
                      if (!Number.isFinite(n) || n < 1 || n > 365) {
                        toast({
                          title: translateNow("toasts.invalidFrequency"),
                          description: translateNow("toasts.pickAValueBetween1And365"),
                          variant: "destructive",
                        });
                        e.target.value = String(frequency);
                        return;
                      }
                      if (n !== frequency) saveConfig.mutate({ chaseFrequencyDays: n });
                    }}
                    data-testid="input-frequency"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{tt["invoices.reminders.lastStepLabel"]}</Label>
                  <Select
                    value={String(maxLevel)}
                    onValueChange={(v) => saveConfig.mutate({ maxLevel: Number(v) })}
                  >
                    <SelectTrigger data-testid="select-max-level">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REMINDER_LEVELS.map((l) => (
                        <SelectItem key={l} value={String(l)}>
                          {tt[`invoices.reminders.level.${l}`]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{tt["invoices.reminders.languageLabel"]}</Label>
                  <div>
                    <LanguageSwitch
                      value={defaultLang}
                      onChange={(lang) => saveConfig.mutate({ defaultLanguage: lang })}
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="reminder-steps-title" className="space-y-4">
        <h2 id="reminder-steps-title" className="text-h2 text-foreground">
          {tt["invoices.reminders.stepsTitle"]}
        </h2>
        {templatesQuery.isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <ol className="relative space-y-4">
            {REMINDER_LEVELS.map((level, i) => (
              <ReminderStep
                key={level}
                level={level}
                last={i === REMINDER_LEVELS.length - 1}
                active={level <= maxLevel}
                defaultLang={defaultLang}
                templateFor={templateFor}
                companyId={companyId}
                fields={fields}
                onEdit={setEditing}
              />
            ))}
          </ol>
        )}
      </section>

      <AutomaticEmailRules companyId={companyId} />

      <TemplateEditorDialog
        template={editing}
        fields={fields}
        saving={saveTemplate.isPending}
        onChange={setEditing}
        onClose={() => setEditing(null)}
        onSave={(tpl) => saveTemplate.mutate(tpl)}
      />
    </div>
  );
}

function ReminderStep({
  level,
  last,
  active,
  defaultLang,
  templateFor,
  companyId,
  fields,
  onEdit,
}: {
  level: ReminderLevel;
  last: boolean;
  active: boolean;
  defaultLang: Lang;
  templateFor: (level: number, lang: Lang) => ReminderTemplate | null;
  companyId?: string;
  fields: TokenField[];
  onEdit: (tpl: ReminderTemplate) => void;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const [lang, setLang] = useState<Lang>(defaultLang);
  const tpl = templateFor(level, lang);
  const custom = tpl?.companyId === companyId;
  return (
    <li className="relative ps-10" data-testid={`template-row-${level}-${lang}`}>
      {/* Timeline rail and step marker. */}
      {!last && (
        <span
          className="absolute bottom-[-1rem] start-[0.9375rem] top-8 w-px bg-border"
          aria-hidden
        />
      )}
      <span
        className={cn(
          "absolute start-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border text-small font-semibold tabular-nums",
          active
            ? "border-primary bg-card text-primary"
            : "border-border bg-surface-sunken text-muted-foreground"
        )}
        aria-hidden
      >
        {level}
      </span>
      <Card className={cn(!active && "opacity-70")}>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-h3 text-foreground">{tt[`invoices.reminders.level.${level}`]}</h3>
              <p className="text-small text-muted-foreground">
                {active
                  ? tt[`invoices.reminders.stepTiming.${level}`]
                  : tt["invoices.reminders.stepOff"]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitch value={lang} onChange={setLang} />
              {tpl && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit({ ...tpl })}
                  data-testid={`button-edit-template-${level}-${lang}`}
                >
                  <Pencil aria-hidden />
                  {tt["invoices.reminders.editMessage"]}
                </Button>
              )}
            </div>
          </div>
          {tpl ? (
            <div className="rounded-lg border border-border bg-surface-sunken p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge tone={custom ? "accent" : "neutral"}>
                  {custom
                    ? tt["invoices.reminders.customMessage"]
                    : tt["invoices.reminders.defaultMessage"]}
                </StatusBadge>
                {tpl.subject && (
                  <MessageWithChips
                    value={tpl.subject}
                    syntax="single"
                    fields={fields}
                    className="font-medium text-foreground"
                    dir={lang === "ar" ? "rtl" : "ltr"}
                    lang={lang}
                  />
                )}
              </div>
              <MessageWithChips
                value={tpl.body}
                syntax="single"
                fields={fields}
                className="line-clamp-4 text-muted-foreground"
                dir={lang === "ar" ? "rtl" : "ltr"}
                lang={lang}
              />
            </div>
          ) : (
            <p className="text-small text-muted-foreground">{tt["invoices.reminders.noMessage"]}</p>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

function TemplateEditorDialog({
  template,
  fields,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  template: ReminderTemplate | null;
  fields: TokenField[];
  saving: boolean;
  onChange: (tpl: ReminderTemplate) => void;
  onClose: () => void;
  onSave: (tpl: ReminderTemplate) => void;
}) {
  const { t } = useTranslation();
  const tt = t as Record<string, string>;
  const known = new Set(fields.map((f) => f.key));
  const unknown = template
    ? splitMessage(template.body, "single").some((p) => p.kind === "token" && !known.has(p.key))
    : false;
  const dir = template?.language === "ar" ? "rtl" : "ltr";
  return (
    <Dialog open={!!template} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            {template &&
              formatMessage(tt["invoices.reminders.editTitle"], {
                step: tt[`invoices.reminders.level.${template.level}`],
                language:
                  template.language === "ar"
                    ? tt["invoices.reminders.langAr"]
                    : tt["invoices.reminders.langEn"],
              })}
          </DialogTitle>
          <DialogDescription>
            {template?.companyId
              ? tt["invoices.reminders.editDescCustom"]
              : tt["invoices.reminders.editDescDefault"]}
          </DialogDescription>
        </DialogHeader>
        {template && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label id="tpl-subject-label">{tt["invoices.reminders.subjectLabel"]}</Label>
              <TokenEditor
                value={template.subject ?? ""}
                onChange={(subject) => onChange({ ...template, subject })}
                syntax="single"
                fields={fields}
                multiline={false}
                insertLabel={tt["invoices.reminders.insertField"]}
                dir={dir}
                aria-labelledby="tpl-subject-label"
                testId="input-template-subject"
              />
            </div>
            <div className="space-y-1.5">
              <Label id="tpl-body-label">{tt["invoices.reminders.bodyLabel"]}</Label>
              <TokenEditor
                value={template.body}
                onChange={(body) => onChange({ ...template, body })}
                syntax="single"
                fields={fields}
                insertLabel={tt["invoices.reminders.insertField"]}
                dir={dir}
                aria-labelledby="tpl-body-label"
                testId="textarea-template-body"
              />
              {unknown && (
                <p className="text-small text-danger" data-testid="alert-unknown-placeholders">
                  {tt["invoices.reminders.unknownFields"]}
                </p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tt["invoices.reminders.cancel"]}
          </Button>
          <Button
            onClick={() => template && onSave(template)}
            disabled={saving || !template?.body?.trim()}
            data-testid="button-save-template"
          >
            {saving ? tt["invoices.reminders.saving"] : tt["invoices.reminders.save"]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
