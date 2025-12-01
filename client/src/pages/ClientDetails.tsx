import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'wouter';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  Building2, 
  ArrowLeft, 
  FileText, 
  Calendar, 
  Users, 
  Receipt, 
  Mail, 
  Phone, 
  Globe, 
  MapPin,
  Edit,
  Clock,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

interface Company {
  id: string;
  name: string;
  industry: string | null;
  legalStructure: string | null;
  registrationNumber: string | null;
  trnVatNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  businessAddress: string | null;
  createdAt: string;
}

interface Document {
  id: string;
  name: string;
  category: string;
  expiryDate: string | null;
  createdAt: string;
}

interface ComplianceTask {
  id: string;
  title: string;
  category: string;
  status: string;
  dueDate: string;
}

interface User {
  id: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  role: string;
}

interface ClientData {
  company: Company;
  documents: Document[];
  complianceTasks: ComplianceTask[];
  users: User[];
}

export default function ClientDetails() {
  const { id: clientId } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery<ClientData>({
    queryKey: [`/api/admin/clients/${clientId}`],
    enabled: !!clientId,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!data?.company) {
    return (
      <div className="text-center py-12">
        <Building2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p className="text-muted-foreground">Client not found</p>
        <Link href="/admin/clients">
          <Button variant="ghost" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Clients
          </Button>
        </Link>
      </div>
    );
  }

  const { company, documents = [], complianceTasks = [], users = [] } = data;
  
  const expiredDocs = documents.filter(d => d.expiryDate && new Date(d.expiryDate) < new Date()).length;
  const pendingTasks = complianceTasks.filter(t => t.status !== 'completed').length;
  const overdueTasks = complianceTasks.filter(t => t.status !== 'completed' && new Date(t.dueDate) < new Date()).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/clients">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-client-name">{company.name}</h1>
            <div className="flex items-center gap-2 text-muted-foreground">
              {company.industry && <Badge variant="outline">{company.industry}</Badge>}
              {company.legalStructure && <span>{company.legalStructure}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/clients/${clientId}/documents`}>
            <Button variant="outline" data-testid="button-manage-documents">
              <FileText className="w-4 h-4 mr-2" />
              Documents
            </Button>
          </Link>
          <Link href={`/admin/clients/${clientId}/tasks`}>
            <Button variant="outline" data-testid="button-manage-tasks">
              <Calendar className="w-4 h-4 mr-2" />
              Tasks
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Documents</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{documents.length}</div>
            {expiredDocs > 0 && (
              <p className="text-xs text-red-500">{expiredDocs} expired</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tasks</CardTitle>
            <Calendar className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{complianceTasks.length}</div>
            {overdueTasks > 0 && (
              <p className="text-xs text-red-500">{overdueTasks} overdue</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Users</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{users.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">TRN</CardTitle>
            <Receipt className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-medium">{company.trnVatNumber || '-'}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Company Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {company.contactEmail && (
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span>{company.contactEmail}</span>
              </div>
            )}
            {company.contactPhone && (
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{company.contactPhone}</span>
              </div>
            )}
            {company.websiteUrl && (
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {company.websiteUrl}
                </a>
              </div>
            )}
            {company.businessAddress && (
              <div className="flex items-start gap-2">
                <MapPin className="w-4 h-4 text-muted-foreground mt-1" />
                <span>{company.businessAddress}</span>
              </div>
            )}
            {company.registrationNumber && (
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <span>Reg: {company.registrationNumber}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
              <Clock className="w-3 h-3" />
              Created {format(parseISO(company.createdAt), 'MMM d, yyyy')}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="tasks">
              <TabsList className="mb-4">
                <TabsTrigger value="tasks">Tasks ({pendingTasks} pending)</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="users">Users</TabsTrigger>
              </TabsList>
              
              <TabsContent value="tasks">
                {complianceTasks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No tasks yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {complianceTasks.slice(0, 5).map(task => (
                      <div key={task.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          {task.status === 'completed' ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : new Date(task.dueDate) < new Date() ? (
                            <AlertTriangle className="w-4 h-4 text-red-500" />
                          ) : (
                            <Clock className="w-4 h-4 text-blue-500" />
                          )}
                          <span className={task.status === 'completed' ? 'line-through opacity-60' : ''}>
                            {task.title}
                          </span>
                        </div>
                        <Badge variant={task.status === 'completed' ? 'secondary' : 'outline'}>
                          {format(parseISO(task.dueDate), 'MMM d')}
                        </Badge>
                      </div>
                    ))}
                    {complianceTasks.length > 5 && (
                      <Link href={`/admin/clients/${clientId}/tasks`}>
                        <Button variant="ghost" className="w-full">
                          View all {complianceTasks.length} tasks
                        </Button>
                      </Link>
                    )}
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="documents">
                {documents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No documents yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {documents.slice(0, 5).map(doc => (
                      <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span>{doc.name}</span>
                          <Badge variant="outline" className="text-xs">{doc.category}</Badge>
                        </div>
                        {doc.expiryDate && (
                          <Badge variant={new Date(doc.expiryDate) < new Date() ? 'destructive' : 'secondary'}>
                            {format(parseISO(doc.expiryDate), 'MMM d')}
                          </Badge>
                        )}
                      </div>
                    ))}
                    {documents.length > 5 && (
                      <Link href={`/admin/clients/${clientId}/documents`}>
                        <Button variant="ghost" className="w-full">
                          View all {documents.length} documents
                        </Button>
                      </Link>
                    )}
                  </div>
                )}
              </TabsContent>
              
              <TabsContent value="users">
                {users.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p>No users assigned</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {users.map(u => (
                      <div key={u.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">{u.user.name}</div>
                          <div className="text-sm text-muted-foreground">{u.user.email}</div>
                        </div>
                        <Badge>{u.role}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}