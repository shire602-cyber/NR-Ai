import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import { apiRequest } from '@/lib/queryClient';
import { 
  MessageCircle, 
  Send, 
  Sparkles, 
  TrendingUp, 
  TrendingDown,
  DollarSign, 
  FileText, 
  Loader2,
  Receipt,
  Lightbulb,
  HelpCircle,
  ChevronRight,
  Bot,
  User
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  intent?: string;
  followUpPrompts?: string[];
}

interface NLGatewayResponse {
  response: string;
  intent: string;
  data: {
    summary: {
      totalRevenue: number;
      totalExpenses: number;
      invoicesSummary: {
        total: number;
        paid: number;
        pending: number;
        outstandingValue: number;
      };
      expensesSummary: {
        total: number;
        pending: number;
        totalAmount: number;
      };
    };
  };
  followUpPrompts: string[];
  timestamp: string;
}

export default function SmartAssistant() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Get quick stats
  const { data: stats } = useQuery<{
    revenue: number;
    expenses: number;
    outstanding: number;
    totalInvoices: number;
    totalEntries: number;
  }>({
    queryKey: ['/api/companies', companyId, 'dashboard/stats'],
    enabled: !!companyId,
  });

  const nlMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest('POST', '/api/ai/nl-gateway', {
        companyId,
        message,
        locale,
      });
      return response as NLGatewayResponse;
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        timestamp: new Date(data.timestamp),
        intent: data.intent,
        followUpPrompts: data.followUpPrompts,
      }]);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to process your question',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || nlMutation.isPending) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    nlMutation.mutate(input);
  };

  const handleQuickQuestion = (question: string) => {
    if (nlMutation.isPending) return;
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    nlMutation.mutate(question);
  };

  const quickQuestions = [
    { icon: DollarSign, text: "What were our total sales this month?", color: "text-green-600 dark:text-green-400" },
    { icon: Receipt, text: "Show me pending invoices", color: "text-orange-600 dark:text-orange-400" },
    { icon: TrendingUp, text: "What's my profit margin?", color: "text-blue-600 dark:text-blue-400" },
    { icon: TrendingDown, text: "What are my biggest expenses?", color: "text-red-600 dark:text-red-400" },
    { icon: FileText, text: "How many invoices are unpaid?", color: "text-purple-600 dark:text-purple-400" },
    { icon: Lightbulb, text: "Give me financial insights", color: "text-yellow-600 dark:text-yellow-400" },
  ];

  const arabicQuickQuestions = [
    { icon: DollarSign, text: "ما هو إجمالي مبيعاتنا هذا الشهر؟", color: "text-green-600 dark:text-green-400" },
    { icon: Receipt, text: "أرني الفواتير المعلقة", color: "text-orange-600 dark:text-orange-400" },
    { icon: TrendingUp, text: "ما هو هامش الربح الخاص بي؟", color: "text-blue-600 dark:text-blue-400" },
    { icon: TrendingDown, text: "ما هي أكبر نفقاتي؟", color: "text-red-600 dark:text-red-400" },
    { icon: FileText, text: "كم عدد الفواتير غير المدفوعة؟", color: "text-purple-600 dark:text-purple-400" },
    { icon: Lightbulb, text: "أعطني رؤى مالية", color: "text-yellow-600 dark:text-yellow-400" },
  ];

  const displayQuestions = locale === 'ar' ? arabicQuickQuestions : quickQuestions;

  return (
    <div className="h-full flex flex-col max-h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-smart-assistant-title">
              {locale === 'ar' ? 'المساعد الذكي' : 'Smart Assistant'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {locale === 'ar' 
                ? 'اسأل أي شيء عن بياناتك المالية باللغة الطبيعية'
                : 'Ask anything about your financial data in plain English'}
            </p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      {stats && messages.length === 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs font-medium">{locale === 'ar' ? 'الإيرادات' : 'Revenue'}</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1">
                {formatCurrency(stats.revenue || 0, 'AED')}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <TrendingDown className="w-4 h-4" />
                <span className="text-xs font-medium">{locale === 'ar' ? 'المصروفات' : 'Expenses'}</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1">
                {formatCurrency(stats.expenses || 0, 'AED')}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-900">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs font-medium">{locale === 'ar' ? 'المستحق' : 'Outstanding'}</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1">
                {formatCurrency(stats.outstanding || 0, 'AED')}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                <FileText className="w-4 h-4" />
                <span className="text-xs font-medium">{locale === 'ar' ? 'الفواتير' : 'Invoices'}</span>
              </div>
              <p className="text-lg font-bold font-mono mt-1">
                {stats.totalInvoices}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chat Area */}
      <Card className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="space-y-6">
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-lg font-medium mb-2">
                  {locale === 'ar' ? 'مرحباً! كيف يمكنني مساعدتك اليوم؟' : "Hi! How can I help you today?"}
                </h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  {locale === 'ar' 
                    ? 'اسألني عن المبيعات، المصروفات، الفواتير، أو أي بيانات مالية أخرى.'
                    : "Ask me about sales, expenses, invoices, or any other financial data."}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {displayQuestions.map((q, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="justify-start h-auto py-3 px-4 text-left hover-elevate"
                    onClick={() => handleQuickQuestion(q.text)}
                    disabled={nlMutation.isPending}
                    data-testid={`button-quick-question-${i}`}
                  >
                    <q.icon className={`w-4 h-4 mr-3 flex-shrink-0 ${q.color}`} />
                    <span className="text-sm">{q.text}</span>
                    <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground" />
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg p-3 ${
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    {message.role === 'assistant' && message.intent && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        {message.intent === 'query' && (locale === 'ar' ? 'استعلام' : 'Query')}
                        {message.intent === 'advice' && (locale === 'ar' ? 'نصيحة' : 'Advice')}
                        {message.intent === 'action' && (locale === 'ar' ? 'إجراء' : 'Action')}
                      </Badge>
                    )}
                    {message.followUpPrompts && message.followUpPrompts.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-muted-foreground mb-2">
                          {locale === 'ar' ? 'متابعة مقترحة:' : 'Suggested follow-ups:'}
                        </p>
                        {message.followUpPrompts.map((prompt, i) => (
                          <Button
                            key={i}
                            variant="ghost"
                            size="sm"
                            className="h-auto py-1 px-2 text-xs justify-start w-full"
                            onClick={() => handleQuickQuestion(prompt)}
                            disabled={nlMutation.isPending}
                          >
                            <Lightbulb className="w-3 h-3 mr-2 text-yellow-500" />
                            {prompt}
                          </Button>
                        ))}
                      </div>
                    )}
                    <p className="text-xs opacity-60 mt-2">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {nlMutation.isPending && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                  <div className="bg-muted rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm text-muted-foreground">
                        {locale === 'ar' ? 'جاري التحليل...' : 'Analyzing...'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <Separator />

        {/* Input Area */}
        <form onSubmit={handleSubmit} className="p-4">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={locale === 'ar' 
                ? 'اكتب سؤالك هنا... مثال: "ما هو إجمالي المبيعات هذا الشهر؟"'
                : 'Type your question... e.g., "What were our total sales this month?"'}
              disabled={nlMutation.isPending}
              className="flex-1"
              data-testid="input-smart-assistant-message"
            />
            <Button 
              type="submit" 
              disabled={nlMutation.isPending || !input.trim()}
              data-testid="button-send-message"
            >
              {nlMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {locale === 'ar' 
              ? 'اضغط Enter للإرسال • يدعم اللغتين العربية والإنجليزية'
              : 'Press Enter to send • Supports both English and Arabic'}
          </p>
        </form>
      </Card>
    </div>
  );
}
