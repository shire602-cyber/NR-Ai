import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { 
  Bell, 
  Clock, 
  Mail, 
  MessageSquare,
  Settings,
  History,
  Plus,
  CheckCircle,
  XCircle,
  Send,
  AlertTriangle
} from 'lucide-react';
import { SiWhatsapp } from 'react-icons/si';
import type { ReminderSetting, ReminderLog } from '@shared/schema';

const REMINDER_TYPES = [
  { value: 'invoice_overdue', label: 'Invoice Overdue', description: 'Send when invoice is past due date' },
  { value: 'invoice_due_soon', label: 'Invoice Due Soon', description: 'Send before invoice due date' },
  { value: 'vat_deadline', label: 'VAT Deadline', description: 'Remind about upcoming VAT filing' },
  { value: 'payment_followup', label: 'Payment Follow-up', description: 'Follow up on unpaid invoices' },
];

export default function Reminders() {
  const { toast } = useToast();
  const { companyId: selectedCompanyId, isLoading: companyLoading } = useDefaultCompany();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newSetting, setNewSetting] = useState({
    reminderType: '',
    isEnabled: true,
    daysBeforeDue: 3,
    daysAfterDue: 1,
    repeatIntervalDays: 7,
    maxReminders: 3,
    sendEmail: true,
    sendSms: false,
    sendInApp: true,
    sendWhatsapp: false,
    emailSubject: '',
    emailTemplate: '',
    whatsappTemplate: '',
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<ReminderSetting[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'reminder-settings'],
    enabled: !!selectedCompanyId,
  });

  const { data: logs, isLoading: logsLoading } = useQuery<ReminderLog[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'reminder-logs'],
    enabled: !!selectedCompanyId,
  });

  const createSettingMutation = useMutation({
    mutationFn: (data: Partial<ReminderSetting>) => 
      apiRequest('POST', `/api/companies/${selectedCompanyId}/reminder-settings`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'reminder-settings'] });
      setShowCreateDialog(false);
      toast({ title: 'Reminder setting created' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const updateSettingMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<ReminderSetting>) => 
      apiRequest('PATCH', `/api/reminder-settings/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'reminder-settings'] });
      toast({ title: 'Reminder setting updated' });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return <Badge className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />Sent</Badge>;
      case 'delivered':
        return <Badge className="bg-blue-500"><CheckCircle className="w-3 h-3 mr-1" />Delivered</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'email':
        return <Mail className="w-4 h-4" />;
      case 'sms':
        return <MessageSquare className="w-4 h-4" />;
      case 'whatsapp':
        return <SiWhatsapp className="w-4 h-4 text-green-500" />;
      case 'in_app':
        return <Bell className="w-4 h-4" />;
      default:
        return <Bell className="w-4 h-4" />;
    }
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh]">
        <AlertTriangle className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">No Company Selected</h2>
        <p className="text-muted-foreground">Please select a company to manage reminders.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Payment Reminders</h1>
          <p className="text-muted-foreground">
            Configure automated reminders for invoices and deadlines
          </p>
        </div>
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-reminder">
              <Plus className="w-4 h-4 mr-2" />
              Create Reminder
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Reminder Setting</DialogTitle>
              <DialogDescription>
                Configure when and how reminders are sent
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="space-y-2">
                <Label>Reminder Type</Label>
                <Select
                  value={newSetting.reminderType}
                  onValueChange={(value) => setNewSetting({ ...newSetting, reminderType: value })}
                >
                  <SelectTrigger data-testid="select-reminder-type">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {REMINDER_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div>
                          <div className="font-medium">{type.label}</div>
                          <div className="text-xs text-muted-foreground">{type.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Days Before Due</Label>
                  <Input
                    type="number"
                    value={newSetting.daysBeforeDue}
                    onChange={(e) => setNewSetting({ ...newSetting, daysBeforeDue: parseInt(e.target.value) || 0 })}
                    data-testid="input-days-before"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Days After Due (for overdue)</Label>
                  <Input
                    type="number"
                    value={newSetting.daysAfterDue}
                    onChange={(e) => setNewSetting({ ...newSetting, daysAfterDue: parseInt(e.target.value) || 0 })}
                    data-testid="input-days-after"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Repeat Every (days)</Label>
                  <Input
                    type="number"
                    value={newSetting.repeatIntervalDays}
                    onChange={(e) => setNewSetting({ ...newSetting, repeatIntervalDays: parseInt(e.target.value) || 0 })}
                    data-testid="input-repeat-interval"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Reminders</Label>
                  <Input
                    type="number"
                    value={newSetting.maxReminders}
                    onChange={(e) => setNewSetting({ ...newSetting, maxReminders: parseInt(e.target.value) || 1 })}
                    data-testid="input-max-reminders"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <Label>Channels</Label>
                <div className="flex gap-6 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={newSetting.sendInApp}
                      onCheckedChange={(checked) => setNewSetting({ ...newSetting, sendInApp: checked })}
                      data-testid="switch-in-app"
                    />
                    <Label className="flex items-center gap-1">
                      <Bell className="w-4 h-4" /> In-App
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={newSetting.sendEmail}
                      onCheckedChange={(checked) => setNewSetting({ ...newSetting, sendEmail: checked })}
                      data-testid="switch-email"
                    />
                    <Label className="flex items-center gap-1">
                      <Mail className="w-4 h-4" /> Email
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={newSetting.sendSms}
                      onCheckedChange={(checked) => setNewSetting({ ...newSetting, sendSms: checked })}
                      data-testid="switch-sms"
                    />
                    <Label className="flex items-center gap-1">
                      <MessageSquare className="w-4 h-4" /> SMS
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={newSetting.sendWhatsapp}
                      onCheckedChange={(checked) => setNewSetting({ ...newSetting, sendWhatsapp: checked })}
                      data-testid="switch-whatsapp"
                    />
                    <Label className="flex items-center gap-1">
                      <SiWhatsapp className="w-4 h-4 text-green-500" /> WhatsApp
                    </Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Email Subject (optional)</Label>
                <Input
                  placeholder="Payment Reminder: Invoice {{invoice_number}}"
                  value={newSetting.emailSubject}
                  onChange={(e) => setNewSetting({ ...newSetting, emailSubject: e.target.value })}
                  data-testid="input-email-subject"
                />
              </div>

              <div className="space-y-2">
                <Label>Email Template (optional)</Label>
                <Textarea
                  placeholder="Dear {{customer_name}}, This is a reminder..."
                  value={newSetting.emailTemplate}
                  onChange={(e) => setNewSetting({ ...newSetting, emailTemplate: e.target.value })}
                  rows={4}
                  data-testid="input-email-template"
                />
                <p className="text-xs text-muted-foreground">
                  Use placeholders: {'{{customer_name}}'}, {'{{invoice_number}}'}, {'{{amount}}'}, {'{{due_date}}'}
                </p>
              </div>

              {newSetting.sendWhatsapp && (
                <div className="space-y-2">
                  <Label>WhatsApp Template (optional)</Label>
                  <Textarea
                    placeholder="Hello {{customer_name}}, This is a reminder that invoice {{invoice_number}} for {{amount}} is due on {{due_date}}."
                    value={newSetting.whatsappTemplate}
                    onChange={(e) => setNewSetting({ ...newSetting, whatsappTemplate: e.target.value })}
                    rows={4}
                    data-testid="input-whatsapp-template"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use placeholders: {'{{customer_name}}'}, {'{{invoice_number}}'}, {'{{amount}}'}, {'{{due_date}}'}
                  </p>
                </div>
              )}

              <Button 
                onClick={() => createSettingMutation.mutate(newSetting)}
                disabled={!newSetting.reminderType || createSettingMutation.isPending}
                data-testid="button-save-reminder"
              >
                Create Reminder Setting
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="w-4 h-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="w-4 h-4 mr-2" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings" className="mt-6">
          {settingsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : !settings?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Clock className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No reminder settings</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Create reminder settings to automate payment follow-ups
                </p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create First Reminder
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {settings.map((setting) => {
                const typeInfo = REMINDER_TYPES.find(t => t.value === setting.reminderType);
                return (
                  <Card key={setting.id} data-testid={`card-setting-${setting.id}`}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            {typeInfo?.label || setting.reminderType}
                            <Badge variant={setting.isEnabled ? 'default' : 'secondary'}>
                              {setting.isEnabled ? 'Active' : 'Disabled'}
                            </Badge>
                          </CardTitle>
                          <CardDescription>{typeInfo?.description}</CardDescription>
                        </div>
                        <Switch
                          checked={setting.isEnabled}
                          onCheckedChange={(checked) => 
                            updateSettingMutation.mutate({ id: setting.id, isEnabled: checked })
                          }
                          data-testid={`switch-enable-${setting.id}`}
                        />
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Before Due:</span>
                          <span className="ml-2 font-medium">{setting.daysBeforeDue || 0} days</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">After Due:</span>
                          <span className="ml-2 font-medium">{setting.daysAfterDue || 0} days</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Repeat:</span>
                          <span className="ml-2 font-medium">Every {setting.repeatIntervalDays || 7} days</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Max:</span>
                          <span className="ml-2 font-medium">{setting.maxReminders || 3} reminders</span>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        {setting.sendInApp && (
                          <Badge variant="outline"><Bell className="w-3 h-3 mr-1" />In-App</Badge>
                        )}
                        {setting.sendEmail && (
                          <Badge variant="outline"><Mail className="w-3 h-3 mr-1" />Email</Badge>
                        )}
                        {setting.sendSms && (
                          <Badge variant="outline"><MessageSquare className="w-3 h-3 mr-1" />SMS</Badge>
                        )}
                        {setting.sendWhatsapp && (
                          <Badge variant="outline"><SiWhatsapp className="w-3 h-3 mr-1 text-green-500" />WhatsApp</Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          {logsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !logs?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <History className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No reminder history</h3>
                <p className="text-muted-foreground text-center">
                  Sent reminders will appear here
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[500px]">
              <div className="space-y-2">
                {logs.map((log) => (
                  <Card key={log.id} data-testid={`card-log-${log.id}`}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        {getChannelIcon(log.channel)}
                        <div>
                          <div className="font-medium">{log.reminderType.replace('_', ' ')}</div>
                          <div className="text-sm text-muted-foreground">
                            {log.recipientEmail || log.recipientPhone || 'In-app notification'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground">
                          Attempt {log.attemptNumber}
                        </span>
                        {getStatusBadge(log.status)}
                        <span className="text-sm text-muted-foreground">
                          {log.sentAt ? format(new Date(log.sentAt), 'MMM d, yyyy HH:mm') : '-'}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
