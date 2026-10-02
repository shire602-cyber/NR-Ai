import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Archive, ListPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  CUSTOM_FIELD_KEY_PATTERN,
  salesErrorMessage,
  salesKeys,
  suggestFieldKey,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
} from "@/lib/sales-api";
import { messages } from "./SalesShared.i18n";

/** Record kinds a custom field can be added to here (bills are managed on the bills screen). */
const ENTITIES: CustomFieldEntity[] = ["invoice", "quote", "sales_order", "contact"];
const TYPES: CustomFieldType[] = ["text", "number", "date", "select"];

export function CustomFieldsPanel({ companyId }: { companyId: string }) {
  const tr = messages.useT();
  const { toast } = useToast();
  const [entity, setEntity] = useState<CustomFieldEntity>("invoice");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | null>(null);
  const [fieldEntity, setFieldEntity] = useState<CustomFieldEntity>("invoice");
  const [labelEn, setLabelEn] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [showOnPdf, setShowOnPdf] = useState(false);

  const defs = useQuery<CustomFieldDefinition[]>({
    queryKey: [...salesKeys.customFields(companyId, entity), "settings"],
    queryFn: () => apiRequest("GET", `/api/companies/${companyId}/custom-fields?entity=${entity}&includeArchived=true`),
  });

  const entityLabel = (e: CustomFieldEntity) => (e === "invoice" ? tr("entityInvoice") : e === "quote" ? tr("entityQuote") : e === "sales_order" ? tr("entitySalesOrder") : e === "contact" ? tr("entityContact") : tr("entityBill"));
  const typeLabel = (t: CustomFieldType) => (t === "text" ? tr("typeText") : t === "number" ? tr("typeNumber") : t === "date" ? tr("typeDate") : tr("typeSelect"));
  const optionList = options.split("\n").map((o) => o.trim()).filter(Boolean);
  const keyOk = CUSTOM_FIELD_KEY_PATTERN.test(key);
  const canSave = labelEn.trim() && labelAr.trim() && (editing || keyOk) && (fieldType !== "select" || optionList.length > 0);

  const startNew = () => {
    setEditing(null); setFieldEntity(entity); setLabelEn(""); setLabelAr(""); setKey(""); setKeyTouched(false); setFieldType("text"); setOptions(""); setShowOnPdf(false); setOpen(true);
  };
  const startEdit = (d: CustomFieldDefinition) => {
    setEditing(d); setFieldEntity(d.entity); setLabelEn(d.labelEn); setLabelAr(d.labelAr); setKey(d.key); setKeyTouched(true); setFieldType(d.fieldType); setOptions((d.options ?? []).join("\n")); setShowOnPdf(d.showOnPdf); setOpen(true);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "custom-fields"] });
  const fail = (title: string) => (error: unknown) => toast({ variant: "destructive", title, description: salesErrorMessage(error, (k) => tr(k), tr("pleaseTryAgain")) });

  const save = useMutation({
    mutationFn: () =>
      editing
        ? apiRequest("PUT", `/api/companies/${companyId}/custom-fields/${editing.id}`, { labelEn: labelEn.trim(), labelAr: labelAr.trim(), showOnPdf, ...(fieldType === "select" ? { options: optionList } : {}) })
        : apiRequest("POST", `/api/companies/${companyId}/custom-fields`, { entity: fieldEntity, key, labelEn: labelEn.trim(), labelAr: labelAr.trim(), fieldType, showOnPdf, ...(fieldType === "select" ? { options: optionList } : {}) }),
    onSuccess: () => { toast({ title: editing ? tr("fieldUpdated") : tr("fieldCreated") }); setOpen(false); if (!editing) setEntity(fieldEntity); refresh(); },
    onError: fail(tr("fieldSaveFailed")),
  });
  const archive = useMutation({
    mutationFn: (args: { id: string; isArchived: boolean }) => apiRequest("PUT", `/api/companies/${companyId}/custom-fields/${args.id}`, { isArchived: args.isArchived }),
    onSuccess: refresh,
    onError: fail(tr("fieldSaveFailed")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/companies/${companyId}/custom-fields/${id}`) as Promise<{ outcome: "archived" | "deleted" }>,
    onSuccess: (r) => { toast({ title: r.outcome === "archived" ? tr("fieldArchivedToast") : tr("fieldDeleted") }); refresh(); },
    onError: fail(tr("fieldDeleteFailed")),
  });

  return (
    <Card data-testid="custom-fields-panel">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><ListPlus className="h-5 w-5" />{tr("customFields")}</CardTitle>
          <CardDescription>{tr("customFieldsHelp")}</CardDescription>
        </div>
        <Button onClick={startNew} data-testid="button-new-custom-field"><Plus className="me-2 h-4 w-4" />{tr("newField")}</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <Select value={entity} onValueChange={(v) => setEntity(v as CustomFieldEntity)}>
          <SelectTrigger className="w-56" aria-label={tr("fieldsFor")} data-testid="select-field-entity"><SelectValue /></SelectTrigger>
          <SelectContent>{ENTITIES.map((e) => <SelectItem key={e} value={e}>{entityLabel(e)}</SelectItem>)}</SelectContent>
        </Select>
        {(defs.data ?? []).length === 0 ? (
          <EmptyState compact icon={ListPlus} title={tr("noFields")} description={tr("noFieldsBody")} testId="empty-custom-fields" />
        ) : (
          <ul className="space-y-2">
            {defs.data!.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2" data-testid={`custom-field-${d.key}`}>
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{d.labelEn}</span>
                    <span className="font-medium" dir="rtl">{d.labelAr}</span>
                    <StatusBadge tone="neutral">{typeLabel(d.fieldType)}</StatusBadge>
                    {d.showOnPdf && <StatusBadge tone="info">{tr("onPdf")}</StatusBadge>}
                    {d.isArchived && <StatusBadge tone="warning">{tr("fieldArchived")}</StatusBadge>}
                  </div>
                  <p className="font-mono text-xs text-muted-foreground" dir="ltr">{d.key}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(d)} aria-label={tr("editField", { name: d.labelEn })}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => archive.mutate({ id: d.id, isArchived: !d.isArchived })} aria-label={d.isArchived ? tr("restoreField", { name: d.labelEn }) : tr("archiveField", { name: d.labelEn })}><Archive className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => window.confirm(tr("deleteFieldConfirm", { name: d.labelEn })) && remove.mutate(d.id)} aria-label={tr("deleteField", { name: d.labelEn })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="custom-field-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? tr("editField", { name: editing.labelEn }) : tr("newField")}</DialogTitle>
            <DialogDescription>{tr("fieldDialogHelp")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editing && (
              <div className="space-y-1.5">
                <Label>{tr("fieldAppliesTo")}</Label>
                <Select value={fieldEntity} onValueChange={(v) => setFieldEntity(v as CustomFieldEntity)}>
                  <SelectTrigger data-testid="select-new-field-entity"><SelectValue /></SelectTrigger>
                  <SelectContent>{ENTITIES.map((e) => <SelectItem key={e} value={e}>{entityLabel(e)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="field-label-en">{tr("labelEnglish")}</Label>
                <Input id="field-label-en" dir="ltr" value={labelEn} onChange={(e) => { setLabelEn(e.target.value); if (!keyTouched && !editing) setKey(suggestFieldKey(e.target.value)); }} data-testid="input-field-label-en" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="field-label-ar">{tr("labelArabic")}</Label>
                <Input id="field-label-ar" dir="rtl" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} data-testid="input-field-label-ar" />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="field-key">{tr("fieldKey")}</Label>
                <Input id="field-key" dir="ltr" className="font-mono" disabled={!!editing} value={key} onChange={(e) => { setKey(e.target.value); setKeyTouched(true); }} aria-invalid={!editing && key !== "" && !keyOk} data-testid="input-field-key" />
                <p className="text-xs text-muted-foreground">{tr("fieldKeyHelp")}</p>
              </div>
              <div className="space-y-1.5">
                <Label>{tr("fieldType")}</Label>
                <Select value={fieldType} onValueChange={(v) => setFieldType(v as CustomFieldType)} disabled={!!editing}>
                  <SelectTrigger data-testid="select-field-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {fieldType === "select" && (
              <div className="space-y-1.5">
                <Label htmlFor="field-options">{tr("fieldOptions")}</Label>
                <Textarea id="field-options" rows={4} value={options} onChange={(e) => setOptions(e.target.value)} data-testid="input-field-options" />
                <p className="text-xs text-muted-foreground">{tr("fieldOptionsHelp")}</p>
              </div>
            )}
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="field-pdf">{tr("showOnPdf")}</Label>
                <p className="text-xs text-muted-foreground">{tr("showOnPdfHelp")}</p>
              </div>
              <Switch id="field-pdf" checked={showOnPdf} onCheckedChange={setShowOnPdf} data-testid="switch-field-pdf" />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>{tr("cancel")}</Button>
              <Button className="flex-1" disabled={!canSave || save.isPending} onClick={() => save.mutate()} data-testid="button-save-custom-field">{save.isPending ? tr("saving") : tr("save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
