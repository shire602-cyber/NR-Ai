import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { format, parseISO, differenceInDays, isBefore } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { 
  Plus, 
  Search, 
  CheckCircle2, 
  Clock, 
  AlertTriangle,
  Calendar,
  Loader2,
  Filter,
  ListTodo,
  ArrowUpDown,
  MoreHorizontal,
  Trash2,
  Edit
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ComplianceTask {
  id: string;
  companyId: string;
  title: string;
  titleAr: string | null;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  dueDate: string;
  reminderDate: string | null;
  isRecurring: boolean;
  recurrencePattern: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
}

const CATEGORIES = [
  { value: 'vat_filing', labelEn: 'VAT Filing', labelAr: 'إقرار ضريبة القيمة المضافة' },
  { value: 'corporate_tax', labelEn: 'Corporate Tax', labelAr: 'ضريبة الشركات' },
  { value: 'document_upload', labelEn: 'Document Upload', labelAr: 'رفع مستند' },
  { value: 'payment', labelEn: 'Payment', labelAr: 'دفع' },
  { value: 'review', labelEn: 'Review', labelAr: 'مراجعة' },
  { value: 'other', labelEn: 'Other', labelAr: 'أخرى' },
];

const PRIORITIES = [
  { value: 'low', labelEn: 'Low', labelAr: 'منخفض', color: 'bg-gray-100 text-gray-800' },
  { value: 'medium', labelEn: 'Medium', labelAr: 'متوسط', color: 'bg-blue-100 text-blue-800' },
  { value: 'high', labelEn: 'High', labelAr: 'مرتفع', color: 'bg-orange-100 text-orange-800' },
  { value: 'urgent', labelEn: 'Urgent', labelAr: 'عاجل', color: 'bg-red-100 text-red-800' },
];

export default function TaskCenter() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    titleAr: '',
    description: '',
    category: 'other',
    priority: 'medium',
    dueDate: '',
    reminderDate: '',
    isRecurring: false,
    recurrencePattern: '',
    notes: '',
  });

  const { data: tasks, isLoading } = useQuery<ComplianceTask[]>({
    queryKey: ['/api/companies', companyId, 'compliance-tasks'],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof newTask) => 
      apiRequest('POST', `/api/companies/${companyId}/compliance-tasks`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'compliance-tasks'] });
      toast({
        title: locale === 'ar' ? 'تمت الإضافة' : 'Task Created',
        description: locale === 'ar' ? 'تم إنشاء المهمة بنجاح' : 'Task has been created successfully',
      });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: locale === 'ar' ? 'فشل الإنشاء' : 'Creation Failed',
        description: error.message,
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) => 
      apiRequest('PATCH', `/api/compliance-tasks/${taskId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'compliance-tasks'] });
      toast({
        title: locale === 'ar' ? 'تم التحديث' : 'Updated',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => 
      apiRequest('DELETE', `/api/compliance-tasks/${taskId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'compliance-tasks'] });
      toast({
        title: locale === 'ar' ? 'تم الحذف' : 'Deleted',
      });
    },
  });

  const resetForm = () => {
    setNewTask({
      title: '',
      titleAr: '',
      description: '',
      category: 'other',
      priority: 'medium',
      dueDate: '',
      reminderDate: '',
      isRecurring: false,
      recurrencePattern: '',
      notes: '',
    });
  };

  const handleSubmit = async () => {
    if (!newTask.title || !newTask.dueDate) {
      toast({
        variant: 'destructive',
        title: locale === 'ar' ? 'معلومات ناقصة' : 'Missing Information',
        description: locale === 'ar' ? 'يرجى إدخال العنوان وتاريخ الاستحقاق' : 'Please enter title and due date',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await createMutation.mutateAsync(newTask);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTaskStatus = (task: ComplianceTask) => {
    if (task.status === 'completed') return 'completed';
    if (isBefore(parseISO(task.dueDate), new Date())) return 'overdue';
    const daysLeft = differenceInDays(parseISO(task.dueDate), new Date());
    if (daysLeft <= 3) return 'due_soon';
    return 'pending';
  };

  const filteredTasks = tasks?.filter(task => {
    if (statusFilter === 'active' && task.status === 'completed') return false;
    if (statusFilter === 'completed' && task.status !== 'completed') return false;
    if (statusFilter === 'overdue' && getTaskStatus(task) !== 'overdue') return false;
    if (categoryFilter !== 'all' && task.category !== categoryFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return task.title.toLowerCase().includes(query) || 
             task.description?.toLowerCase().includes(query);
    }
    return true;
  }).sort((a, b) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1;
    if (a.status !== 'completed' && b.status === 'completed') return -1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  }) || [];

  const stats = {
    total: tasks?.length || 0,
    pending: tasks?.filter(t => t.status === 'pending').length || 0,
    completed: tasks?.filter(t => t.status === 'completed').length || 0,
    overdue: tasks?.filter(t => getTaskStatus(t) === 'overdue').length || 0,
  };

  if (isLoadingCompany || isLoading) {
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
            {locale === 'ar' ? 'مركز المهام' : 'Task Center'}
          </h1>
          <p className="text-muted-foreground">
            {locale === 'ar' 
              ? 'إدارة مهام الامتثال والتذكيرات'
              : 'Manage compliance tasks and reminders'}
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-task">
          <Plus className="w-4 h-4 mr-2" />
          {locale === 'ar' ? 'مهمة جديدة' : 'New Task'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'إجمالي المهام' : 'Total Tasks'}
            </CardTitle>
            <ListTodo className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'قيد التنفيذ' : 'Pending'}
            </CardTitle>
            <Clock className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.pending}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'مكتملة' : 'Completed'}
            </CardTitle>
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          </CardContent>
        </Card>

        <Card className={stats.overdue > 0 ? 'border-red-500' : ''}>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {locale === 'ar' ? 'متأخرة' : 'Overdue'}
            </CardTitle>
            <AlertTriangle className="w-4 h-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.overdue}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder={locale === 'ar' ? 'بحث في المهام...' : 'Search tasks...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-search-tasks"
              />
            </div>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{locale === 'ar' ? 'نشطة' : 'Active'}</SelectItem>
                  <SelectItem value="completed">{locale === 'ar' ? 'مكتملة' : 'Completed'}</SelectItem>
                  <SelectItem value="overdue">{locale === 'ar' ? 'متأخرة' : 'Overdue'}</SelectItem>
                  <SelectItem value="all">{locale === 'ar' ? 'الكل' : 'All'}</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[160px]" data-testid="select-category-filter">
                  <SelectValue placeholder={locale === 'ar' ? 'الفئة' : 'Category'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{locale === 'ar' ? 'جميع الفئات' : 'All Categories'}</SelectItem>
                  {CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {locale === 'ar' ? cat.labelAr : cat.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredTasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ListTodo className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{locale === 'ar' ? 'لا توجد مهام' : 'No tasks found'}</p>
              <Button variant="link" onClick={() => setAddDialogOpen(true)}>
                {locale === 'ar' ? 'إنشاء أول مهمة' : 'Create your first task'}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTasks.map((task) => {
                const status = getTaskStatus(task);
                const category = CATEGORIES.find(c => c.value === task.category);
                const priority = PRIORITIES.find(p => p.value === task.priority);
                const daysLeft = differenceInDays(parseISO(task.dueDate), new Date());

                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
                      task.status === 'completed' ? 'opacity-60 bg-muted/50' : 'hover-elevate'
                    } ${status === 'overdue' ? 'border-red-300 bg-red-50 dark:bg-red-950/20' : ''}`}
                    data-testid={`task-${task.id}`}
                  >
                    <Checkbox
                      checked={task.status === 'completed'}
                      onCheckedChange={(checked) => {
                        updateStatusMutation.mutate({
                          taskId: task.id,
                          status: checked ? 'completed' : 'pending',
                        });
                      }}
                      data-testid={`checkbox-task-${task.id}`}
                    />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${task.status === 'completed' ? 'line-through' : ''}`}>
                          {locale === 'ar' && task.titleAr ? task.titleAr : task.title}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {locale === 'ar' ? category?.labelAr : category?.labelEn}
                        </Badge>
                        <Badge className={`text-xs ${priority?.color}`}>
                          {locale === 'ar' ? priority?.labelAr : priority?.labelEn}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {task.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="flex items-center gap-1 text-sm">
                          <Calendar className="w-3 h-3" />
                          {format(parseISO(task.dueDate), 'MMM d, yyyy')}
                        </div>
                        {task.status !== 'completed' && (
                          <Badge 
                            variant={status === 'overdue' ? 'destructive' : daysLeft <= 3 ? 'secondary' : 'outline'}
                            className="text-xs mt-1"
                          >
                            {status === 'overdue' 
                              ? (locale === 'ar' ? 'متأخر' : 'Overdue')
                              : daysLeft === 0 
                                ? (locale === 'ar' ? 'اليوم' : 'Today')
                                : (locale === 'ar' ? `${daysLeft} يوم` : `${daysLeft}d left`)
                            }
                          </Badge>
                        )}
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              if (confirm(locale === 'ar' ? 'هل أنت متأكد من الحذف؟' : 'Are you sure you want to delete?')) {
                                deleteMutation.mutate(task.id);
                              }
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {locale === 'ar' ? 'حذف' : 'Delete'}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{locale === 'ar' ? 'مهمة جديدة' : 'New Task'}</DialogTitle>
            <DialogDescription>
              {locale === 'ar' 
                ? 'إنشاء مهمة امتثال جديدة مع تذكير'
                : 'Create a new compliance task with reminder'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'العنوان (إنجليزي)' : 'Title (English)'} *</Label>
                <Input
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  placeholder="File Q1 VAT Return"
                  data-testid="input-task-title"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'العنوان (عربي)' : 'Title (Arabic)'}</Label>
                <Input
                  value={newTask.titleAr}
                  onChange={(e) => setNewTask({ ...newTask, titleAr: e.target.value })}
                  placeholder="تقديم إقرار الربع الأول"
                  dir="rtl"
                  data-testid="input-task-title-ar"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'الوصف' : 'Description'}</Label>
              <Textarea
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder={locale === 'ar' ? 'تفاصيل المهمة...' : 'Task details...'}
                data-testid="input-task-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'الفئة' : 'Category'}</Label>
                <Select 
                  value={newTask.category} 
                  onValueChange={(val) => setNewTask({ ...newTask, category: val })}
                >
                  <SelectTrigger data-testid="select-task-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {locale === 'ar' ? cat.labelAr : cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'الأولوية' : 'Priority'}</Label>
                <Select 
                  value={newTask.priority} 
                  onValueChange={(val) => setNewTask({ ...newTask, priority: val })}
                >
                  <SelectTrigger data-testid="select-task-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p.value} value={p.value}>
                        {locale === 'ar' ? p.labelAr : p.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'تاريخ الاستحقاق' : 'Due Date'} *</Label>
                <Input
                  type="date"
                  value={newTask.dueDate}
                  onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                  data-testid="input-due-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === 'ar' ? 'تاريخ التذكير' : 'Reminder Date'}</Label>
                <Input
                  type="date"
                  value={newTask.reminderDate}
                  onChange={(e) => setNewTask({ ...newTask, reminderDate: e.target.value })}
                  data-testid="input-reminder-date"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{locale === 'ar' ? 'ملاحظات' : 'Notes'}</Label>
              <Textarea
                value={newTask.notes}
                onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })}
                placeholder={locale === 'ar' ? 'ملاحظات إضافية...' : 'Additional notes...'}
                data-testid="input-task-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddDialogOpen(false); resetForm(); }}>
              {locale === 'ar' ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="button-confirm-create">
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {locale === 'ar' ? 'إنشاء' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
