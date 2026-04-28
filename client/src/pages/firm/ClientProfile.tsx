import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useParams, useLocation } from 'wouter';
import {
  ArrowLeft, Building2, Phone, Mail, Globe, MapPin,
  FileText, Receipt, Users, Calendar, Edit, Save, X,
  BookOpen, ExternalLink, Shield, CheckCircle2, AlertCircle, Clock,
  UserPlus, UserMinus,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { format } from 'date-fns';
import type { Company } from '@shared/schema';
import { useActiveCompany } from '@/components/ActiveCompanyProvider';

interface AssignedStaff {
  id: string;
  name: string;
  email: string;
  role: string;
}

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
  assignedStaff: AssignedStaff[];
}

interface ClientSummary {
  company: Company;
  stats: ClientStats;
  companyUsers: { id: string; role: string; user: { id: string; name: string; email: string } }[];
  recentInvoices: any[];
  recentReceipts: any[];
}

interface StaffMember {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  assignedClients: { companyId: string; companyName: string; role: string }[];
}

function formatAed(amount: number) {
  return new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function EditableField({
  label,
  value,
  editing,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string | null | undefined;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
      {editing ? (
        <Input
          type={type}
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder || label}
          className="h-8"
        />
      ) : (
        <p className="text-sm font-medium">{value || '—'}</p>
      )}
    </div>
  );
}

export default function ClientProfile() {
  const { companyId } = useParams<{ companyId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { setActiveClientCompany } = useActiveCompany();
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<Company>>({});
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState('');

  const switchMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/firm/clients/${companyId}/switch`),
    onSuccess: () => {
      if (companyId) setActiveClientCompany(companyId);
      queryClient.invalidateQueries({ queryKey: ['/api/companies'] });
      navigate('/dashboard');
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Could not open client books', description: e?.message });
    },
  });

  const { data: summary, isLoading } = useQuery<ClientSummary>({
    queryKey: [`/api/firm/clients/${companyId}/summary`],
    enabled: !!companyId,
  });

  const { data: firmStaff = [] } = useQuery<StaffMember[]>({
    queryKey: ['/api/firm/staff'],
    enabled: assignOpen,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Company>) =>
      apiRequest('PUT', `/api/firm/clients/${companyId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/firm/clients/${companyId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ['/api/firm/clients'] });
      toast({ title: 'Client updated successfully' });
      setEditing(false);
      setEditData({});
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Update failed', description: e?.message });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ staffUserId, action }: { staffUserId: string; action: 'assign' | 'unassign' }) =>
      apiRequest('POST', `/api/firm/clients/${companyId}/assign-staff`, {
        staffUserId,
        action,
        role: 'accountant',
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/firm/clients/${companyId}/summary`] });
      queryClient.invalidateQueries({ queryKey: ['/api/firm/clients'] });
      toast({ title: vars.action === 'assign' ? 'Staff assigned' : 'Staff unassigned' });
      setAssignOpen(false);
      setSelectedStaff('');
    },
    onError: (e: any) => {
      toast({ variant: 'destructive', title: 'Assignment failed', description: e?.message });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading client profile...
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertCircle className="w-10 h-10 text-muted-foreground mb-3" />
        <p className="font-medium">Client not found</p>
        <Button variant="ghost" onClick={() => navigate('/firm/clients')}>
          Back to portfolio
        </Button>
      </div>
    );
  }

  const { company, stats } = summary;
  const current = { ...company, ...editData };

  const handleEdit = () => {
    setEditData({});
    setEditing(true);
  };

  const handleSave = () => {
    if (Object.keys(editData).length === 0) {
      setEditing(false);
      return;
    }
    updateMutation.mutate(editData);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditData({});
  };

  const field = (key: keyof Company) => ({
    value: current[key] as string | null | undefined,
    editing,
    onChange: (v: string) => setEditData(d => ({ ...d, [key]: v })),
  });

  const assignedIds = new Set(stats.assignedStaff.map(s => s.id));
  const unassignedStaff = firmStaff.filter(s => !assignedIds.has(s.id));

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/firm/clients')}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          NRA Client Portfolio
        </Button>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium">{company.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{company.name}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {company.trnVatNumber ? `TRN: ${company.trnVatNumber}` : 'No TRN registered'}
              {company.emirate ? ` · ${company.emirate.replace(/_/g, ' ')}` : ''}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={handleCancel}>
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={updateMutation.isPending}>
                <Save className="w-4 h-4 mr-1" />
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={handleEdit}>
                <Edit className="w-4 h-4 mr-1" />
                Edit
              </Button>
              <Button
                onClick={() => switchMutation.mutate()}
                disabled={switchMutation.isPending}
                data-testid="button-open-books-profile"
              >
                <BookOpen className="w-4 h-4 mr-2" />
                {switchMutation.isPending ? 'Switching...' : 'Open Books'}
                <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Outstanding AR</p>
            <p className="text-xl font-bold mt-0.5">{formatAed(stats.outstandingAr)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Invoices</p>
            <p className="text-xl font-bold mt-0.5">{stats.invoiceCount}</p>
            <p className="text-xs text-muted-foreground">{formatAed(stats.invoiceTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Last Receipt</p>
            <p className="text-sm font-semibold mt-0.5">
              {stats.lastReceiptDate
                ? format(new Date(stats.lastReceiptDate), 'MMM d, yyyy')
                : 'Never'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">VAT Status</p>
            {stats.vatStatus ? (
              <div className="mt-0.5">
                <Badge
                  className={
                    stats.vatStatus.status === 'filed'
                      ? 'bg-green-100 text-green-800 border-green-200'
                      : 'bg-amber-100 text-amber-800 border-amber-200'
                  }
                >
                  {stats.vatStatus.status.replace(/_/g, ' ')}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1">
                  Due {format(new Date(stats.vatStatus.dueDate), 'MMM d, yyyy')}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground mt-0.5">No returns</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Company Info */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Company Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <EditableField label="Company Name" {...field('name')} />
            <EditableField label="TRN / VAT Number" {...field('trnVatNumber')} />
            <EditableField label="Legal Structure" {...field('legalStructure')} />
            <EditableField label="Industry" {...field('industry')} />
            <EditableField label="Registration Number" {...field('registrationNumber')} />
            <EditableField label="Emirate" {...field('emirate')} />
            <div className="col-span-2">
              <EditableField
                label="Business Address"
                {...field('businessAddress')}
                placeholder="Street, Area, City"
              />
            </div>
          </CardContent>
        </Card>

        {/* Contact & Tax */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <EditableField label="Email" {...field('contactEmail')} type="email" />
              <EditableField label="Phone" {...field('contactPhone')} type="tel" />
              <EditableField label="Website" {...field('websiteUrl')} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Tax & Compliance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">VAT Filing</p>
                {editing ? (
                  <Select
                    value={current.vatFilingFrequency || 'quarterly'}
                    onValueChange={v => setEditData(d => ({ ...d, vatFilingFrequency: v }))}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-medium capitalize">
                    {company.vatFilingFrequency || 'quarterly'}
                  </p>
                )}
              </div>
              <EditableField label="Tax Registration Type" {...field('taxRegistrationType')} />
              <EditableField label="Corporate Tax ID" {...field('corporateTaxId')} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Assigned Staff */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Assigned NRA Staff</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAssignOpen(true)}>
            <UserPlus className="w-4 h-4 mr-1.5" />
            Assign Staff
          </Button>
        </CardHeader>
        <CardContent>
          {stats.assignedStaff.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No staff assigned to this client yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {stats.assignedStaff.map(staff => (
                <div
                  key={staff.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                      {staff.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{staff.name}</p>
                      <p className="text-xs text-muted-foreground">{staff.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">{staff.role}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => assignMutation.mutate({ staffUserId: staff.id, action: 'unassign' })}
                      disabled={assignMutation.isPending}
                    >
                      <UserMinus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity */}
      {summary.recentInvoices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {summary.recentInvoices.slice(0, 5).map((inv: any) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{inv.number}</p>
                      <p className="text-xs text-muted-foreground">{inv.customerName}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{formatAed(inv.total)}</p>
                    <Badge
                      variant={inv.status === 'paid' ? 'outline' : 'secondary'}
                      className="text-xs"
                    >
                      {inv.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Assign Staff Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Staff to {company.name}</DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-3">
            {unassignedStaff.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                All firm staff are already assigned to this client.
              </p>
            ) : (
              <>
                <Label>Select staff member</Label>
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a staff member..." />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedStaff.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} ({s.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssignOpen(false); setSelectedStaff(''); }}>
              Cancel
            </Button>
            <Button
              onClick={() => assignMutation.mutate({ staffUserId: selectedStaff, action: 'assign' })}
              disabled={!selectedStaff || assignMutation.isPending}
            >
              {assignMutation.isPending ? 'Assigning...' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
