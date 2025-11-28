import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/lib/i18n';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { formatCurrency } from '@/lib/format';
import { apiRequest } from '@/lib/queryClient';
import { Bot, Send, Sparkles, TrendingUp, AlertTriangle, DollarSign, FileText, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface DashboardStats {
  revenue: number;
  expenses: number;
  outstanding: number;
  totalInvoices: number;
  totalEntries: number;
}

interface ProfitLossReport {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export default function AICFO() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  // Get financial context for AI
  const { data: stats } = useQuery<DashboardStats>({
    queryKey: ['/api/companies', companyId, 'dashboard/stats'],
    enabled: !!companyId,
  });

  const { data: profitLoss } = useQuery<ProfitLossReport>({
    queryKey: ['/api/companies', companyId, 'reports', 'pl'],
    enabled: !!companyId,
  });

  const askAICFOMutation = useMutation({
    mutationFn: async (question: string) => {
      const response = await apiRequest('POST', '/api/ai/cfo-advice', {
        companyId,
        question,
        context: {
          stats,
          profitLoss,
        },
      });
      return response;
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.advice,
        timestamp: new Date(),
      }]);
      setInput('');
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'AI CFO Error',
        description: error.message || 'Failed to get advice',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message
    setMessages(prev => [...prev, {
      role: 'user',
      content: input,
      timestamp: new Date(),
    }]);

    // Get AI response
    askAICFOMutation.mutate(input);
  };

  const quickQuestions = [
    "What are my biggest expenses this month?",
    "How can I improve my cash flow?",
    "Am I on track to meet my revenue goals?",
    "What financial risks should I be aware of?",
    "How does my profit margin compare to industry standards?",
  ];

  const handleQuickQuestion = (question: string) => {
    setInput(question);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold mb-2 flex items-center gap-3">
          <Bot className="w-8 h-8 text-primary" />
          AI CFO & Financial Advisor
        </h1>
        <p className="text-muted-foreground">
          Get real-time financial insights and strategic advice powered by AI
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Financial Overview Cards */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {stats ? (
              <>
                <div className="text-2xl font-bold font-mono">
                  {formatCurrency(stats.revenue || 0, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  From journal entries
                </p>
              </>
            ) : (
              <Skeleton className="h-8 w-32" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {profitLoss ? (
              <>
                <div className={`text-2xl font-bold font-mono ${(profitLoss.netProfit || 0) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {formatCurrency(profitLoss.netProfit || 0, 'AED')}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Revenue minus expenses
                </p>
              </>
            ) : (
              <Skeleton className="h-8 w-32" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 gap-2">
            <CardTitle className="text-sm font-medium">Journal Entries</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {stats ? (
              <>
                <div className="text-2xl font-bold font-mono">
                  {stats.totalEntries || 0}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  From {stats.totalInvoices || 0} invoices
                </p>
              </>
            ) : (
              <Skeleton className="h-8 w-32" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Chat Interface */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Ask Your AI CFO
          </CardTitle>
          <CardDescription>
            Get personalized financial advice based on your actual business data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Messages */}
          <ScrollArea className="h-[400px] pr-4">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Bot className="w-16 h-16 text-muted-foreground/50 mb-4" />
                <h3 className="font-semibold mb-2">Start a conversation</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Ask me anything about your finances. I have access to your real-time financial data.
                </p>
                <div className="space-y-2 w-full max-w-md">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Quick questions:</p>
                  {quickQuestions.slice(0, 3).map((q, i) => (
                    <Button
                      key={i}
                      variant="outline"
                      size="sm"
                      className="w-full justify-start text-left"
                      onClick={() => handleQuickQuestion(q)}
                      data-testid={`button-quick-question-${i}`}
                    >
                      {q}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-5 h-5 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-lg p-4 ${
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p className="text-xs opacity-70 mt-2">
                        {msg.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 text-primary-foreground font-semibold text-sm">
                        You
                      </div>
                    )}
                  </div>
                ))}
                {askAICFOMutation.isPending && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-5 h-5 text-primary" />
                    </div>
                    <div className="bg-muted rounded-lg p-4">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <Separator />

          {/* Input Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about cash flow, expenses, revenue trends, tax optimization, or any financial question..."
              rows={3}
              data-testid="input-cfo-question"
              disabled={askAICFOMutation.isPending}
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex flex-wrap gap-2">
                {quickQuestions.slice(3).map((q, i) => (
                  <Badge
                    key={i}
                    variant="outline"
                    className="cursor-pointer hover-elevate"
                    onClick={() => handleQuickQuestion(q)}
                  >
                    {q}
                  </Badge>
                ))}
              </div>
              <Button
                type="submit"
                disabled={!input.trim() || askAICFOMutation.isPending}
                data-testid="button-send-question"
              >
                {askAICFOMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Send
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
