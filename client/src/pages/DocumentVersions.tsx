import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  History,
  FileText,
  Search,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiUrl } from '@/lib/api';
import { format } from 'date-fns';
import type { DocumentVersion } from '@shared/schema';

const DOCUMENT_TYPES = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'quote', label: 'Quote' },
  { value: 'credit_note', label: 'Credit Note' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'receipt', label: 'Receipt' },
] as const;

export default function DocumentVersions() {
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const [documentType, setDocumentType] = useState<string>('');
  const [documentId, setDocumentId] = useState('');
  const [searchTriggered, setSearchTriggered] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);

  const canSearch = !!selectedCompanyId && !!documentType && !!documentId.trim();

  const { data: versions = [], isLoading, isError } = useQuery<DocumentVersion[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'document-versions', documentType, documentId],
    queryFn: async () => {
      if (!selectedCompanyId || !documentType || !documentId.trim()) return [];
      const res = await fetch(
        apiUrl(`/api/companies/${selectedCompanyId}/document-versions/${documentType}/${documentId.trim()}`),
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to fetch document versions');
      return res.json();
    },
    enabled: canSearch && searchTriggered,
  });

  const handleSearch = () => {
    if (canSearch) {
      setSearchTriggered(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const toggleExpand = (versionId: string) => {
    setExpandedVersionId(prev => (prev === versionId ? null : versionId));
  };

  const formatSnapshotData = (data: string | null): string => {
    if (!data) return 'No snapshot data';
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <History className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Document Versions</h1>
          <p className="text-muted-foreground">
            View the full version history and audit trail for any document
          </p>
        </div>
      </div>

      {/* Search Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Find Document History
          </CardTitle>
          <CardDescription>
            Select a document type and enter the document ID to view its version timeline
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="documentType">Document Type</Label>
              <Select
                value={documentType}
                onValueChange={(value) => {
                  setDocumentType(value);
                  setSearchTriggered(false);
                }}
              >
                <SelectTrigger id="documentType">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 space-y-2">
              <Label htmlFor="documentId">Document ID</Label>
              <Input
                id="documentId"
                placeholder="Enter document ID..."
                value={documentId}
                onChange={(e) => {
                  setDocumentId(e.target.value);
                  setSearchTriggered(false);
                }}
                onKeyDown={handleKeyDown}
              />
            </div>

            <Button onClick={handleSearch} disabled={!canSearch}>
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {searchTriggered && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Version History
              {versions.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {versions.length} version{versions.length !== 1 ? 's' : ''}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {documentType && (
                <span className="capitalize">{documentType.replace('_', ' ')}</span>
              )}
              {' '}&mdash; {documentId}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Clock className="h-5 w-5 mr-2 animate-spin" />
                Loading version history...
              </div>
            ) : isError ? (
              <div className="text-center py-12 text-destructive">
                Failed to load version history. Please check the document ID and try again.
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-lg font-medium">No versions found</p>
                <p className="text-sm">
                  No version history exists for this document yet.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Version</TableHead>
                    <TableHead>Change Description</TableHead>
                    <TableHead className="w-[160px]">Changed By</TableHead>
                    <TableHead className="w-[180px]">Date</TableHead>
                    <TableHead className="w-[100px]">Snapshot</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => {
                    const isExpanded = expandedVersionId === version.id;
                    return (
                      <>
                        <TableRow key={version.id} className="hover:bg-muted/50">
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              v{version.version}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {version.changeDescription || (
                              <span className="text-muted-foreground italic">No description</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm truncate max-w-[120px]">
                                {version.changedBy || 'System'}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">
                              {format(new Date(version.createdAt), 'MMM d, yyyy HH:mm')}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleExpand(version.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 mr-1" />
                              ) : (
                                <ChevronRight className="h-4 w-4 mr-1" />
                              )}
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${version.id}-snapshot`}>
                            <TableCell colSpan={5} className="p-0">
                              <div className="bg-muted/30 border-t px-6 py-4">
                                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
                                  Snapshot Data
                                </Label>
                                <pre className="text-xs font-mono bg-background rounded-md border p-4 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                                  {formatSnapshotData(version.snapshotData)}
                                </pre>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
