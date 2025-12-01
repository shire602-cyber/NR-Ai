import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
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
  RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import type { Backup } from '@shared/schema';

type BackupWithoutData = Omit<Backup, 'dataSnapshot'>;

export default function BackupRestore() {
  const { toast } = useToast();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newBackupName, setNewBackupName] = useState('');
  const [newBackupDescription, setNewBackupDescription] = useState('');
  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<BackupWithoutData | null>(null);

  const { data: backups = [], isLoading } = useQuery<BackupWithoutData[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'backups'],
    queryFn: async () => {
      if (!selectedCompanyId) return [];
      const res = await fetch(`/api/companies/${selectedCompanyId}/backups`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch backups');
      return res.json();
    },
    enabled: !!selectedCompanyId,
  });

  const createBackupMutation = useMutation({
    mutationFn: async (data: { name: string; description: string }) => {
      const res = await apiRequest('POST', `/api/companies/${selectedCompanyId}/backups`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'backups'] });
      toast({
        title: 'Backup Created',
        description: 'Your financial data has been backed up successfully.',
      });
      setIsCreateDialogOpen(false);
      setNewBackupName('');
      setNewBackupDescription('');
    },
    onError: (error: any) => {
      toast({
        title: 'Backup Failed',
        description: error.message || 'Failed to create backup',
        variant: 'destructive',
      });
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('DELETE', `/api/backups/${id}`);
      if (!res.ok) throw new Error('Failed to delete backup');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'backups'] });
      toast({
        title: 'Backup Deleted',
        description: 'The backup has been removed.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Delete Failed',
        description: error.message || 'Failed to delete backup',
        variant: 'destructive',
      });
    },
  });

  const getRestorePreviewMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/backups/${id}/restore-preview`);
      return res.json();
    },
    onSuccess: (data) => {
      setRestorePreview(data);
    },
    onError: (error: any) => {
      toast({
        title: 'Preview Failed',
        description: error.message || 'Failed to get restore preview',
        variant: 'destructive',
      });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest('POST', `/api/backups/${id}/restore`, { confirmRestore: true });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'backups'] });
      toast({
        title: 'Restore Initiated',
        description: data.message || 'Backup restore process has started.',
      });
      setRestorePreview(null);
      setSelectedBackupForRestore(null);
    },
    onError: (error: any) => {
      toast({
        title: 'Restore Failed',
        description: error.message || 'Failed to restore backup',
        variant: 'destructive',
      });
    },
  });

  const handleDownload = async (backup: BackupWithoutData) => {
    try {
      const res = await fetch(`/api/backups/${backup.id}/download`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Download failed');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${backup.name.replace(/[^a-z0-9]/gi, '_')}_${backup.id.slice(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      toast({
        title: 'Download Started',
        description: 'Your backup file is downloading.',
      });
    } catch (error: any) {
      toast({
        title: 'Download Failed',
        description: error.message || 'Failed to download backup',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20"><CheckCircle className="h-3 w-3 mr-1" />Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />In Progress</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getBackupTypeLabel = (type: string) => {
    switch (type) {
      case 'manual':
        return 'Manual';
      case 'scheduled':
        return 'Scheduled';
      case 'pre_restore':
        return 'Pre-Restore';
      default:
        return type;
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please select a company to manage backups.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-backup-title">Backup & Restore</h1>
          <p className="text-muted-foreground">Safeguard your financial records with automated backups</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-backup">
              <Plus className="h-4 w-4 mr-2" />
              Create Backup
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Backup</DialogTitle>
              <DialogDescription>
                Create a complete backup of your financial data including accounts, invoices, journal entries, and receipts.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="backup-name">Backup Name</Label>
                <Input
                  id="backup-name"
                  placeholder={`Backup ${new Date().toLocaleDateString()}`}
                  value={newBackupName}
                  onChange={(e) => setNewBackupName(e.target.value)}
                  data-testid="input-backup-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="backup-description">Description (Optional)</Label>
                <Textarea
                  id="backup-description"
                  placeholder="Add notes about this backup..."
                  value={newBackupDescription}
                  onChange={(e) => setNewBackupDescription(e.target.value)}
                  data-testid="input-backup-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={() => createBackupMutation.mutate({ 
                  name: newBackupName || `Backup ${new Date().toLocaleDateString()}`,
                  description: newBackupDescription 
                })}
                disabled={createBackupMutation.isPending}
                data-testid="button-confirm-backup"
              >
                {createBackupMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Database className="h-4 w-4 mr-2" />
                    Create Backup
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" />
              Total Backups
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-total-backups">{backups.length}</p>
            <p className="text-xs text-muted-foreground">Backup history</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4" />
              Storage Used
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-storage-used">
              {formatBytes(backups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0))}
            </p>
            <p className="text-xs text-muted-foreground">Total backup size</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Last Backup
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-last-backup">
              {backups.length > 0 && backups[0].createdAt 
                ? format(new Date(backups[0].createdAt), 'MMM d, yyyy')
                : 'Never'}
            </p>
            <p className="text-xs text-muted-foreground">
              {backups.length > 0 && backups[0].createdAt
                ? format(new Date(backups[0].createdAt), 'h:mm a')
                : 'Create your first backup'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup History</CardTitle>
          <CardDescription>View and manage your financial data backups</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-8">
              <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No Backups Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first backup to protect your financial records
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)} data-testid="button-create-first-backup">
                <Plus className="h-4 w-4 mr-2" />
                Create First Backup
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
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
                        <p>{backup.accountsCount || 0} accounts</p>
                        <p className="text-muted-foreground">
                          {backup.invoicesCount || 0} invoices, {backup.journalEntriesCount || 0} entries
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{formatBytes(backup.sizeBytes || 0)}</TableCell>
                    <TableCell>
                      {backup.createdAt && (
                        <div>
                          <p className="text-sm">{format(new Date(backup.createdAt), 'MMM d, yyyy')}</p>
                          <p className="text-xs text-muted-foreground">{format(new Date(backup.createdAt), 'h:mm a')}</p>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(backup)}
                          disabled={backup.status !== 'completed'}
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
                          disabled={backup.status !== 'completed'}
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
                              <AlertDialogTitle>Delete Backup?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{backup.name}". This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteBackupMutation.mutate(backup.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
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

      <Dialog open={!!restorePreview} onOpenChange={() => { setRestorePreview(null); setSelectedBackupForRestore(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Confirm Restore
            </DialogTitle>
            <DialogDescription>
              Review the changes before restoring from backup
            </DialogDescription>
          </DialogHeader>
          {restorePreview && (
            <div className="space-y-4 py-4">
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                <p className="text-sm text-yellow-800 dark:text-yellow-200">
                  {restorePreview.warning}
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Current Data</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p>{restorePreview.current?.accountsCount || 0} accounts</p>
                    <p>{restorePreview.current?.journalEntriesCount || 0} journal entries</p>
                    <p>{restorePreview.current?.invoicesCount || 0} invoices</p>
                    <p>{restorePreview.current?.receiptsCount || 0} receipts</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Backup Data</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p>{restorePreview.backup?.accountsCount || 0} accounts</p>
                    <p>{restorePreview.backup?.journalEntriesCount || 0} journal entries</p>
                    <p>{restorePreview.backup?.invoicesCount || 0} invoices</p>
                    <p>{restorePreview.backup?.receiptsCount || 0} receipts</p>
                  </CardContent>
                </Card>
              </div>

              <p className="text-sm text-muted-foreground">
                Backup created: {restorePreview.backup?.createdAt && format(new Date(restorePreview.backup.createdAt), 'PPpp')}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRestorePreview(null); setSelectedBackupForRestore(null); }}>
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => selectedBackupForRestore && restoreMutation.mutate(selectedBackupForRestore.id)}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Restoring...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Restore Data
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
            About Backups
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Backups capture all your financial data including chart of accounts, journal entries, 
            invoices, receipts, and VAT returns.
          </p>
          <p>
            Backups are stored for 90 days and can be downloaded as JSON files for external storage.
          </p>
          <p>
            Before any restore operation, an automatic backup of your current data is created 
            so you can recover if needed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
