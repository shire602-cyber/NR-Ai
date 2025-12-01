import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Activity, 
  Search,
  Filter,
  User,
  Building2,
  FileText,
  Receipt,
  Settings,
  Mail,
  Trash2,
  Edit,
  Plus,
  Eye,
  LogIn,
  LogOut,
  Download
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import type { ActivityLog, User as UserType, Company } from '@shared/schema';

export default function ActivityLogs() {
  const [searchTerm, setSearchTerm] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');

  const { data: logs = [], isLoading } = useQuery<ActivityLog[]>({
    queryKey: ['/api/admin/activity-logs'],
  });

  const { data: users = [] } = useQuery<UserType[]>({
    queryKey: ['/api/admin/users'],
  });

  const { data: clients = [] } = useQuery<Company[]>({
    queryKey: ['/api/admin/clients'],
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
      case 'login': return <LogIn className="h-4 w-4 text-purple-500" />;
      case 'logout': return <LogOut className="h-4 w-4 text-orange-500" />;
      case 'invite': return <Mail className="h-4 w-4 text-indigo-500" />;
      default: return <Activity className="h-4 w-4" />;
    }
  };

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case 'user': return <User className="h-4 w-4" />;
      case 'company': return <Building2 className="h-4 w-4" />;
      case 'document': return <FileText className="h-4 w-4" />;
      case 'invoice': return <Receipt className="h-4 w-4" />;
      case 'invitation': return <Mail className="h-4 w-4" />;
      default: return <Settings className="h-4 w-4" />;
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'create':
        return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Create</Badge>;
      case 'update':
        return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Update</Badge>;
      case 'delete':
        return <Badge variant="destructive">Delete</Badge>;
      case 'view':
        return <Badge variant="secondary">View</Badge>;
      case 'login':
        return <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/20">Login</Badge>;
      case 'logout':
        return <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20">Logout</Badge>;
      case 'invite':
        return <Badge className="bg-indigo-500/10 text-indigo-500 border-indigo-500/20">Invite</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  const getUserName = (userId: string | null) => {
    if (!userId) return 'System';
    const user = users.find(u => u.id === userId);
    return user?.name || user?.email || 'Unknown';
  };

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return null;
    const company = clients.find(c => c.id === companyId);
    return company?.name || 'Unknown';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-logs-title">Activity Logs</h1>
          <p className="text-muted-foreground">Complete audit trail of all system activities</p>
        </div>
        <Button variant="outline" data-testid="button-export-logs">
          <Download className="w-4 h-4 mr-2" />
          Export Logs
        </Button>
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
                  data-testid="input-search-logs"
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
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="invite">Invite</SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-36" data-testid="select-filter-entity">
                  <SelectValue placeholder="Entity Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  <SelectItem value="user">Users</SelectItem>
                  <SelectItem value="company">Companies</SelectItem>
                  <SelectItem value="document">Documents</SelectItem>
                  <SelectItem value="invoice">Invoices</SelectItem>
                  <SelectItem value="journal_entry">Journal Entries</SelectItem>
                  <SelectItem value="invitation">Invitations</SelectItem>
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Date & Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id} data-testid={`row-log-${log.id}`}>
                    <TableCell>
                      <div className="flex items-center justify-center">
                        {getActionIcon(log.action)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{log.description}</p>
                      {log.metadata && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {JSON.parse(log.metadata).changes?.join(', ') || ''}
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
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {getUserName(log.userId)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {log.companyId ? (
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          {getCompanyName(log.companyId)}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
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
                {filteredLogs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {searchTerm || actionFilter !== 'all' || entityFilter !== 'all'
                        ? 'No logs match your filters'
                        : 'No activity logs yet'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
