import { Badge } from '@/components/ui/badge';
import { Card,CardContent } from '@/components/ui/card';
import { apiRequest } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { CheckCircle2,File,FileImage,FileText,FolderOpen,Loader2 } from 'lucide-react';

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
  const { data: documents = [], isLoading } = useQuery<any[]>({
    queryKey: ['portal-documents'],
    queryFn: () => apiRequest('GET', '/api/client-portal/documents'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Documents</h2>
          <p className="text-sm text-gray-500 mt-1">Documents shared by NR Accounting.</p>
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
              <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">No documents available</p>
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
