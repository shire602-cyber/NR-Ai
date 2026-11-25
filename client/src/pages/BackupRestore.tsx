import { T } from "@/components/layout/T";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { PageHeader } from "@/components/ui/page-header";
import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Database,
  Download,
  Upload,
  Plus,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileJson,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useCompanyPermission } from "@/hooks/useCompanyPermission";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import type { Backup } from "@shared/schema";
import { formatMessage, useI18n, useTranslation, translateNow } from "@/lib/i18n";

type BackupWithoutData = Omit<Backup, "dataSnapshot">;

interface TableDiff {
  table: string;
  snapshotRows: number;
  currentRows: number;
  insert: number;
  update: number;
  delete: number;
}
interface RestorePreview {
  backup: { id: string; name: string; createdAt: string };
  mode: "merge" | "replace";
  tables: TableDiff[];
  totals: { insert: number; update: number; delete: number };
  warning: string;
}
interface BackupSchedule {
  frequency: "daily" | "weekly" | "monthly" | "off";
  retentionDays: number;
  isActive: boolean;
  lastRunAt: string | null;
}

// W5-B (R19-06, R19-07, R17-22): wording matches what the server does.
const BACKUP_COPY = {
  en: {
    restoreTitle: "Restore from backup",
    restoreDescription: "Choose how to restore, review the dry-run changes, then confirm.",
    modeMerge: "Merge: add missing records only",
    modeMergeHelp:
      "Records that were deleted are added back. Edited records keep their current values; nothing is deleted.",
    modeReplace: "Replace: make company data match the backup",
    modeReplaceHelp:
      "Records created after the backup are deleted and edited records are reverted. A pre-restore backup is taken first.",
    table: "Table",
    insert: "Add",
    update: "Revert",
    del: "Delete",
    noChanges: "Nothing would change.",
    confirmName: "Type the backup name to confirm",
    restore: "Restore",
    restoring: "Restoring...",
    preview: "Preview changes",
    restoreDone: "Restore complete",
    restoreFailed: "Restore failed",
    aboutTitle: "About backups",
    about1:
      "A backup is an encrypted snapshot of every company table: ledger, invoices, bills, payments, contacts, products, bank, payroll, fixed assets, budgets, claims and VAT.",
    about2:
      "Audit logs, team access, API keys, billing and the email queue are never captured or overwritten by a restore.",
    about3:
      "Snapshots are checksummed and verified before a restore; a restore either completes in one transaction or changes nothing.",
    about4:
      "Point-in-time recovery and an off-site copy are set up on the database host and storage bucket (outside the app).",
    scheduleTitle: "Scheduled backups",
    scheduleHelp: "Runs nightly when due and keeps scheduled backups for the retention period.",
    frequency: { off: "Off", daily: "Daily", weekly: "Weekly", monthly: "Monthly" } as Record<
      string,
      string
    >,
    retention: "Keep for (days)",
    save: "Save schedule",
    saved: "Schedule saved",
    lastRun: "Last run",
  },
  ar: {
    restoreTitle: "الاستعادة من نسخة احتياطية",
    restoreDescription: "اختر طريقة الاستعادة وراجع التغييرات التجريبية ثم أكد.",
    modeMerge: "دمج: إضافة السجلات المفقودة فقط",
    modeMergeHelp: "تُعاد السجلات المحذوفة. تحتفظ السجلات المعدلة بقيمها الحالية ولا يُحذف شيء.",
    modeReplace: "استبدال: مطابقة بيانات الشركة للنسخة الاحتياطية",
    modeReplaceHelp:
      "تُحذف السجلات المنشأة بعد النسخة وتُعاد السجلات المعدلة. تُؤخذ نسخة قبل الاستعادة أولاً.",
    table: "الجدول",
    insert: "إضافة",
    update: "استرجاع",
    del: "حذف",
    noChanges: "لن يتغير شيء.",
    confirmName: "اكتب اسم النسخة الاحتياطية للتأكيد",
    restore: "استعادة",
    restoring: "جارٍ الاستعادة...",
    preview: "معاينة التغييرات",
    restoreDone: "اكتملت الاستعادة",
    restoreFailed: "فشلت الاستعادة",
    aboutTitle: "حول النسخ الاحتياطية",
    about1:
      "النسخة الاحتياطية لقطة مشفرة لكل جداول الشركة: الدفاتر والفواتير والمدفوعات وجهات الاتصال والمنتجات والبنوك والرواتب والأصول والميزانيات والمطالبات والضريبة.",
    about2:
      "لا تُنسخ سجلات التدقيق وصلاحيات الفريق ومفاتيح API والفوترة وقائمة البريد ولا تُستبدل عند الاستعادة.",
    about3:
      "يتم التحقق من بصمة كل لقطة قبل الاستعادة؛ إما أن تكتمل الاستعادة في معاملة واحدة أو لا يتغير شيء.",
    about4:
      "الاستعادة لنقطة زمنية والنسخة خارج الموقع تُعدّان لدى مزود قاعدة البيانات والتخزين (خارج التطبيق).",
    scheduleTitle: "النسخ الاحتياطي المجدول",
    scheduleHelp: "يعمل ليلاً عند الاستحقاق ويحتفظ بالنسخ المجدولة طوال مدة الاحتفاظ.",
    frequency: { off: "إيقاف", daily: "يومي", weekly: "أسبوعي", monthly: "شهري" } as Record<
      string,
      string
    >,
    retention: "مدة الاحتفاظ (أيام)",
    save: "حفظ الجدولة",
    saved: "تم حفظ الجدولة",
    lastRun: "آخر تشغيل",
  },
};

export default function BackupRestore() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const { can, known: accessKnown } = useCompanyPermission();
  const canManageBackups = can("backups.manage");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newBackupName, setNewBackupName] = useState("");
  const [newBackupDescription, setNewBackupDescription] = useState("");
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [confirmName, setConfirmName] = useState("");
  const { locale } = useI18n();
  const c = BACKUP_COPY[locale === "ar" ? "ar" : "en"];
  const defaultBackupName = formatMessage(t["pageLabels.defaultBackupName"], {
    date: formatDate(new Date(), locale),
  });
  const [selectedBackupForRestore, setSelectedBackupForRestore] =
    useState<BackupWithoutData | null>(null);

  const {
    data: backups = [],
    isLoading,
    isError: backupsFailed,
    refetch: refetchBackups,
  } = useQuery<BackupWithoutData[]>({
    queryKey: ["/api/companies", selectedCompanyId, "backups"],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const res = await fetch(apiUrl(`/api/companies/${selectedCompanyId}/backups`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch backups");
      return res.json();
    },
    // A role without backups.manage gets 403: show "no access", never an empty list.
    enabled: !!selectedCompanyId && canManageBackups,
    retry: false,
  });

  const createBackupMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", `/api/companies/${selectedCompanyId}/backups`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "backups"] });
      toast({
        title: translateNow("toasts.backupCreated"),
        description: translateNow("toasts.yourFinancialDataHasBeenBackedUp"),
      });
      setIsCreateDialogOpen(false);
      setNewBackupName("");
      setNewBackupDescription("");
    },
    onError: (error: any) => {
      toast({
        title: translateNow("toasts.backupFailed"),
        description: error?.message || translateNow("toasts.failedToCreateBackup"),
        variant: "destructive",
      });
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/backups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "backups"] });
      toast({
        title: translateNow("toasts.backupDeleted"),
        description: translateNow("toasts.theBackupHasBeenRemoved"),
      });
    },
    onError: (error: any) => {
      toast({
        title: translateNow("toasts.deleteFailed"),
        description: error?.message || translateNow("toasts.failedToDeleteBackup"),
        variant: "destructive",
      });
    },
  });

  const getRestorePreviewMutation = useMutation({
    mutationFn: async (args: { id: string; mode: "merge" | "replace" }) => {
      return apiRequest("POST", `/api/backups/${args.id}/restore-preview`, { mode: args.mode });
    },
    onSuccess: (data: RestorePreview) => {
      setRestorePreview(data);
    },
    onError: (error: Error) => {
      toast({ title: c.restoreFailed, description: error?.message, variant: "destructive" });
    },
  });

  const restoreAttempt = useRef<{ id: string; mode: typeof restoreMode; key: string } | null>(null);
  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      if (restoreAttempt.current?.id !== id || restoreAttempt.current.mode !== restoreMode) {
        restoreAttempt.current = { id, mode: restoreMode, key: crypto.randomUUID() };
      }
      return apiRequest(
        "POST",
        `/api/backups/${id}/restore`,
        {
          mode: restoreMode,
          confirmRestore: true,
          ...(restoreMode === "replace" ? { confirmName } : {}),
        },
        { "Idempotency-Key": restoreAttempt.current.key },
        { queueWhenOffline: false }
      );
    },
    onSuccess: (data: { message?: string }) => {
      restoreAttempt.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "backups"] });
      toast({ title: c.restoreDone, description: data.message });
      setRestorePreview(null);
      setSelectedBackupForRestore(null);
      setConfirmName("");
    },
    onError: (error: Error) => {
      toast({ title: c.restoreFailed, description: error?.message, variant: "destructive" });
    },
  });

  const { data: schedule } = useQuery<BackupSchedule>({
    queryKey: ["/api/companies", selectedCompanyId, "backups", "schedule"],
    enabled: !!selectedCompanyId,
  });
  const [scheduleDraft, setScheduleDraft] = useState<{
    frequency: string;
    retentionDays: number;
  } | null>(null);
  const scheduleMutation = useMutation({
    mutationFn: async (body: { frequency: string; retentionDays: number }) =>
      apiRequest("PUT", `/api/companies/${selectedCompanyId}/backups/schedule`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", selectedCompanyId, "backups", "schedule"],
      });
      setScheduleDraft(null);
      toast({ title: c.saved });
    },
    onError: (error: Error) =>
      toast({ title: c.restoreFailed, description: error?.message, variant: "destructive" }),
  });
  const effectiveSchedule = scheduleDraft ?? {
    frequency: schedule?.isActive ? schedule.frequency : "off",
    retentionDays: schedule?.retentionDays ?? 90,
  };

  const handleDownload = async (backup: BackupWithoutData) => {
    try {
      const res = await fetch(apiUrl(`/api/backups/${backup.id}/download`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Download failed");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${backup.name.replace(/[^a-z0-9]/gi, "_")}_${backup.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      toast({
        title: translateNow("toasts.downloadStarted"),
        description: translateNow("toasts.yourBackupFileIsDownloading"),
      });
    } catch (error: any) {
      toast({
        title: translateNow("toasts.downloadFailed2"),
        description: error?.message || translateNow("toasts.failedToDownloadBackup"),
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-success/10 text-success border-success/20">
            <CheckCircle className="h-3 w-3 mr-1" />
            <T k="pages.completed" />
          </Badge>
        );
      case "in_progress":
        return (
          <Badge className="bg-info/10 text-info border-info/20">
            <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
            <T k="pages.inProgress" />
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            <T k="pages.failed" />
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getBackupTypeLabel = (type: string) => {
    switch (type) {
      case "manual":
        return "Manual";
      case "scheduled":
        return "Scheduled";
      case "pre_restore":
        return "Pre-Restore";
      default:
        return type;
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">
          <T k="pageLabels.pleaseSelectACompanyToManageBackups" />
        </p>
      </div>
    );
  }

  if (accessKnown && !canManageBackups) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Settings" title={t["backupRestore.backupRestore"]} />
        <EmptyState
          icon={Database}
          title={t["common.noAccessTitle"]}
          description={t["common.noAccessBody"]}
          testId="state-backups-no-access"
        />
      </div>
    );
  }

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Settings"
          title={t["backupRestore.backupRestore"]}
          testId="text-backup-title"
          description={t["backupRestore.safeguardYourFinancialRecordsWith"]}
          actions={
            <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-backup">
              <Plus className="h-4 w-4 mr-2" />
              <T k="pages.createBackup" />
            </Button>
          }
        />
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                <T k="pageLabels.createNewBackup" />
              </DialogTitle>
              <DialogDescription>{c.about1}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="backup-name">
                  <T k="pageLabels.backupName" />
                </Label>
                <Input
                  id="backup-name"
                  placeholder={defaultBackupName}
                  value={newBackupName}
                  onChange={(e) => setNewBackupName(e.target.value)}
                  data-testid="input-backup-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backup-description">
                  <T k="firmOps.docDescriptionOptional" />
                </Label>
                <Textarea
                  id="backup-description"
                  placeholder={t["backupRestore.addNotesAboutThisBackup"]}
                  value={newBackupDescription}
                  onChange={(e) => setNewBackupDescription(e.target.value)}
                  data-testid="input-backup-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                <T k="pages.cancel" />
              </Button>
              <Button
                onClick={() =>
                  createBackupMutation.mutate({
                    name: newBackupName || defaultBackupName,
                    description: newBackupDescription,
                  })
                }
                disabled={createBackupMutation.isPending}
                data-testid="button-confirm-backup"
              >
                {createBackupMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    <T k="pageLabels.creating" />
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    <T k="pages.createBackup" />
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <CardTitle>
              <T k="pageLabels.backupHistory2" />
            </CardTitle>
            <CardDescription>
              <T k="pageLabels.viewAndManageYourFinancialDataBackups" />
            </CardDescription>
            {/* Spec 2.6/2.7 (Fable B9): no tile row; one summary line once a backup exists. */}
            {backups.length > 0 && (
              <p
                className="text-small text-muted-foreground tabular-nums"
                data-testid="backup-summary"
              >
                <span data-testid="text-total-backups">
                  {formatMessage(t["pageLabels.backupCount"], { count: backups.length })}
                </span>
                {" · "}
                <span data-testid="text-storage-used" dir="ltr">
                  {formatBytes(backups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0))}
                </span>
                {backups[0].createdAt && (
                  <>
                    {" · "}
                    <span data-testid="text-last-backup">
                      {formatMessage(t["pageLabels.lastBackupAt"], {
                        date: formatDateTime(backups[0].createdAt, locale),
                      })}
                    </span>
                  </>
                )}
              </p>
            )}
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : backupsFailed ? (
              <ErrorState
                compact
                onRetry={() => void refetchBackups()}
                testId="state-backups-error"
              />
            ) : backups.length === 0 ? (
              <EmptyState
                icon={Database}
                title={t["pageLabels.noBackupsYet"]}
                description={t["pageLabels.createYourFirstBackupToProtectYourFinancialRecords"]}
                action={{
                  label: t["pageLabels.createFirstBackup"],
                  icon: Plus,
                  onClick: () => setIsCreateDialogOpen(true),
                  testId: "button-create-first-backup",
                }}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pageLabels.backupColName" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.backupColType" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.status" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.records" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.backupColSize" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.created" />
                    </TableHead>
                    <TableHead className="text-right">
                      <T k="pages.actions" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {backups.map((backup) => (
                    <TableRow key={backup.id} data-testid={`row-backup-${backup.id}`}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{backup.name}</p>
                          {backup.description && (
                            <p className="text-xs text-muted-foreground">{backup.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{getBackupTypeLabel(backup.backupType)}</Badge>
                      </TableCell>
                      <TableCell>{getStatusBadge(backup.status)}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>
                            {formatMessage(t["pageLabels.backupAccountsCount"], {
                              count: backup.accountsCount || 0,
                            })}
                          </p>
                          <p className="text-muted-foreground">
                            {formatMessage(t["pageLabels.backupInvoicesEntriesCount"], {
                              invoices: backup.invoicesCount || 0,
                              entries: backup.journalEntriesCount || 0,
                            })}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>{formatBytes(backup.sizeBytes || 0)}</TableCell>
                      <TableCell>
                        {backup.createdAt && (
                          <span className="whitespace-nowrap text-sm tabular-nums">
                            {formatDateTime(backup.createdAt, locale)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(backup)}
                            disabled={backup.status !== "completed"}
                            aria-label={t["common.downloadBackup"]}
                            data-testid={`button-download-${backup.id}`}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedBackupForRestore(backup);
                              setRestoreMode("merge");
                              getRestorePreviewMutation.mutate({ id: backup.id, mode: "merge" });
                            }}
                            disabled={backup.status !== "completed"}
                            aria-label={t["common.restoreBackup"]}
                            data-testid={`button-restore-${backup.id}`}
                          >
                            <Upload className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                aria-label={t["common.deleteBackup"]}
                                data-testid={`button-delete-${backup.id}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  <T k="pageLabels.deleteBackup" />
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete "{backup.name}". This action cannot
                                  be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  <T k="pages.cancel" />
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteBackupMutation.mutate(backup.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  <T k="pages.delete" />
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={!!restorePreview}
          onOpenChange={() => {
            setRestorePreview(null);
            setSelectedBackupForRestore(null);
            setConfirmName("");
          }}
        >
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-warning" />
                {c.restoreTitle}
              </DialogTitle>
              <DialogDescription>{c.restoreDescription}</DialogDescription>
            </DialogHeader>
            {restorePreview && (
              <div className="space-y-4 py-2">
                <div className="grid gap-2 md:grid-cols-2">
                  {(["merge", "replace"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      data-testid={`button-restore-mode-${m}`}
                      onClick={() => {
                        setRestoreMode(m);
                        if (selectedBackupForRestore) {
                          getRestorePreviewMutation.mutate({
                            id: selectedBackupForRestore.id,
                            mode: m,
                          });
                        }
                      }}
                      className={`rounded-lg border p-3 text-start text-sm ${
                        restoreMode === m ? "border-primary bg-primary/5" : ""
                      }`}
                    >
                      <p className="font-medium">{m === "merge" ? c.modeMerge : c.modeReplace}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {m === "merge" ? c.modeMergeHelp : c.modeReplaceHelp}
                      </p>
                    </button>
                  ))}
                </div>
                {restorePreview.tables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{c.noChanges}</p>
                ) : (
                  <div className="max-h-64 overflow-auto rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{c.table}</TableHead>
                          <TableHead className="text-end">{c.insert}</TableHead>
                          <TableHead className="text-end">{c.update}</TableHead>
                          <TableHead className="text-end">{c.del}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {restorePreview.tables.map((d) => (
                          <TableRow key={d.table}>
                            <TableCell className="font-mono text-xs" dir="ltr">
                              {d.table}
                            </TableCell>
                            <TableCell className="text-end">{d.insert}</TableCell>
                            <TableCell className="text-end">{d.update}</TableCell>
                            <TableCell className="text-end">{d.delete}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {restoreMode === "replace" && (
                  <div className="space-y-2">
                    <Label htmlFor="confirm-backup-name">{c.confirmName}</Label>
                    <Input
                      id="confirm-backup-name"
                      value={confirmName}
                      placeholder={restorePreview.backup.name}
                      onChange={(e) => setConfirmName(e.target.value)}
                      data-testid="input-confirm-backup-name"
                    />
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setRestorePreview(null);
                  setSelectedBackupForRestore(null);
                  setConfirmName("");
                }}
              >
                <T k="pages.cancel" />
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  selectedBackupForRestore && restoreMutation.mutate(selectedBackupForRestore.id)
                }
                disabled={
                  restoreMutation.isPending ||
                  (restoreMode === "replace" && confirmName !== restorePreview?.backup.name)
                }
                data-testid="button-confirm-restore"
              >
                <Upload className="me-2 h-4 w-4" />
                {restoreMutation.isPending ? c.restoring : c.restore}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {c.scheduleTitle}
            </CardTitle>
            <CardDescription>{c.scheduleHelp}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="flex gap-2">
              {(["off", "daily", "weekly", "monthly"] as const).map((f) => (
                <Button
                  key={f}
                  type="button"
                  size="sm"
                  variant={effectiveSchedule.frequency === f ? "default" : "outline"}
                  aria-pressed={effectiveSchedule.frequency === f}
                  onClick={() => setScheduleDraft({ ...effectiveSchedule, frequency: f })}
                  data-testid={`button-schedule-${f}`}
                >
                  {c.frequency[f]}
                </Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label htmlFor="retention-days">{c.retention}</Label>
              <Input
                id="retention-days"
                type="number"
                min={7}
                max={3650}
                className="w-28"
                value={effectiveSchedule.retentionDays}
                onChange={(e) =>
                  setScheduleDraft({ ...effectiveSchedule, retentionDays: Number(e.target.value) })
                }
              />
            </div>
            <Button
              size="sm"
              disabled={!scheduleDraft || scheduleMutation.isPending}
              onClick={() => scheduleDraft && scheduleMutation.mutate(scheduleDraft)}
            >
              {c.save}
            </Button>
            {schedule?.lastRunAt && (
              <p className="text-xs text-muted-foreground">
                {c.lastRun}: {formatDateTime(schedule.lastRunAt, locale)}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileJson className="h-5 w-5" />
              {c.aboutTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>{c.about1}</p>
            <p>{c.about2}</p>
            <p>{c.about3}</p>
            <p>{c.about4}</p>
          </CardContent>
        </Card>
      </div>
    </SettingsLayout>
  );
}
