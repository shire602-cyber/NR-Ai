import { DatePicker } from "@/components/ui/date-picker";
import { displayObligationTitle, formatDate } from "@/lib/format-date";
import { localizeServerText } from "@shared/server-copy";
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import { T } from "@/components/layout/T";
import { useQuery, useMutation } from "@tanstack/react-query";
import { parseISO, differenceInDays, isBefore } from "date-fns";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Search, Calendar, Loader2, ListTodo, MoreHorizontal, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  /** W4-A (R13-34): generated from the compliance calendar, not a manual task. */
  generated?: boolean;
  statusDerived?: boolean;
  legalSource?: string | null;
}

interface CalendarObligation {
  id: string;
  source: "manual" | "generated";
  obligationType: string | null;
  title: string;
  titleAr: string | null;
  dueDate: string;
  status: "upcoming" | "completed" | "overdue" | "dismissed";
  statusDerived: boolean;
  legalSource: string | null;
  description: string;
  completedAt: string | null;
}

function obligationTaskCategory(type: string | null): string {
  if (type === "vat_return") return "vat_filing";
  if (type === "corporate_tax_return" || type === "ct_registration") return "corporate_tax";
  if (type === "wps_payroll" || type === "excise_return") return "payment";
  return "other";
}

function obligationToTask(o: CalendarObligation, companyId: string): ComplianceTask {
  return {
    id: o.id,
    companyId,
    title: o.title,
    titleAr: o.titleAr,
    description: o.legalSource,
    category: obligationTaskCategory(o.obligationType),
    priority: o.status === "overdue" ? "urgent" : "high",
    status: o.status === "completed" ? "completed" : "pending",
    dueDate: o.dueDate,
    reminderDate: null,
    isRecurring: false,
    recurrencePattern: null,
    completedAt: o.completedAt,
    notes: null,
    createdAt: o.dueDate,
    generated: true,
    statusDerived: o.statusDerived,
    legalSource: o.legalSource,
  };
}

const CATEGORIES = [
  { value: "vat_filing", labelEn: "VAT Filing", labelAr: "إقرار ضريبة القيمة المضافة" },
  { value: "corporate_tax", labelEn: "Corporate Tax", labelAr: "ضريبة الشركات" },
  { value: "document_upload", labelEn: "Document Upload", labelAr: "رفع مستند" },
  { value: "payment", labelEn: "Payment", labelAr: "دفع" },
  { value: "review", labelEn: "Review", labelAr: "مراجعة" },
  { value: "other", labelEn: "Other", labelAr: "أخرى" },
];

const PRIORITIES = [
  { value: "low", labelEn: "Low", labelAr: "منخفض", color: "bg-muted text-foreground" },
  {
    value: "medium",
    labelEn: "Medium",
    labelAr: "متوسط",
    color: "bg-info-subtle text-info-subtle-foreground",
  },
  {
    value: "high",
    labelEn: "High",
    labelAr: "مرتفع",
    color: "bg-warning-subtle text-warning-subtle-foreground",
  },
  {
    value: "urgent",
    labelEn: "Urgent",
    labelAr: "عاجل",
    color: "bg-danger-subtle text-danger-subtle-foreground",
  },
];

/**
 * Spec 3.15 (WP-D): the task centre is the "List" view of the compliance calendar (same
 * obligations and tasks). /task-center stays as a redirect.
 */
export default function TaskCenter() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/compliance-calendar?view=list", { replace: true });
  }, [navigate]);
  return <Skeleton className="h-96 w-full" />;
}

export function TaskListPanel() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  // X4 (J3): mark a generated obligation "not applicable" (e.g. before the company used
  // Muhasib, filed elsewhere) with an audited note.
  const [naTask, setNaTask] = useState<ComplianceTask | null>(null);
  const [naNote, setNaNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newTask, setNewTask] = useState({
    title: "",
    titleAr: "",
    description: "",
    category: "other",
    priority: "medium",
    dueDate: "",
    reminderDate: "",
    isRecurring: false,
    recurrencePattern: "",
    notes: "",
  });

  const { data: manualTasks, isLoading } = useQuery<ComplianceTask[]>({
    queryKey: ["/api/companies", companyId, "compliance-tasks"],
    enabled: !!companyId,
  });
  // R13-34: generated obligations (VAT, CT, UBO, licence, excise, e-invoicing,
  // WPS) appear alongside manual tasks.
  const { data: obligations } = useQuery<CalendarObligation[]>({
    queryKey: ["/api/companies", companyId, "compliance-calendar"],
    enabled: !!companyId,
  });
  const tasks = useMemo<ComplianceTask[]>(
    () => [
      ...(manualTasks ?? []),
      ...(obligations ?? [])
        .filter((o) => o.source === "generated" && o.status !== "dismissed")
        .map((o) => obligationToTask(o, companyId ?? "")),
    ],
    [manualTasks, obligations, companyId]
  );

  const obligationMutation = useMutation({
    mutationFn: ({
      id,
      status,
      note,
    }: {
      id: string;
      status: "completed" | "upcoming" | "dismissed";
      note?: string;
    }) =>
      apiRequest("PATCH", `/api/companies/${companyId}/compliance-calendar/${id}`, {
        status,
        ...(note ? { note } : {}),
      }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "compliance-calendar"],
      });
      if (vars.status === "dismissed") {
        setNaTask(null);
        setNaNote("");
        toast({ title: t["compliance.markedNotApplicable"] });
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: t["compliance.updateFailed"],
        description: error?.message,
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof newTask) =>
      apiRequest("POST", `/api/companies/${companyId}/compliance-tasks`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "compliance-tasks"],
      });
      toast({
        title: locale === "ar" ? "تمت الإضافة" : "Task created",
        description:
          locale === "ar" ? "تم إنشاء المهمة بنجاح" : "Task has been created successfully",
      });
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: locale === "ar" ? "فشل الإنشاء" : "Creation failed",
        description: error?.message,
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string }) =>
      apiRequest("PATCH", `/api/compliance-tasks/${taskId}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "compliance-tasks"],
      });
      toast({
        title: locale === "ar" ? "تم التحديث" : "Updated",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => apiRequest("DELETE", `/api/compliance-tasks/${taskId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/companies", companyId, "compliance-tasks"],
      });
      toast({
        title: locale === "ar" ? "تم الحذف" : "Deleted",
      });
    },
  });

  const resetForm = () => {
    setNewTask({
      title: "",
      titleAr: "",
      description: "",
      category: "other",
      priority: "medium",
      dueDate: "",
      reminderDate: "",
      isRecurring: false,
      recurrencePattern: "",
      notes: "",
    });
  };

  const handleSubmit = async () => {
    if (!newTask.title || !newTask.dueDate) {
      toast({
        variant: "destructive",
        title: locale === "ar" ? "معلومات ناقصة" : "Missing information",
        description:
          locale === "ar"
            ? "يرجى إدخال العنوان وتاريخ الاستحقاق"
            : "Please enter title and due date",
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
    if (task.status === "completed") return "completed";
    if (isBefore(parseISO(task.dueDate), new Date())) return "overdue";
    const daysLeft = differenceInDays(parseISO(task.dueDate), new Date());
    if (daysLeft <= 3) return "due_soon";
    return "pending";
  };

  const filteredTasks =
    tasks
      ?.filter((task) => {
        if (statusFilter === "active" && task.status === "completed") return false;
        if (statusFilter === "completed" && task.status !== "completed") return false;
        if (statusFilter === "overdue" && getTaskStatus(task) !== "overdue") return false;
        if (categoryFilter !== "all" && task.category !== categoryFilter) return false;
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          return (
            task.title.toLowerCase().includes(query) ||
            (task.generated ? localizeServerText(task.description, t) : task.description)
              ?.toLowerCase()
              .includes(query)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (a.status === "completed" && b.status !== "completed") return 1;
        if (a.status !== "completed" && b.status === "completed") return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }) || [];

  const stats = {
    open: tasks?.filter((t) => t.status !== "completed").length || 0,
    dueThisWeek:
      tasks?.filter((t) => {
        if (t.status === "completed") return false;
        const days = differenceInDays(parseISO(t.dueDate), new Date());
        return days >= 0 && days <= 7;
      }).length || 0,
    total: tasks?.length || 0,
    pending: tasks?.filter((t) => t.status === "pending").length || 0,
    completed: tasks?.filter((t) => t.status === "completed").length || 0,
    overdue: tasks?.filter((t) => getTaskStatus(t) === "overdue").length || 0,
  };

  if (isLoadingCompany || isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={locale === "ar" ? "مفتوحة" : "Open"}
          value={stats.open}
          testId="stat-tasks-open"
        />
        <StatCard
          label={t["compliance.tasksDueThisWeek"]}
          value={stats.dueThisWeek}
          testId="stat-tasks-due-week"
        />
        <StatCard
          label={locale === "ar" ? "متأخرة" : "Overdue"}
          value={stats.overdue}
          testId="stat-tasks-overdue"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder={locale === "ar" ? "بحث في المهام..." : "Search tasks..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ps-10"
                data-testid="input-search-tasks"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-task">
                <Plus className="w-4 h-4 me-2" />
                {t["pages.taskCenterNewTask"]}
              </Button>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger
                  className="w-[160px]"
                  aria-label={t["pages.category"]}
                  data-testid="select-category-filter"
                >
                  <SelectValue placeholder={locale === "ar" ? "الفئة" : "Category"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t["pages.taskCenterAllCategories"]}</SelectItem>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {locale === "ar" ? cat.labelAr : cat.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label={t["pages.status"]}
            data-testid="select-status-filter"
          >
            {(
              [
                ["active", locale === "ar" ? "نشطة" : "Active"],
                ["overdue", locale === "ar" ? "متأخرة" : "Overdue"],
                ["completed", locale === "ar" ? "مكتملة" : "Completed"],
                ["all", locale === "ar" ? "الكل" : "All"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                aria-pressed={statusFilter === value}
                className="h-8 rounded-full"
                onClick={() => setStatusFilter(value)}
                data-testid={`chip-task-status-${value}`}
              >
                {label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {filteredTasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ListTodo className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>{t["pages.taskCenterNoTasksFound"]}</p>
              <Button variant="ghost" onClick={() => setAddDialogOpen(true)}>
                {t["pages.taskCenterCreateYourFirstTask"]}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTasks.map((task) => {
                const status = getTaskStatus(task);
                const category = CATEGORIES.find((c) => c.value === task.category);
                const daysLeft = differenceInDays(parseISO(task.dueDate), new Date());

                return (
                  <div
                    key={task.id}
                    className={cn(
                      "relative flex items-center gap-4 border-b border-border/70 py-3 pe-2 ps-4 last:border-b-0",
                      task.status === "completed" && "opacity-60",
                      status === "overdue" &&
                        "before:absolute before:inset-y-2 before:start-0 before:w-0.5 before:rounded-full before:bg-danger"
                    )}
                    data-testid={`task-${task.id}`}
                  >
                    <Checkbox
                      aria-label={displayObligationTitle(
                        locale === "ar" && task.titleAr ? task.titleAr : task.title,
                        locale
                      )}
                      checked={task.status === "completed"}
                      disabled={task.statusDerived === true}
                      title={task.statusDerived ? t["compliance.statusFollowsReturn"] : undefined}
                      onCheckedChange={(checked) => {
                        if (task.generated) {
                          obligationMutation.mutate({
                            id: task.id,
                            status: checked ? "completed" : "upcoming",
                          });
                          return;
                        }
                        updateStatusMutation.mutate({
                          taskId: task.id,
                          status: checked ? "completed" : "pending",
                        });
                      }}
                      data-testid={`checkbox-task-${task.id}`}
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-medium ${task.status === "completed" ? "line-through" : ""}`}
                        >
                          {displayObligationTitle(
                            locale === "ar" && task.titleAr ? task.titleAr : task.title,
                            locale
                          )}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {locale === "ar" ? category?.labelAr : category?.labelEn}
                        </Badge>
                        {task.generated && (
                          <span className="text-caption text-muted-foreground">
                            <T k="compliance.generatedBadge" />
                          </span>
                        )}
                      </div>
                      {task.description && (
                        <p className="text-sm text-muted-foreground truncate mt-1">
                          {task.generated
                            ? localizeServerText(task.description, t)
                            : task.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-end">
                        <div
                          className={cn(
                            "flex items-center gap-1 text-sm tabular-nums",
                            status === "overdue" && "text-danger"
                          )}
                        >
                          <Calendar className="w-3 h-3" aria-hidden />
                          {formatDate(task.dueDate.slice(0, 10), locale)}
                        </div>
                        {task.status !== "completed" && (
                          <StatusBadge
                            tone={
                              status === "overdue"
                                ? "danger"
                                : daysLeft <= 3
                                  ? "warning"
                                  : "neutral"
                            }
                            className="text-xs mt-1"
                          >
                            {status === "overdue"
                              ? locale === "ar"
                                ? "متأخر"
                                : "Overdue"
                              : daysLeft === 0
                                ? locale === "ar"
                                  ? "اليوم"
                                  : "Today"
                                : locale === "ar"
                                  ? `${daysLeft} يوم`
                                  : `${daysLeft}d left`}
                          </StatusBadge>
                        )}
                      </div>

                      {task.generated && task.status !== "completed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`button-task-na-${task.id}`}
                          onClick={() => {
                            setNaNote("");
                            setNaTask(task);
                          }}
                        >
                          {t["compliance.notApplicable"]}
                        </Button>
                      )}
                      {!task.generated && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                if (
                                  confirm(
                                    locale === "ar"
                                      ? "هل أنت متأكد من الحذف؟"
                                      : "Are you sure you want to delete?"
                                  )
                                ) {
                                  deleteMutation.mutate(task.id);
                                }
                              }}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 me-2" />
                              {locale === "ar" ? "حذف" : "Delete"}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
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
            <DialogTitle>{t["pages.taskCenterNewTask"]}</DialogTitle>
            <DialogDescription>
              {t["pages.taskCenterCreateANewComplianceTaskWith"]}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === "ar" ? "العنوان (إنجليزي)" : "Title (English)"} *</Label>
                <Input
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  placeholder={t["pages.taskCenterTitlePlaceholder"]}
                  data-testid="input-task-title"
                />
              </div>
              <div className="space-y-2">
                <Label>{locale === "ar" ? "العنوان (عربي)" : "Title (Arabic)"}</Label>
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
              <Label>{locale === "ar" ? "الوصف" : "Description"}</Label>
              <Textarea
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                placeholder={locale === "ar" ? "تفاصيل المهمة..." : "Task details..."}
                data-testid="input-task-description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{locale === "ar" ? "الفئة" : "Category"}</Label>
                <Select
                  value={newTask.category}
                  onValueChange={(val) => setNewTask({ ...newTask, category: val })}
                >
                  <SelectTrigger
                    aria-label={t["pages.category"]}
                    data-testid="select-task-category"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {locale === "ar" ? cat.labelAr : cat.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{locale === "ar" ? "الأولوية" : "Priority"}</Label>
                <Select
                  value={newTask.priority}
                  onValueChange={(val) => setNewTask({ ...newTask, priority: val })}
                >
                  <SelectTrigger
                    aria-label={t["pages.priority"]}
                    data-testid="select-task-priority"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {locale === "ar" ? p.labelAr : p.labelEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t["pages.taskCenterDueDate"]} *</Label>
                <DatePicker
                  value={newTask.dueDate}
                  onChange={(value) => setNewTask({ ...newTask, dueDate: value })}
                  data-testid="input-due-date"
                />
              </div>
              <div className="space-y-2">
                <Label>{t["pages.taskCenterReminderDate"]}</Label>
                <DatePicker
                  value={newTask.reminderDate}
                  onChange={(value) => setNewTask({ ...newTask, reminderDate: value })}
                  data-testid="input-reminder-date"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>{locale === "ar" ? "ملاحظات" : "Notes"}</Label>
              <Textarea
                value={newTask.notes}
                onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })}
                placeholder={locale === "ar" ? "ملاحظات إضافية..." : "Additional notes..."}
                data-testid="input-task-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false);
                resetForm();
              }}
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              data-testid="button-confirm-create"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 me-2 animate-spin" />}
              {locale === "ar" ? "إنشاء" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!naTask} onOpenChange={(o) => !o && setNaTask(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{t["compliance.notApplicable"]}</DialogTitle>
            <DialogDescription>{t["compliance.notApplicableHint"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="task-na-note">{t["compliance.notApplicableReason"]}</Label>
            <Textarea
              id="task-na-note"
              value={naNote}
              onChange={(e) => setNaNote(e.target.value)}
              data-testid="input-task-na-note"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaTask(null)}>
              {t["compliance.cancelAction"]}
            </Button>
            <Button
              disabled={naNote.trim().length < 3 || obligationMutation.isPending}
              onClick={() =>
                naTask &&
                obligationMutation.mutate({
                  id: naTask.id,
                  status: "dismissed",
                  note: naNote.trim(),
                })
              }
              data-testid="button-task-na-confirm"
            >
              {t["compliance.notApplicable"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
