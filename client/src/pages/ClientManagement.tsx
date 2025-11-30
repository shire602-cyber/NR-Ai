import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Building2, 
  Plus, 
  Search,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  FileText,
  Users,
  Receipt,
  Calendar,
  Mail,
  Phone,
  Globe,
  MapPin,
  Filter,
  Download,
  Upload
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Link } from 'wouter';
import { format } from 'date-fns';
import type { Company } from '@shared/schema';

interface ClientWithStats extends Company {
  userCount: number;
  documentCount: number;
  invoiceCount: number;
}

export default function ClientManagement() {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [industryFilter, setIndustryFilter] = useState<string>('all');
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientWithStats | null>(null);
  
  // Form state for new client - all fields
  const [formData, setFormData] = useState({
    name: '',
    industry: '',
    legalStructure: '',
    registrationNumber: '',
    trnVatNumber: '',
    taxRegistrationType: '',
    vatFilingFrequency: '',
    contactEmail: '',
    contactPhone: '',
    websiteUrl: '',
    businessAddress: '',
  });
  
  const resetForm = () => {
    setFormData({
      name: '',
      industry: '',
      legalStructure: '',
      registrationNumber: '',
      trnVatNumber: '',
      taxRegistrationType: '',
      vatFilingFrequency: '',
      contactEmail: '',
      contactPhone: '',
      websiteUrl: '',
      businessAddress: '',
    });
  };

  const { data: clients = [], isLoading } = useQuery<ClientWithStats[]>({
    queryKey: ['/api/admin/clients'],
  });

  const createClientMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', '/api/admin/clients', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/clients'] });
      toast({ title: 'Client created successfully' });
      setAddClientOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to create client', description: error.message });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest('PATCH', `/api/admin/clients/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/clients'] });
      toast({ title: 'Client updated successfully' });
      setEditingClient(null);
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to update client', description: error.message });
    },
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/admin/clients/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/clients'] });
      toast({ title: 'Client deleted successfully' });
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Failed to delete client', description: error.message });
    },
  });

  const filteredClients = clients.filter(client => {
    const matchesSearch = client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.contactEmail?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.trnVatNumber?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesIndustry = industryFilter === 'all' || client.industry === industryFilter;
    return matchesSearch && matchesIndustry;
  });

  const industries = Array.from(new Set(clients.map(c => c.industry).filter(Boolean)));

  const handleCreateClient = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({ variant: 'destructive', title: 'Company name is required' });
      return;
    }
    const data = {
      name: formData.name.trim(),
      industry: formData.industry || null,
      legalStructure: formData.legalStructure || null,
      registrationNumber: formData.registrationNumber || null,
      businessAddress: formData.businessAddress || null,
      contactEmail: formData.contactEmail || null,
      contactPhone: formData.contactPhone || null,
      websiteUrl: formData.websiteUrl || null,
      trnVatNumber: formData.trnVatNumber || null,
      taxRegistrationType: formData.taxRegistrationType || null,
      vatFilingFrequency: formData.vatFilingFrequency || null,
    };
    createClientMutation.mutate(data);
  };

  const handleUpdateClient = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingClient) return;
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name'),
      industry: formData.get('industry') || null,
      legalStructure: formData.get('legalStructure') || null,
      registrationNumber: formData.get('registrationNumber') || null,
      businessAddress: formData.get('businessAddress') || null,
      contactEmail: formData.get('contactEmail') || null,
      contactPhone: formData.get('contactPhone') || null,
      websiteUrl: formData.get('websiteUrl') || null,
      trnVatNumber: formData.get('trnVatNumber') || null,
    };
    updateClientMutation.mutate({ id: editingClient.id, data });
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
          <h1 className="text-3xl font-bold" data-testid="text-clients-title">Client Management</h1>
          <p className="text-muted-foreground">Manage all your accounting firm's clients</p>
        </div>
        <Dialog open={addClientOpen} onOpenChange={(open) => { setAddClientOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-client">
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Client</DialogTitle>
              <DialogDescription>Create a new client company for your accounting services</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateClient} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Company Name *</Label>
                  <Input 
                    id="name" 
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    required 
                    data-testid="input-client-name" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="industry">Industry</Label>
                  <Select value={formData.industry} onValueChange={(value) => setFormData(prev => ({ ...prev, industry: value }))}>
                    <SelectTrigger data-testid="select-industry">
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">Retail</SelectItem>
                      <SelectItem value="services">Services</SelectItem>
                      <SelectItem value="manufacturing">Manufacturing</SelectItem>
                      <SelectItem value="technology">Technology</SelectItem>
                      <SelectItem value="construction">Construction</SelectItem>
                      <SelectItem value="hospitality">Hospitality</SelectItem>
                      <SelectItem value="healthcare">Healthcare</SelectItem>
                      <SelectItem value="real_estate">Real Estate</SelectItem>
                      <SelectItem value="trading">Trading</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="legalStructure">Legal Structure</Label>
                  <Select value={formData.legalStructure} onValueChange={(value) => setFormData(prev => ({ ...prev, legalStructure: value }))}>
                    <SelectTrigger data-testid="select-legal-structure">
                      <SelectValue placeholder="Select structure" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="llc">LLC</SelectItem>
                      <SelectItem value="sole_proprietorship">Sole Proprietorship</SelectItem>
                      <SelectItem value="partnership">Partnership</SelectItem>
                      <SelectItem value="corporation">Corporation</SelectItem>
                      <SelectItem value="free_zone">Free Zone Company</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registrationNumber">Registration Number</Label>
                  <Input 
                    id="registrationNumber" 
                    value={formData.registrationNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, registrationNumber: e.target.value }))}
                    data-testid="input-registration" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trnVatNumber">TRN / VAT Number</Label>
                  <Input 
                    id="trnVatNumber" 
                    value={formData.trnVatNumber}
                    onChange={(e) => setFormData(prev => ({ ...prev, trnVatNumber: e.target.value }))}
                    data-testid="input-trn" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taxRegistrationType">Tax Registration Type</Label>
                  <Select value={formData.taxRegistrationType} onValueChange={(value) => setFormData(prev => ({ ...prev, taxRegistrationType: value }))}>
                    <SelectTrigger data-testid="select-tax-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="flat_rate">Flat Rate</SelectItem>
                      <SelectItem value="non_registered">Non-registered</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vatFilingFrequency">VAT Filing Frequency</Label>
                  <Select value={formData.vatFilingFrequency} onValueChange={(value) => setFormData(prev => ({ ...prev, vatFilingFrequency: value }))}>
                    <SelectTrigger data-testid="select-vat-frequency">
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annually">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact Email</Label>
                  <Input 
                    id="contactEmail" 
                    type="email" 
                    value={formData.contactEmail}
                    onChange={(e) => setFormData(prev => ({ ...prev, contactEmail: e.target.value }))}
                    data-testid="input-email" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Contact Phone</Label>
                  <Input 
                    id="contactPhone" 
                    value={formData.contactPhone}
                    onChange={(e) => setFormData(prev => ({ ...prev, contactPhone: e.target.value }))}
                    data-testid="input-phone" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="websiteUrl">Website</Label>
                  <Input 
                    id="websiteUrl" 
                    value={formData.websiteUrl}
                    onChange={(e) => setFormData(prev => ({ ...prev, websiteUrl: e.target.value }))}
                    data-testid="input-website" 
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="businessAddress">Business Address</Label>
                  <Textarea 
                    id="businessAddress" 
                    value={formData.businessAddress}
                    onChange={(e) => setFormData(prev => ({ ...prev, businessAddress: e.target.value }))}
                    data-testid="input-address" 
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddClientOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createClientMutation.isPending} data-testid="button-submit-client">
                  {createClientMutation.isPending ? 'Creating...' : 'Create Client'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search clients by name, email, or TRN..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-clients"
                />
              </div>
              <Select value={industryFilter} onValueChange={setIndustryFilter}>
                <SelectTrigger className="w-48" data-testid="select-filter-industry">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter by industry" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Industries</SelectItem>
                  {industries.map(industry => (
                    <SelectItem key={industry} value={industry!}>{industry}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Badge variant="secondary" data-testid="text-client-count">
              {filteredClients.length} of {clients.length} clients
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>TRN</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-center">Users</TableHead>
                  <TableHead className="text-center">Docs</TableHead>
                  <TableHead className="text-center">Invoices</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow key={client.id} data-testid={`row-client-${client.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{client.name}</p>
                        {client.legalStructure && (
                          <p className="text-xs text-muted-foreground">{client.legalStructure}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {client.industry ? (
                        <Badge variant="outline">{client.industry}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.trnVatNumber || <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        {client.contactEmail && (
                          <div className="flex items-center gap-1 text-sm">
                            <Mail className="w-3 h-3" />
                            {client.contactEmail}
                          </div>
                        )}
                        {client.contactPhone && (
                          <div className="flex items-center gap-1 text-sm">
                            <Phone className="w-3 h-3" />
                            {client.contactPhone}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{client.userCount}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{client.documentCount}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{client.invoiceCount}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" data-testid={`button-actions-${client.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <Link href={`/admin/clients/${client.id}`}>
                            <DropdownMenuItem data-testid={`menu-view-${client.id}`}>
                              <Eye className="w-4 h-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                          </Link>
                          <DropdownMenuItem onClick={() => setEditingClient(client)} data-testid={`menu-edit-${client.id}`}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <Link href={`/admin/clients/${client.id}/documents`}>
                            <DropdownMenuItem>
                              <FileText className="w-4 h-4 mr-2" />
                              Manage Documents
                            </DropdownMenuItem>
                          </Link>
                          <Link href={`/admin/clients/${client.id}/tasks`}>
                            <DropdownMenuItem>
                              <Calendar className="w-4 h-4 mr-2" />
                              Compliance Tasks
                            </DropdownMenuItem>
                          </Link>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem 
                            className="text-destructive"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this client? This action cannot be undone.')) {
                                deleteClientMutation.mutate(client.id);
                              }
                            }}
                            data-testid={`menu-delete-${client.id}`}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredClients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {searchTerm || industryFilter !== 'all' 
                        ? 'No clients match your filters' 
                        : 'No clients yet. Add your first client to get started.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={!!editingClient} onOpenChange={(open) => !open && setEditingClient(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
            <DialogDescription>Update client information</DialogDescription>
          </DialogHeader>
          {editingClient && (
            <form onSubmit={handleUpdateClient} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Company Name *</Label>
                  <Input 
                    id="edit-name" 
                    name="name" 
                    defaultValue={editingClient.name} 
                    required 
                    data-testid="input-edit-name" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-industry">Industry</Label>
                  <Select name="industry" defaultValue={editingClient.industry || ''}>
                    <SelectTrigger data-testid="select-edit-industry">
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">Retail</SelectItem>
                      <SelectItem value="services">Services</SelectItem>
                      <SelectItem value="manufacturing">Manufacturing</SelectItem>
                      <SelectItem value="technology">Technology</SelectItem>
                      <SelectItem value="construction">Construction</SelectItem>
                      <SelectItem value="hospitality">Hospitality</SelectItem>
                      <SelectItem value="healthcare">Healthcare</SelectItem>
                      <SelectItem value="real_estate">Real Estate</SelectItem>
                      <SelectItem value="trading">Trading</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-trnVatNumber">TRN / VAT Number</Label>
                  <Input 
                    id="edit-trnVatNumber" 
                    name="trnVatNumber" 
                    defaultValue={editingClient.trnVatNumber || ''} 
                    data-testid="input-edit-trn" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-registrationNumber">Registration Number</Label>
                  <Input 
                    id="edit-registrationNumber" 
                    name="registrationNumber" 
                    defaultValue={editingClient.registrationNumber || ''} 
                    data-testid="input-edit-registration" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-contactEmail">Contact Email</Label>
                  <Input 
                    id="edit-contactEmail" 
                    name="contactEmail" 
                    type="email" 
                    defaultValue={editingClient.contactEmail || ''} 
                    data-testid="input-edit-email" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-contactPhone">Contact Phone</Label>
                  <Input 
                    id="edit-contactPhone" 
                    name="contactPhone" 
                    defaultValue={editingClient.contactPhone || ''} 
                    data-testid="input-edit-phone" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-websiteUrl">Website</Label>
                  <Input 
                    id="edit-websiteUrl" 
                    name="websiteUrl" 
                    defaultValue={editingClient.websiteUrl || ''} 
                    data-testid="input-edit-website" 
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="edit-businessAddress">Business Address</Label>
                  <Textarea 
                    id="edit-businessAddress" 
                    name="businessAddress" 
                    defaultValue={editingClient.businessAddress || ''} 
                    data-testid="input-edit-address" 
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditingClient(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateClientMutation.isPending} data-testid="button-update-client">
                  {updateClientMutation.isPending ? 'Updating...' : 'Update Client'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
