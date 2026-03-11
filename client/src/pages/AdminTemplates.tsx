import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { FileText, Plus, Edit2, ToggleLeft, ToggleRight, Loader2, MessageSquare, Mail, Globe } from 'lucide-react';

interface MessageTemplate {
  id: number;
  name: string;
  category: string;
  language: string;
  body: string;
  subject: string;
  channel: string;
  isActive: boolean;
  createdAt: string;
}

interface EditFormState {
  subject: string;
  body: string;
}

interface CreateFormState {
  name: string;
  category: string;
  language: string;
  channel: string;
  subject: string;
  body: string;
}

function getCategoryBadge(category: string) {
  switch (category) {
    case 'reminder':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{category}</Badge>;
    case 'news':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{category}</Badge>;
    case 'cross_sell':
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{category}</Badge>;
    case 'general':
    default:
      return <Badge variant="outline">{category}</Badge>;
  }
}

function getLanguageBadge(language: string) {
  switch (language) {
    case 'en':
      return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">English</Badge>;
    case 'ar':
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">العربية</Badge>;
    case 'so':
      return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Soomaali</Badge>;
    default:
      return <Badge variant="outline">{language}</Badge>;
  }
}

function getChannelBadge(channel: string) {
  switch (channel) {
    case 'whatsapp':
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          <MessageSquare className="w-3 h-3 mr-1" />
          whatsapp
        </Badge>
      );
    case 'email':
      return (
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          <Mail className="w-3 h-3 mr-1" />
          email
        </Badge>
      );
    default:
      return <Badge variant="outline">{channel}</Badge>;
  }
}

export default function AdminTemplates() {
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({ subject: '', body: '' });

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>({
    name: '',
    category: 'general',
    language: 'en',
    channel: 'whatsapp',
    subject: '',
    body: '',
  });

  const { data: templates = [], isLoading } = useQuery<MessageTemplate[]>({
    queryKey: ['/api/admin/message-templates'],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Pick<MessageTemplate, 'body' | 'subject' | 'isActive'>> }) =>
      apiRequest('PUT', `/api/admin/message-templates/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/message-templates'] });
      toast({ title: 'Template Updated', description: 'Message template has been updated successfully' });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateFormState) =>
      apiRequest('POST', '/api/admin/message-templates', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/message-templates'] });
      toast({ title: 'Template Created', description: 'New message template has been created successfully' });
      setCreateDialogOpen(false);
      setCreateForm({
        name: '',
        category: 'general',
        language: 'en',
        channel: 'whatsapp',
        subject: '',
        body: '',
      });
    },
    onError: (err: any) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const handleEditOpen = (template: MessageTemplate) => {
    setEditingTemplate(template);
    setEditForm({ subject: template.subject, body: template.body });
    setEditDialogOpen(true);
  };

  const handleEditSave = () => {
    if (!editingTemplate) return;
    updateMutation.mutate(
      { id: editingTemplate.id, data: { subject: editForm.subject, body: editForm.body } },
      { onSuccess: () => setEditDialogOpen(false) },
    );
  };

  const handleToggleActive = (template: MessageTemplate) => {
    updateMutation.mutate({ id: template.id, data: { isActive: !template.isActive } });
  };

  const handleCreateSubmit = () => {
    createMutation.mutate(createForm);
  };

  const filteredTemplates = templates.filter((t) => {
    if (searchQuery && !t.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (categoryFilter !== 'all' && t.category !== categoryFilter) {
      return false;
    }
    if (languageFilter !== 'all' && t.language !== languageFilter) {
      return false;
    }
    return true;
  });

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
          <h1 className="text-3xl font-bold">Message Templates</h1>
          <p className="text-muted-foreground">Manage WhatsApp and email message templates</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Templates
          </CardTitle>
          <CardDescription>All configured message templates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1">
              <Input
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="reminder">Reminder</SelectItem>
                <SelectItem value="news">News</SelectItem>
                <SelectItem value="cross_sell">Cross Sell</SelectItem>
              </SelectContent>
            </Select>
            <Select value={languageFilter} onValueChange={setLanguageFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Languages</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
                <SelectItem value="so">Soomaali</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTemplates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No templates found</p>
                  </TableCell>
                </TableRow>
              )}
              {filteredTemplates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.name}</TableCell>
                  <TableCell>{getCategoryBadge(template.category)}</TableCell>
                  <TableCell>{getLanguageBadge(template.language)}</TableCell>
                  <TableCell>{getChannelBadge(template.channel)}</TableCell>
                  <TableCell>
                    <Switch
                      checked={template.isActive}
                      onCheckedChange={() => handleToggleActive(template)}
                    />
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {template.subject || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => handleEditOpen(template)}>
                      <Edit2 className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Modify the subject and body for this template
            </DialogDescription>
          </DialogHeader>
          {editingTemplate && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input value={editingTemplate.name} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-subject">Subject</Label>
                <Input
                  id="edit-subject"
                  value={editForm.subject}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, subject: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-body">Body</Label>
                <Textarea
                  id="edit-body"
                  value={editForm.body}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, body: e.target.value }))}
                  className="min-h-[200px]"
                />
                <p className="text-xs text-muted-foreground">
                  Available placeholders: {'{{clientName}}'}, {'{{documentType}}'}, {'{{dueDate}}'}, {'{{daysRemaining}}'}, {'{{newsTitle}}'}, {'{{newsSummary}}'}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Create New Template</DialogTitle>
            <DialogDescription>
              Add a new message template for WhatsApp or email
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">Name</Label>
              <Input
                id="create-name"
                placeholder="e.g. reminder_en_whatsapp"
                value={createForm.name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={createForm.category}
                  onValueChange={(value) => setCreateForm((prev) => ({ ...prev, category: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="reminder">Reminder</SelectItem>
                    <SelectItem value="news">News</SelectItem>
                    <SelectItem value="cross_sell">Cross Sell</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select
                  value={createForm.language}
                  onValueChange={(value) => setCreateForm((prev) => ({ ...prev, language: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ar">العربية</SelectItem>
                    <SelectItem value="so">Soomaali</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select
                  value={createForm.channel}
                  onValueChange={(value) => setCreateForm((prev) => ({ ...prev, channel: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-subject">Subject</Label>
              <Input
                id="create-subject"
                placeholder="Email subject line"
                value={createForm.subject}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, subject: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-body">Body</Label>
              <Textarea
                id="create-body"
                placeholder="Template message body..."
                value={createForm.body}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, body: e.target.value }))}
                className="min-h-[200px]"
              />
              <p className="text-xs text-muted-foreground">
                Available placeholders: {'{{clientName}}'}, {'{{documentType}}'}, {'{{dueDate}}'}, {'{{daysRemaining}}'}, {'{{newsTitle}}'}, {'{{newsSummary}}'}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
