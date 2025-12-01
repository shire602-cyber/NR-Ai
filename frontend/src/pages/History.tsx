import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  History as HistoryIcon, 
  Search,
  User,
  Building2,
  FileText,
  Receipt,
  Settings,
  Trash2,
  Edit,
  Plus,
  Eye,
  Database,
  RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import type { ActivityLog } from '@shared/schema';

export default function History() {
  const { companyId } = useDefaultCompany();
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');

  const { data: logs = [], isLoading } = useQuery<ActivityLog[]>({
    queryKey: ['/api/companies', companyId, 'activity-logs'],
    queryFn: async () => {
      if (!companyId) return [];
      const res = await fetch(`/api/companies/${companyId}/activity-logs?limit=200`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch activity logs');
      return res.json();
    },
    enabled: !!companyId,
  });

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAction = actionFilter === 'all' || log.action === actionFilter;
    const matchesEntity = entityFilter === 'all' || log.entityType === entityFilter;
    return matchesSearch && matchesAction && matchesEntity;
  });

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'create': return <Plus className="h-4 w-4 text-green-500" />;
      case 'update': return <Edit className="h-4 w-4 text-blue-500" />;
      case 'delete': return <Trash2 className="h-4 w-4 text-red-500" />;
      case 'view': return <Eye className="h-4 w-4 text-gray-500" />;
      default: return <HistoryIcon className="h-4 w-4" />;
    }
  };

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case 'user': return <User className="h-4 w-4" />;
      case 'company': return <Building2 className="h-4 w-4" />;
      case 'document': return <FileText className="h-4 w-4" />;
      case 'invoice': return <Receipt className="h-4 w-4" />;
      case 'journal_entry': return <FileText className="h-4 w-4" />;
      case 'account': return <Building2 className="h-4 w-4" />;
      case 'receipt': return <Receipt className="h-4 w-4" />;
      case 'backup': return <Database className="h-4 w-4" />;
      default: return <Settings className="h-4 w-4" />;
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'create':
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Create</Badge>;
      case 'update':
        return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Update</Badge>;
      case 'delete':
        return <Badge variant="destructive">Delete</Badge>;
      case 'view':
        return <Badge variant="secondary">View</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Please select a company to view history.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-history-title">Activity History</h1>
          <p className="text-muted-foreground">Track all changes made to your financial records</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4 flex-1 min-w-[300px]">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search activities..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-history"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="w-32" data-testid="select-filter-action">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="view">View</SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-36" data-testid="select-filter-entity">
                  <SelectValue placeholder="Entity Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="account">Accounts</SelectItem>
                  <SelectItem value="invoice">Invoices</SelectItem>
                  <SelectItem value="journal_entry">Journal Entries</SelectItem>
                  <SelectItem value="receipt">Receipts</SelectItem>
                  <SelectItem value="backup">Backups</SelectItem>
                </SelectContent>
              </Select>
              <Badge variant="secondary">
                {filteredLogs.length} entries
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            {filteredLogs.length === 0 ? (
              <div className="text-center py-12">
                <HistoryIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Activity Yet</h3>
                <p className="text-muted-foreground">
                  Activity will appear here as you create invoices, journal entries, and other records.
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]"></TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Date & Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => (
                    <TableRow key={log.id} data-testid={`row-history-${log.id}`}>
                      <TableCell>
                        <div className="flex items-center justify-center">
                          {getActionIcon(log.action)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{log.description}</p>
                        {log.metadata && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {(() => {
                              try {
                                const parsed = JSON.parse(log.metadata);
                                return parsed.changes?.join(', ') || '';
                              } catch {
                                return '';
                              }
                            })()}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{getActionBadge(log.action)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getEntityIcon(log.entityType)}
                          <span className="capitalize">{log.entityType.replace('_', ' ')}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {log.createdAt ? (
                          <div>
                            <p className="text-sm">{format(new Date(log.createdAt), 'MMM d, yyyy')}</p>
                            <p className="text-xs text-muted-foreground">{format(new Date(log.createdAt), 'h:mm a')}</p>
                          </div>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
