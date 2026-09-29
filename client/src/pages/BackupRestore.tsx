import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
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
  HardDrive,
  FileJson,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
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
  DialogTrigger,
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
import { format } from "date-fns";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import type { Backup } from "@shared/schema";
import { messages as pageMessages } from "./BackupRestore.i18n";

type BackupWithoutData = Omit<Backup, "dataSnapshot">;

export default function BackupRestore() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newBackupName, setNewBackupName] = useState("");
  const [newBackupDescription, setNewBackupDescription] = useState("");
  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [selectedBackupForRestore, setSelectedBackupForRestore] =
    useState<BackupWithoutData | null>(null);

  const { data: backups = [], isLoading } = useQuery<BackupWithoutData[]>({
    queryKey: ["/api/companies", selectedCompanyId, "backups"],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const res = await fetch(apiUrl(`/api/companies/${selectedCompanyId}/backups`), {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch backups");
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const createBackupMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      return apiRequest("POST", `/api/companies/${selectedCompanyId}/backups`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "backups"] });
      toast({
        title: tr("backupCreated"),
        description: tr("yourFinancialDataHasBeenBacked"),
      });
      setIsCreateDialogOpen(false);
      setNewBackupName("");
      setNewBackupDescription("");
    },
    onError: (error: any) => {
      toast({
        title: tr("backupFailed"),
        description: error?.message || tr("failedToCreateBackup"),
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
        title: tr("backupDeleted"),
        description: tr("theBackupHasBeenRemoved"),
      });
    },
    onError: (error: any) => {
      toast({
        title: tr("deleteFailed"),
        description: error?.message || tr("failedToDeleteBackup"),
        variant: "destructive",
      });
    },
  });

  const getRestorePreviewMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/backups/${id}/restore-preview`);
    },
    onSuccess: (data) => {
      setRestorePreview(data);
    },
    onError: (error: any) => {
      toast({
        title: tr("previewFailed"),
        description: error?.message || tr("failedToGetRestorePreview"),
        variant: "destructive",
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `/api/backups/${id}/restore`, { confirmRestore: true });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", selectedCompanyId, "backups"] });
      toast({
        title: tr("restoreInitiated"),
        description: data.message || tr("backupRestoreProcessHasStarted"),
      });
      setRestorePreview(null);
      setSelectedBackupForRestore(null);
    },
    onError: (error: any) => {
      toast({
        title: tr("restoreFailed"),
        description: error?.message || tr("failedToRestoreBackup"),
        variant: "destructive",
      });
    },
  });

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
        title: tr("downloadStarted"),
        description: tr("yourBackupFileIsDownloading"),
      });
    } catch (error: any) {
      toast({
        title: tr("downloadFailed"),
        description: error?.message || tr("failedToDownloadBackup"),
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-success/10 text-success border-success/20">
            <CheckCircle className="h-3 w-3 me-1" />
            {tr("completed")}
          </Badge>
        );
      case "in_progress":
        return (
          <Badge className="bg-info/10 text-info border-info/20">
            <RefreshCw className="h-3 w-3 me-1 animate-spin" />
            {tr("inProgress")}
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 me-1" />
            {tr("failed")}
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getBackupTypeLabel = (type: string) => {
    switch (type) {
      case "manual":
        return tr("manual");
      case "scheduled":
        return tr("scheduled");
      case "pre_restore":
        return tr("preRestore");
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
        <p className="text-muted-foreground">{tr("pleaseSelectACompanyToManage")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("settings")}
        title={tr("backupRestore")}
        testId="text-backup-title"
        description={tr("safeguardYourFinancialRecordsWithAutomated")}
        actions={
          <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-backup">
            <Plus className="h-4 w-4 me-2" />
            {tr("createBackup")}
          </Button>
        }
      />
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("createNewBackup")}</DialogTitle>
            <DialogDescription>{tr("createACompleteBackupOfYour")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="backup-name">{tr("backupName")}</Label>
              <Input
                id="backup-name"
                placeholder={tr("backup", { toLocaleDateString: new Date().toLocaleDateString() })}
                value={newBackupName}
                onChange={(e) => setNewBackupName(e.target.value)}
                data-testid="input-backup-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-description">{tr("descriptionOptional")}</Label>
              <Textarea
                id="backup-description"
                placeholder={tr("addNotesAboutThisBackup")}
                value={newBackupDescription}
                onChange={(e) => setNewBackupDescription(e.target.value)}
                data-testid="input-backup-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() =>
                createBackupMutation.mutate({
                  name: newBackupName || `Backup ${new Date().toLocaleDateString()}`,
                  description: newBackupDescription,
                })
              }
              disabled={createBackupMutation.isPending}
              data-testid="button-confirm-backup"
            >
              {createBackupMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 me-2 animate-spin" />
                  {tr("creating")}
                </>
              ) : (
                <>
                  <Database className="h-4 w-4 me-2" />
                  {tr("createBackup")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" />
              {tr("totalBackups")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-total-backups">
              {backups.length}
            </p>
            <p className="text-xs text-muted-foreground">{tr("backupHistory")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              {tr("storageUsed")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-storage-used">
              {formatBytes(backups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0))}
            </p>
            <p className="text-xs text-muted-foreground">{tr("totalBackupSize")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {tr("lastBackup")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-last-backup">
              {backups.length > 0 && backups[0].createdAt
                ? format(new Date(backups[0].createdAt), "MMM d, yyyy")
                : tr("never")}
            </p>
            <p className="text-xs text-muted-foreground">
              {backups.length > 0 && backups[0].createdAt
                ? format(new Date(backups[0].createdAt), "h:mm a")
                : tr("createYourFirstBackup")}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("backupHistory2")}</CardTitle>
          <CardDescription>{tr("viewAndManageYourFinancialData")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8">
              <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">{tr("noBackupsYet")}</h3>
              <p className="text-muted-foreground mb-4">{tr("createYourFirstBackupToProtect")}</p>
              <Button
                onClick={() => setIsCreateDialogOpen(true)}
                data-testid="button-create-first-backup"
              >
                <Plus className="h-4 w-4 me-2" />
                {tr("createFirstBackup")}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("name")}</TableHead>
                  <TableHead>{tr("type")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                  <TableHead>{tr("records")}</TableHead>
                  <TableHead>{tr("size")}</TableHead>
                  <TableHead>{tr("created")}</TableHead>
                  <TableHead className="text-end">{tr("actions")}</TableHead>
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
                          {backup.accountsCount || 0} {tr("accounts")}
                        </p>
                        <p className="text-muted-foreground">
                          {backup.invoicesCount || 0} {tr("invoices")}{" "}
                          {backup.journalEntriesCount || 0} {tr("entries")}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{formatBytes(backup.sizeBytes || 0)}</TableCell>
                    <TableCell>
                      {backup.createdAt && (
                        <div>
                          <p className="text-sm">
                            {format(new Date(backup.createdAt), "MMM d, yyyy")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(backup.createdAt), "h:mm a")}
                          </p>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(backup)}
                          disabled={backup.status !== "completed"}
                          data-testid={`button-download-${backup.id}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedBackupForRestore(backup);
                            getRestorePreviewMutation.mutate(backup.id);
                          }}
                          disabled={backup.status !== "completed"}
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
                              data-testid={`button-delete-${backup.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{tr("deleteBackup")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {tr("thisWillPermanentlyDeleteThisAction", { name: backup.name })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteBackupMutation.mutate(backup.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                {tr("delete")}
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
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              {tr("confirmRestore")}
            </DialogTitle>
            <DialogDescription>{tr("reviewTheChangesBeforeRestoringFrom")}</DialogDescription>
          </DialogHeader>
          {restorePreview && (
            <div className="space-y-4 py-4">
              <div className="bg-warning-subtle border border-warning/30 rounded-lg p-4">
                <p className="text-sm text-warning-subtle-foreground ">{restorePreview.warning}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{tr("currentData")}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p>
                      {restorePreview.current?.accountsCount || 0} {tr("accounts")}
                    </p>
                    <p>
                      {restorePreview.current?.journalEntriesCount || 0} {tr("journalEntries")}
                    </p>
                    <p>
                      {restorePreview.current?.invoicesCount || 0} {tr("invoices2")}
                    </p>
                    <p>
                      {restorePreview.current?.receiptsCount || 0} {tr("receipts")}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">{tr("backupData")}</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p>
                      {restorePreview.backup?.accountsCount || 0} {tr("accounts")}
                    </p>
                    <p>
                      {restorePreview.backup?.journalEntriesCount || 0} {tr("journalEntries")}
                    </p>
                    <p>
                      {restorePreview.backup?.invoicesCount || 0} {tr("invoices2")}
                    </p>
                    <p>
                      {restorePreview.backup?.receiptsCount || 0} {tr("receipts")}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <p className="text-sm text-muted-foreground">
                {tr("backupCreated2")}
                {restorePreview.backup?.createdAt &&
                  format(new Date(restorePreview.backup.createdAt), "PPpp")}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRestorePreview(null);
                setSelectedBackupForRestore(null);
              }}
            >
              {tr("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                selectedBackupForRestore && restoreMutation.mutate(selectedBackupForRestore.id)
              }
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 me-2 animate-spin" />
                  {tr("restoring")}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 me-2" />
                  {tr("restoreData")}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="bg-muted/50">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            {tr("aboutBackups")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>{tr("backupsCaptureAllYourFinancialData")}</p>
          <p>{tr("backupsAreStoredFor90Days")}</p>
          <p>{tr("beforeAnyRestoreOperationAnAutomatic")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
