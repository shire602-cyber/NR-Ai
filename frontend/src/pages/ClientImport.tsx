import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { 
  Upload, 
  FileSpreadsheet, 
  Download, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Loader2,
  Mail,
  Building2,
  Users
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

interface PreviewData {
  fileName: string;
  sheetName: string;
  headers: string[];
  totalRows: number;
  preview: any[];
  allData: any[];
}

interface ImportResult {
  message: string;
  results: {
    success: any[];
    errors: any[];
    invitations: any[];
  };
}

export default function ClientImport() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [createInvitations, setCreateInvitations] = useState(true);
  const [importResults, setImportResults] = useState<ImportResult | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const previewMutation = useMutation({
    mutationFn: async (fileData: string) => {
      return await apiRequest('POST', '/api/admin/import/preview', { 
        fileData, 
        fileName: file?.name 
      });
    },
    onSuccess: (data: PreviewData) => {
      setPreviewData(data);
      toast({ title: `Found ${data.totalRows} records in ${data.fileName}` });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to parse file', description: error.message });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: any[]) => {
      return await apiRequest('POST', '/api/admin/import/clients', { 
        data,
        createInvitations,
      });
    },
    onSuccess: (result: ImportResult) => {
      setImportResults(result);
      queryClient.invalidateQueries({ queryKey: ['/api/admin/clients'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/invitations'] });
      toast({ 
        title: 'Import completed!', 
        description: result.message,
      });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Import failed', description: error.message });
    },
  });

  const handleFileSelect = useCallback((selectedFile: File) => {
    if (!selectedFile.name.match(/\.(xlsx|xls|csv)$/i)) {
      toast({ 
        variant: 'destructive', 
        title: 'Invalid file type', 
        description: 'Please upload an Excel file (.xlsx, .xls) or CSV file' 
      });
      return;
    }

    setFile(selectedFile);
    setPreviewData(null);
    setImportResults(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = (e.target?.result as string).split(',')[1];
      previewMutation.mutate(base64);
    };
    reader.readAsDataURL(selectedFile);
  }, [previewMutation, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleImport = () => {
    if (previewData?.allData) {
      importMutation.mutate(previewData.allData);
    }
  };

  const downloadTemplate = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch('/api/admin/import/template', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) throw new Error('Failed to download template');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'client_import_template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: 'Template downloaded successfully' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Download failed', description: error.message });
    }
  };

  const resetImport = () => {
    setFile(null);
    setPreviewData(null);
    setImportResults(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-import-title">Import Clients</h1>
          <p className="text-muted-foreground">Bulk import client companies from Excel spreadsheets</p>
        </div>
        <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
          <Download className="w-4 h-4 mr-2" />
          Download Template
        </Button>
      </div>

      {!importResults ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5" />
                Upload Excel File
              </CardTitle>
              <CardDescription>
                Upload an Excel file (.xlsx, .xls) or CSV containing your client data. 
                We'll automatically map common column names like "Company Name", "Email", "Phone", etc.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  isDragOver 
                    ? 'border-primary bg-primary/5' 
                    : 'border-muted-foreground/25 hover:border-primary/50'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                data-testid="dropzone-file-upload"
              >
                {previewMutation.isPending ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <p className="text-muted-foreground">Parsing file...</p>
                  </div>
                ) : file ? (
                  <div className="flex flex-col items-center gap-3">
                    <FileSpreadsheet className="w-10 h-10 text-green-500" />
                    <p className="font-medium">{file.name}</p>
                    <Button variant="outline" size="sm" onClick={resetImport}>
                      Choose Different File
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Upload className="w-10 h-10 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Drag and drop your Excel file here</p>
                      <p className="text-sm text-muted-foreground">or click to browse</p>
                    </div>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                      data-testid="input-file-upload"
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {previewData && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Preview Data</span>
                    <Badge variant="secondary">{previewData.totalRows} records found</Badge>
                  </CardTitle>
                  <CardDescription>
                    Review the mapped data before importing. We detected the following columns: {previewData.headers.join(', ')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Company Name</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>TRN</TableHead>
                          <TableHead>Industry</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {previewData.preview.map((row, index) => (
                          <TableRow key={index} data-testid={`row-preview-${index}`}>
                            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                            <TableCell className="font-medium">{row.name || '-'}</TableCell>
                            <TableCell>{row.email || '-'}</TableCell>
                            <TableCell>{row.phone || '-'}</TableCell>
                            <TableCell>{row.trn || '-'}</TableCell>
                            <TableCell>{row.industry || '-'}</TableCell>
                            <TableCell>
                              {row.name ? (
                                <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Valid
                                </Badge>
                              ) : (
                                <Badge variant="destructive">
                                  <XCircle className="w-3 h-3 mr-1" />
                                  Missing Name
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                  {previewData.totalRows > 10 && (
                    <p className="text-sm text-muted-foreground mt-4 text-center">
                      Showing first 10 of {previewData.totalRows} records
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Import Options</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="createInvitations" 
                      checked={createInvitations}
                      onCheckedChange={(checked) => setCreateInvitations(checked as boolean)}
                      data-testid="checkbox-create-invitations"
                    />
                    <Label htmlFor="createInvitations" className="flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      Create portal invitations for clients with email addresses
                    </Label>
                  </div>
                  <p className="text-sm text-muted-foreground ml-6">
                    If enabled, clients with email addresses will receive invitation links to access their portal.
                  </p>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={resetImport} data-testid="button-cancel-import">
                  Cancel
                </Button>
                <Button 
                  onClick={handleImport} 
                  disabled={importMutation.isPending}
                  data-testid="button-confirm-import"
                >
                  {importMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Import {previewData.totalRows} Clients
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-500" />
              Import Complete
            </CardTitle>
            <CardDescription>{importResults.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="success">
              <TabsList className="mb-4">
                <TabsTrigger value="success" className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  Imported ({importResults.results.success.length})
                </TabsTrigger>
                {importResults.results.errors.length > 0 && (
                  <TabsTrigger value="errors" className="flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    Errors ({importResults.results.errors.length})
                  </TabsTrigger>
                )}
                {importResults.results.invitations.length > 0 && (
                  <TabsTrigger value="invitations" className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Invitations ({importResults.results.invitations.length})
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="success">
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importResults.results.success.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                              {item.name}
                            </div>
                          </TableCell>
                          <TableCell>{item.email || '-'}</TableCell>
                          <TableCell>
                            <Badge className="bg-green-500/10 text-green-500 border-green-500/20">
                              Created
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="errors">
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Company Name</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importResults.results.errors.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell className="font-medium">{item.row?.name || 'Unknown'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-destructive">
                              <AlertCircle className="w-4 h-4" />
                              {item.error}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="invitations">
                <ScrollArea className="h-[300px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Invite Link</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importResults.results.invitations.map((item, index) => (
                        <TableRow key={index}>
                          <TableCell>{item.email}</TableCell>
                          <TableCell>{item.companyName}</TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-2 py-1 rounded">
                              {item.inviteLink}
                            </code>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>
            </Tabs>

            <div className="flex justify-end gap-3 mt-6">
              <Button variant="outline" onClick={resetImport} data-testid="button-import-another">
                <Upload className="w-4 h-4 mr-2" />
                Import Another File
              </Button>
              <Button onClick={() => window.location.href = '/admin/clients'} data-testid="button-view-clients">
                <Users className="w-4 h-4 mr-2" />
                View All Clients
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
