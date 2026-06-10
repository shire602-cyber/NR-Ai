import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, FileImage, File, Loader2, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const CATEGORY_LABELS: Record<string, string> = {
  trade_license: 'Trade License',
  contract: 'Contract',
  tax_certificate: 'Tax Certificate',
  audit_report: 'Audit Report',
  bank_statement: 'Bank Statement',
  insurance: 'Insurance',
  visa: 'Visa',
  other: 'Other',
};

function fileIcon(mime: string) {
  if (mime?.startsWith('image/')) return <FileImage className="w-5 h-5 text-blue-400" />;
  if (mime === 'application/pdf') return <FileText className="w-5 h-5 text-red-400" />;
  return <File className="w-5 h-5 text-gray-400" />;
}

function formatBytes(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PortalDocuments() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: documents = [], isLoading } = useQuery<any[]>({
    queryKey: ['portal-documents'],
    queryFn: () => apiRequest('GET', '/api/client-portal/documents'),
  });

  const uploadMutation = useMutation({
    mutationFn: (payload: any) => apiRequest('POST', '/api/client-portal/documents', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-documents'] });
      toast({ title: 'Document uploaded', description: 'NR Accounting can now see your file.' });
    },
    onError: (e: any) => toast({ title: 'Upload failed', description: e.message, variant: 'destructive' }),
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // In production this would upload to S3; here we send metadata only
      await uploadMutation.mutateAsync({
        name: file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        category: 'other',
        fileUrl: `/uploads/${file.name}`,
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Documents</h2>
          <p className="text-sm text-gray-500 mt-1">Upload receipts and documents for NR Accounting to process.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange}
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv"
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            Upload Document
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-14">
              <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">No documents yet</p>
              <p className="text-xs text-gray-400 mt-1">Upload receipts or files for your accountant.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {documents.map((doc: any) => (
                <div key={doc.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
                  <div className="flex-shrink-0">{fileIcon(doc.mimeType)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.name}</p>
                    <p className="text-xs text-gray-400">
                      {doc.createdAt ? format(new Date(doc.createdAt), 'MMM d, yyyy') : '—'}
                      {doc.fileSize ? ` · ${formatBytes(doc.fileSize)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className="text-xs">
                      {CATEGORY_LABELS[doc.category] ?? doc.category}
                    </Badge>
                    {doc.uploadedBy && (
                      <CheckCircle2 className="w-4 h-4 text-green-500" aria-label="Received by NRA" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
