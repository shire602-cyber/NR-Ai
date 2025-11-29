import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { 
  UserPlus, 
  Users, 
  Shield, 
  Crown, 
  Calculator,
  Briefcase,
  User,
  Mail,
  Trash2,
  Edit,
  Check,
  X,
  Loader2,
  Settings,
  Eye,
  FileText,
  Receipt,
  BarChart3,
  Building2
} from 'lucide-react';

interface TeamMember {
  id: string;
  userId: string;
  companyId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

interface RolePermission {
  key: string;
  label: string;
  labelAr: string;
  icon: React.ReactNode;
  roles: string[];
}

const ROLE_PERMISSIONS: RolePermission[] = [
  { key: 'view_dashboard', label: 'View Dashboard', labelAr: 'عرض لوحة التحكم', icon: <BarChart3 className="w-4 h-4" />, roles: ['owner', 'cfo', 'accountant', 'employee'] },
  { key: 'manage_invoices', label: 'Manage Invoices', labelAr: 'إدارة الفواتير', icon: <FileText className="w-4 h-4" />, roles: ['owner', 'cfo', 'accountant'] },
  { key: 'manage_expenses', label: 'Manage Expenses', labelAr: 'إدارة المصروفات', icon: <Receipt className="w-4 h-4" />, roles: ['owner', 'cfo', 'accountant', 'employee'] },
  { key: 'post_journal', label: 'Post Journal Entries', labelAr: 'ترحيل القيود', icon: <Calculator className="w-4 h-4" />, roles: ['owner', 'cfo', 'accountant'] },
  { key: 'view_reports', label: 'View Financial Reports', labelAr: 'عرض التقارير المالية', icon: <BarChart3 className="w-4 h-4" />, roles: ['owner', 'cfo', 'accountant'] },
  { key: 'manage_vat', label: 'Manage VAT Returns', labelAr: 'إدارة إقرارات الضريبة', icon: <FileText className="w-4 h-4" />, roles: ['owner', 'cfo', 'accountant'] },
  { key: 'manage_team', label: 'Manage Team Members', labelAr: 'إدارة فريق العمل', icon: <Users className="w-4 h-4" />, roles: ['owner'] },
  { key: 'company_settings', label: 'Company Settings', labelAr: 'إعدادات الشركة', icon: <Settings className="w-4 h-4" />, roles: ['owner'] },
];

const ROLES = [
  { value: 'owner', label: 'Owner', labelAr: 'مالك', description: 'Full access to all features', icon: <Crown className="w-4 h-4" /> },
  { value: 'cfo', label: 'CFO', labelAr: 'المدير المالي', description: 'Financial oversight and reporting', icon: <Briefcase className="w-4 h-4" /> },
  { value: 'accountant', label: 'Accountant', labelAr: 'محاسب', description: 'Day-to-day bookkeeping', icon: <Calculator className="w-4 h-4" /> },
  { value: 'employee', label: 'Employee', labelAr: 'موظف', description: 'Submit expenses only', icon: <User className="w-4 h-4" /> },
];

export default function TeamManagement() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('accountant');
  const [newRole, setNewRole] = useState('');

  const { data: teamMembers, isLoading: isLoadingTeam } = useQuery<TeamMember[]>({
    queryKey: ['/api/companies', companyId, 'team'],
    enabled: !!companyId,
  });

  const inviteMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) =>
      apiRequest('POST', `/api/companies/${companyId}/team/invite`, { email, role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'team'] });
      toast({
        title: 'Invitation Sent',
        description: `An invitation has been sent to ${inviteEmail}`,
      });
      setInviteDialogOpen(false);
      setInviteEmail('');
      setInviteRole('accountant');
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Invitation Failed',
        description: error.message || 'Failed to send invitation',
      });
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      apiRequest('PUT', `/api/companies/${companyId}/team/${memberId}`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'team'] });
      toast({
        title: 'Role Updated',
        description: 'Team member role has been updated.',
      });
      setEditDialogOpen(false);
      setSelectedMember(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message || 'Failed to update role',
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiRequest('DELETE', `/api/companies/${companyId}/team/${memberId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'team'] });
      toast({
        title: 'Member Removed',
        description: 'Team member has been removed from the company.',
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Removal Failed',
        description: error.message || 'Failed to remove member',
      });
    },
  });

  const stats = useMemo(() => {
    if (!teamMembers) return { total: 0, owners: 0, accountants: 0, employees: 0 };
    
    return {
      total: teamMembers.length,
      owners: teamMembers.filter(m => m.role === 'owner').length,
      accountants: teamMembers.filter(m => m.role === 'accountant' || m.role === 'cfo').length,
      employees: teamMembers.filter(m => m.role === 'employee').length,
    };
  }, [teamMembers]);

  const getRoleBadge = (role: string) => {
    const roleInfo = ROLES.find(r => r.value === role);
    const colors: Record<string, string> = {
      owner: 'bg-purple-100 text-purple-800',
      cfo: 'bg-blue-100 text-blue-800',
      accountant: 'bg-green-100 text-green-800',
      employee: 'bg-gray-100 text-gray-800',
    };
    
    return (
      <Badge variant="secondary" className={colors[role] || ''}>
        {roleInfo?.icon}
        <span className="ml-1">{locale === 'ar' ? roleInfo?.labelAr : roleInfo?.label}</span>
      </Badge>
    );
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleEditMember = (member: TeamMember) => {
    setSelectedMember(member);
    setNewRole(member.role);
    setEditDialogOpen(true);
  };

  const handleUpdateRole = () => {
    if (!selectedMember || !newRole) return;
    updateRoleMutation.mutate({
      memberId: selectedMember.id,
      role: newRole,
    });
  };

  const handleRemoveMember = (member: TeamMember) => {
    if (member.role === 'owner') {
      toast({
        variant: 'destructive',
        title: 'Cannot Remove Owner',
        description: 'The company owner cannot be removed.',
      });
      return;
    }
    
    if (window.confirm(`Are you sure you want to remove ${member.user.name} from the team?`)) {
      removeMemberMutation.mutate(member.id);
    }
  };

  if (isLoadingCompany) {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            {locale === 'ar' ? 'إدارة الفريق' : 'Team Management'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'ar' 
              ? 'إدارة أعضاء الفريق والصلاحيات'
              : 'Manage team members and their access permissions'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setPermissionsDialogOpen(true)} data-testid="button-view-permissions">
            <Shield className="w-4 h-4 mr-2" />
            {locale === 'ar' ? 'الصلاحيات' : 'Permissions'}
          </Button>
          <Button onClick={() => setInviteDialogOpen(true)} data-testid="button-invite-member">
            <UserPlus className="w-4 h-4 mr-2" />
            {locale === 'ar' ? 'دعوة عضو' : 'Invite Member'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'إجمالي الأعضاء' : 'Total Members'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'المالكين' : 'Owners'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{stats.owners}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'المحاسبين' : 'Accountants/CFOs'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.accountants}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {locale === 'ar' ? 'الموظفين' : 'Employees'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-gray-600">{stats.employees}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{locale === 'ar' ? 'أعضاء الفريق' : 'Team Members'}</CardTitle>
          <CardDescription>
            {locale === 'ar' 
              ? 'جميع الأعضاء الذين لديهم حق الوصول إلى هذه الشركة'
              : 'All members who have access to this company'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingTeam ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : !teamMembers || teamMembers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {locale === 'ar' 
                  ? 'لا يوجد أعضاء آخرين. قم بدعوة فريقك.'
                  : 'No other team members. Invite your team to collaborate.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {teamMembers.map(member => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                  data-testid={`member-${member.id}`}
                >
                  <div className="flex items-center gap-4">
                    <Avatar>
                      <AvatarFallback>{getInitials(member.user.name)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{member.user.name}</p>
                      <p className="text-sm text-muted-foreground">{member.user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {getRoleBadge(member.role)}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditMember(member)}
                        disabled={member.role === 'owner'}
                        data-testid={`button-edit-${member.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveMember(member)}
                        disabled={member.role === 'owner'}
                        className="text-destructive hover:text-destructive"
                        data-testid={`button-remove-${member.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'دعوة عضو جديد' : 'Invite Team Member'}</DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'أرسل دعوة للانضمام إلى فريقك'
                : 'Send an invitation to join your team'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'البريد الإلكتروني' : 'Email Address'}</Label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                data-testid="input-invite-email"
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'الدور' : 'Role'}</Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger data-testid="select-invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter(r => r.value !== 'owner').map(role => (
                    <SelectItem key={role.value} value={role.value}>
                      <div className="flex items-center gap-2">
                        {role.icon}
                        <div>
                          <p>{locale === 'ar' ? role.labelAr : role.label}</p>
                          <p className="text-xs text-muted-foreground">{role.description}</p>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button 
              onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
              disabled={inviteMutation.isPending || !inviteEmail}
              data-testid="button-confirm-invite"
            >
              {inviteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Mail className="w-4 h-4 mr-2" />
              {locale === 'ar' ? 'إرسال الدعوة' : 'Send Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'تعديل الدور' : 'Edit Role'}</DialogTitle>
            <DialogDescription>
              {selectedMember && (
                <span>
                  {locale === 'ar' ? 'تغيير دور' : 'Change role for'} {selectedMember.user.name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'الدور الجديد' : 'New Role'}</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter(r => r.value !== 'owner').map(role => (
                    <SelectItem key={role.value} value={role.value}>
                      <div className="flex items-center gap-2">
                        {role.icon}
                        <span>{locale === 'ar' ? role.labelAr : role.label}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button 
              onClick={handleUpdateRole}
              disabled={updateRoleMutation.isPending}
              data-testid="button-confirm-update"
            >
              {updateRoleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === 'ar' ? 'تحديث' : 'Update Role'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'مصفوفة الصلاحيات' : 'Permissions Matrix'}</DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'الصلاحيات المتاحة لكل دور'
                : 'Available permissions for each role'}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{locale === 'ar' ? 'الصلاحية' : 'Permission'}</TableHead>
                  {ROLES.map(role => (
                    <TableHead key={role.value} className="text-center">
                      {locale === 'ar' ? role.labelAr : role.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROLE_PERMISSIONS.map(permission => (
                  <TableRow key={permission.key}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {permission.icon}
                        {locale === 'ar' ? permission.labelAr : permission.label}
                      </div>
                    </TableCell>
                    {ROLES.map(role => (
                      <TableCell key={role.value} className="text-center">
                        {permission.roles.includes(role.value) ? (
                          <Check className="w-4 h-4 mx-auto text-green-600" />
                        ) : (
                          <X className="w-4 h-4 mx-auto text-muted-foreground" />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPermissionsDialogOpen(false)}>
              {locale === 'ar' ? 'إغلاق' : 'Close'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
