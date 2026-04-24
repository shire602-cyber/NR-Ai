import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  Building2, Plus, Search, LayoutGrid, List,
  ChevronRight, AlertCircle, CheckCircle2, Clock,
  FileText, Receipt, Users, Calendar, Edit, UserPlus,
  BookOpen, Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import type { Company } from '@shared/schema';

interface ClientStats {
  invoiceCount: number;
  invoiceTotal: number;
  outstandingAr: number;
  lastReceiptDate: string | null;
  lastBankActivityDate: string | null;
  vatStatus: {
    status: string;
    dueDate: string;
    periodEnd: string;
  } | null;
  assignedStaff: { id: string; name: string; email: string; role: string }[];
}

type ClientWithStats = Company & ClientStats;

function formatAed(amount: number) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function VatStatusBadge({ vatStatus }: { vatStatus: ClientWithStats['vatStatus'] }) {
  if (!vatStatus) return <Badge variant="outline">No VAT</Badge>;
  const due = new Date(vatStatus.dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (vatStatus.status === 'filed' || vatStatus.status === 'submitted') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Filed</Badge>;
  }
  if (daysUntilDue < 0) {
    return <Badge variant="destructive">Overdue</Badge>;
  }
  if (daysUntilDue <= 14) {
    return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Due {format(due, 'MMM d')}</Badge>;
  }
  return <Badge variant="outline">Due {format(due, 'MMM d')}</Badge>;
}

function StatusBadge({ active }: { active: boolean }) {
  return active
    ? <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>
    : <Badge variant="secondary">Inactive</Badge>;
}

interface AddClientFormData {
  name: string;
  trnVatNumber: string;
  industry: string;
  legalStructure: string;
  contactEmail: string;
  contactPhone: string;
  businessAddress: string;
  emirate: string;
  vatFilingFrequency: string;
}

const emptyForm: AddClientFormData = {
  name: '',
  trnVatNumber: '',
  industry: '',
  legalStructure: '',
  contactEmail: '',
  contactPhone: '',
  businessAddress: '',
  emirate: 'dubai',
  vatFilingFrequency: 'quarterly',
};

export default function ClientPortfolio() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [view, setView] = useState<'card' | 'table'>('card');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddClientFormData>(emptyForm);

  const { data: clients = [], isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ['/api/firm/clients'],
  });

  const createMutation = useMutation({
    mutationFn: (data: AddClientFormData) => apiRequest('POST', '/api/firm/clients', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/firm/clients'] });
      toast({ title: 'Client created successfully' });
      setAddOpen(false);
      setForm(emptyForm);
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Failed to create client', description: e?.message });
    },
  });

  const filtered = clients.filter(c => {
    const matchesSearch =
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.trnVatNumber || '').includes(search);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && c.invoiceCount > 0) ||
      (statusFilter === 'inactive' && c.invoiceCount === 0);
    return matchesSearch && matchesStatus;
  });

  const handleOpenBooks = (id: string) => {
    navigate(`/firm/clients/${id}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading client portfolio...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Client Portfolio</h1>
          <p className="text-muted-foreground mt-1">
            {clients.length} client{clients.length !== 1 ? 's' : ''} managed by NRA
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Client
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or TRN..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
          <SelectTrigger className="w-36">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex border rounded-md">
          <Button
            variant={view === 'card' ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-r-none"
            onClick={() => setView('card')}
          >
            <LayoutGrid className="w-4 h-4" />
          </Button>
          <Button
            variant={view === 'table' ? 'secondary' : 'ghost'}
            size="sm"
            className="rounded-l-none"
            onClick={() => setView('table')}
          >
            <List className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
          <h3 className="font-semibold text-lg">
            {clients.length === 0 ? 'No clients yet' : 'No clients match your search'}
          </h3>
          <p className="text-muted-foreground mt-1 mb-4">
            {clients.length === 0
              ? 'Add your first client company to get started.'
              : 'Try adjusting your search or filters.'}
          </p>
          {clients.length === 0 && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add First Client
            </Button>
          )}
        </div>
      )}

      {/* Card view */}
      {view === 'card' && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(client => (
            <Card key={client.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{client.name}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {client.trnVatNumber ? `TRN: ${client.trnVatNumber}` : 'No TRN registered'}
                    </p>
                  </div>
                  <StatusBadge active={client.invoiceCount > 0} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Key metrics */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-muted/40 rounded-md p-2">
                    <p className="text-xs text-muted-foreground">Outstanding AR</p>
                    <p className="font-semibold text-sm mt-0.5">{formatAed(client.outstandingAr)}</p>
                  </div>
                  <div className="bg-muted/40 rounded-md p-2">
                    <p className="text-xs text-muted-foreground">Invoices</p>
                    <p className="font-semibold text-sm mt-0.5">{client.invoiceCount}</p>
                  </div>
                </div>

                {/* VAT status */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    VAT Status
                  </span>
                  <VatStatusBadge vatStatus={client.vatStatus} />
                </div>

                {/* Last activity */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Last receipt</span>
                  <span>
                    {client.lastReceiptDate
                      ? format(new Date(client.lastReceiptDate), 'MMM d, yyyy')
                      : 'Never'}
                  </span>
                </div>

                {/* Staff */}
                {client.assignedStaff.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="w-3.5 h-3.5" />
                    {client.assignedStaff.map(s => s.name).join(', ')}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleOpenBooks(client.id)}
                  >
                    <BookOpen className="w-3.5 h-3.5 mr-1.5" />
                    Open Books
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/firm/clients/${client.id}`)}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Table view */}
      {view === 'table' && filtered.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>TRN</TableHead>
                <TableHead>Outstanding AR</TableHead>
                <TableHead>Invoices</TableHead>
                <TableHead>VAT Status</TableHead>
                <TableHead>Last Receipt</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(client => (
                <TableRow key={client.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell>
                    <div>
                      <p className="font-medium">{client.name}</p>
                      {client.industry && (
                        <p className="text-xs text-muted-foreground">{client.industry}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.trnVatNumber || '—'}
                  </TableCell>
                  <TableCell className="font-medium">{formatAed(client.outstandingAr)}</TableCell>
                  <TableCell>{client.invoiceCount}</TableCell>
                  <TableCell>
                    <VatStatusBadge vatStatus={client.vatStatus} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.lastReceiptDate
                      ? format(new Date(client.lastReceiptDate), 'MMM d, yyyy')
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm">{client.assignedStaff.length}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" onClick={() => handleOpenBooks(client.id)}>
                        <BookOpen className="w-3.5 h-3.5 mr-1" />
                        Open
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Client Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add New Client</DialogTitle>
            <DialogDescription>
              Create a new client company. A UAE chart of accounts will be seeded automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Al Majid Trading LLC"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="trn">TRN / VAT Number</Label>
                <Input
                  id="trn"
                  value={form.trnVatNumber}
                  onChange={e => setForm(f => ({ ...f, trnVatNumber: e.target.value }))}
                  placeholder="100234567890003"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="emirate">Emirate</Label>
                <Select value={form.emirate} onValueChange={v => setForm(f => ({ ...f, emirate: v }))}>
                  <SelectTrigger id="emirate">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="abu_dhabi">Abu Dhabi</SelectItem>
                    <SelectItem value="dubai">Dubai</SelectItem>
                    <SelectItem value="sharjah">Sharjah</SelectItem>
                    <SelectItem value="ajman">Ajman</SelectItem>
                    <SelectItem value="umm_al_quwain">Umm Al Quwain</SelectItem>
                    <SelectItem value="ras_al_khaimah">Ras Al Khaimah</SelectItem>
                    <SelectItem value="fujairah">Fujairah</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="legalStructure">Legal Structure</Label>
                <Select
                  value={form.legalStructure}
                  onValueChange={v => setForm(f => ({ ...f, legalStructure: v }))}
                >
                  <SelectTrigger id="legalStructure">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LLC">LLC</SelectItem>
                    <SelectItem value="Sole Proprietorship">Sole Proprietorship</SelectItem>
                    <SelectItem value="Partnership">Partnership</SelectItem>
                    <SelectItem value="Corporation">Corporation</SelectItem>
                    <SelectItem value="Free Zone">Free Zone</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="vatFrequency">VAT Filing</Label>
                <Select
                  value={form.vatFilingFrequency}
                  onValueChange={v => setForm(f => ({ ...f, vatFilingFrequency: v }))}
                >
                  <SelectTrigger id="vatFrequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                value={form.industry}
                onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
                placeholder="Trading, Construction, Retail..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="contactEmail">Email</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  value={form.contactEmail}
                  onChange={e => setForm(f => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="info@company.ae"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contactPhone">Phone</Label>
                <Input
                  id="contactPhone"
                  value={form.contactPhone}
                  onChange={e => setForm(f => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+971 4 123 4567"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="businessAddress">Business Address</Label>
              <Input
                id="businessAddress"
                value={form.businessAddress}
                onChange={e => setForm(f => ({ ...f, businessAddress: e.target.value }))}
                placeholder="Office 301, Business Bay, Dubai"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Client'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
