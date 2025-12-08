import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest } from '@/lib/queryClient';
import { getAuthHeaders } from '@/lib/auth';
import { apiUrl } from '@/lib/api';
import { 
  Send, 
  Bot, 
  User,
  Loader2,
  Settings,
  History,
  Sparkles,
  ChevronDown,
  X,
  Clock,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  model?: string;
  streaming?: boolean;
  error?: boolean; // Indicates if the message has an error
}

interface Conversation {
  id: string;
  prompt: string;
  response: string;
  model: string;
  createdAt: Date;
}

export default function AIChat() {
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [model, setModel] = useState<'gpt-3.5-turbo' | 'gpt-4' | 'gpt-4-turbo'>('gpt-3.5-turbo');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [useCustomSystemPrompt, setUseCustomSystemPrompt] = useState(false);
  const [streaming, setStreaming] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    // ScrollArea wraps the viewport, so the ref points to Root, not the scrollable Viewport
    // We need to find the actual scrollable viewport element inside ScrollArea
    if (scrollRef.current) {
      // Radix UI ScrollArea structure: Root > Viewport (scrollable) > children
      // Find the viewport element - it's typically the first child div
      const rootElement = scrollRef.current as HTMLElement;
      const viewport = rootElement.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement ||
                      Array.from(rootElement.children).find(
                        (child): child is HTMLElement => 
                          child instanceof HTMLElement && 
                          child.scrollHeight > child.clientHeight
                      ) as HTMLElement;
      
      if (viewport) {
        // Directly scroll the viewport to bottom
        viewport.scrollTop = viewport.scrollHeight;
      } else {
        // Fallback: Use scrollIntoView on the last message element
        // This scrolls the element into view within its scrollable ancestor
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Fetch conversation history
  const { data: history, refetch: refetchHistory } = useQuery<Conversation[]>({
    queryKey: ['/api/ask/history', companyId],
    queryFn: async () => {
      const params = companyId ? `?companyId=${companyId}` : '';
      return apiRequest('GET', `/api/ask/history${params}`);
    },
    enabled: showHistory,
  });

  // Streaming mutation
  const streamMutation = useMutation({
    mutationFn: async (message: string) => {
      abortControllerRef.current = new AbortController();
      const response = await fetch(apiUrl('/api/ask'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          message,
          companyId: companyId || undefined,
          model,
          systemPrompt: useCustomSystemPrompt ? systemPrompt : undefined,
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to get response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage = '';
      const messageId = `assistant-${Date.now()}`;

      // Add streaming message placeholder
      setMessages(prev => [...prev, {
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        model,
        streaming: true,
        error: false,
      }]);

      if (!reader) throw new Error('No reader available');

      // Buffer for incomplete SSE messages
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are delimited by double newlines
        const messages = buffer.split('\n\n');
        
        // Keep the last incomplete message in buffer
        buffer = messages.pop() || '';

        // Process complete SSE messages
        for (const message of messages) {
          const lines = message.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  assistantMessage += data.content;
                  setMessages(prev => prev.map(msg => 
                    msg.id === messageId 
                      ? { ...msg, content: assistantMessage }
                      : msg
                  ));
                }
                if (data.done) {
                  setMessages(prev => prev.map(msg => 
                    msg.id === messageId 
                      ? { ...msg, streaming: false }
                      : msg
                  ));
                  refetchHistory();
                }
              } catch (e) {
                // Ignore parse errors for malformed JSON
                console.warn('Failed to parse SSE data:', e);
              }
            }
          }
        }
      }

      // Process any remaining buffered data
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantMessage += data.content;
                setMessages(prev => prev.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, content: assistantMessage }
                    : msg
                ));
              }
              if (data.done) {
                setMessages(prev => prev.map(msg => 
                  msg.id === messageId 
                    ? { ...msg, streaming: false }
                    : msg
                ));
                refetchHistory();
              }
            } catch (e) {
              console.warn('Failed to parse final SSE data:', e);
            }
          }
        }
      }

      return assistantMessage;
    },
    onError: (error: any) => {
      if (error.name === 'AbortError') {
        toast({
          title: 'Request cancelled',
          description: 'The request was cancelled.',
        });
        // For cancelled requests, remove the streaming message
        setMessages(prev => prev.filter(msg => msg.streaming !== true));
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: error.message || 'Failed to get response',
        });
        // Preserve partial content but mark message as error and stop streaming
        setMessages(prev => prev.map(msg => 
          msg.streaming === true
            ? { 
                ...msg, 
                streaming: false, 
                error: true,
                content: msg.content || 'Error: Failed to get response. ' + (error.message || 'Unknown error occurred.')
              }
            : msg
        ));
      }
    },
  });

  // Non-streaming mutation
  const nonStreamMutation = useMutation({
    mutationFn: async (message: string) => {
      return apiRequest('POST', '/api/ask', {
        message,
        companyId: companyId || undefined,
        model,
        systemPrompt: useCustomSystemPrompt ? systemPrompt : undefined,
        stream: false,
      });
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        timestamp: new Date(data.timestamp),
        model: data.model,
      }]);
      refetchHistory();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to get response',
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streamMutation.isPending || nonStreamMutation.isPending) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = input;
    setInput('');

    if (streaming) {
      streamMutation.mutate(messageText);
    } else {
      nonStreamMutation.mutate(messageText);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const loadFromHistory = (conversation: Conversation) => {
    setMessages([
      {
        id: `user-${conversation.id}`,
        role: 'user',
        content: conversation.prompt,
        timestamp: new Date(conversation.createdAt),
      },
      {
        id: `assistant-${conversation.id}`,
        role: 'assistant',
        content: conversation.response,
        timestamp: new Date(conversation.createdAt),
        model: conversation.model,
      },
    ]);
    setShowHistory(false);
  };

  const isPending = streamMutation.isPending || nonStreamMutation.isPending;

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-8rem)]">
        {/* Main Chat Area */}
        <Card className="flex-1 flex flex-col animate-fade-in">
          <CardHeader className="flex-shrink-0 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle>AI Assistant</CardTitle>
                <Badge variant="outline" className="ml-2">{model}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory(!showHistory)}
                >
                  <History className="h-4 w-4 mr-2" />
                  History
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSettings(!showSettings)}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Button>
              </div>
            </div>
            <CardDescription>
              Ask questions about your accounting and financial management
            </CardDescription>
          </CardHeader>

          {/* Settings Panel */}
          {showSettings && (
            <div className="border-b p-4 bg-muted/50 animate-slide-down">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="model">Model</Label>
                  <Select value={model} onValueChange={(v: any) => setModel(v)}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo (Fast & Cheap)</SelectItem>
                      <SelectItem value="gpt-4">GPT-4 (More Capable)</SelectItem>
                      <SelectItem value="gpt-4-turbo">GPT-4 Turbo (Balanced)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="streaming">Streaming Response</Label>
                  <Switch
                    id="streaming"
                    checked={streaming}
                    onCheckedChange={setStreaming}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="custom-prompt">Custom System Prompt</Label>
                  <Switch
                    id="custom-prompt"
                    checked={useCustomSystemPrompt}
                    onCheckedChange={setUseCustomSystemPrompt}
                  />
                </div>
                {useCustomSystemPrompt && (
                  <div>
                    <Label htmlFor="system-prompt">System Prompt</Label>
                    <Textarea
                      id="system-prompt"
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="Enter custom system prompt..."
                      rows={3}
                      className="mt-2"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Messages */}
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.length === 0 && (
                <div className="text-center py-12 text-muted-foreground animate-fade-in">
                  <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Start a conversation by asking a question</p>
                </div>
              )}
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-3 animate-slide-up",
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-4 py-2 max-w-[80%] animate-fade-in",
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : message.error
                        ? 'bg-destructive/10 border border-destructive/20 text-destructive'
                        : 'bg-muted'
                    )}
                  >
                    {message.error && (
                      <div className="flex items-center gap-2 mb-2 text-destructive text-sm font-medium">
                        <X className="h-4 w-4" />
                        Error occurred
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">
                      {message.content || (message.streaming && (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Thinking...
                        </span>
                      ))}
                    </div>
                    <div className="text-xs opacity-70 mt-1 flex items-center gap-2">
                      <Clock className="h-3 w-3" />
                      {message.timestamp.toLocaleTimeString()}
                      {message.model && (
                        <Badge variant="outline" className="text-xs">{message.model}</Badge>
                      )}
                    </div>
                  </div>
                  {message.role === 'user' && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}
              {/* Invisible element at the end to scroll to */}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          {/* Input Form */}
          <div className="flex-shrink-0 border-t p-4">
            <form onSubmit={handleSubmit} className="space-y-2">
              <div className="flex gap-2">
                <Textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question..."
                  rows={2}
                  className="resize-none"
                  disabled={isPending}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSubmit(e);
                    }
                  }}
                />
                <div className="flex flex-col gap-2">
                  <Button
                    type="submit"
                    disabled={!input.trim() || isPending}
                    size="icon"
                    className="h-full"
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                  {isPending && streaming && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      onClick={handleStop}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </Card>

        {/* History Sidebar */}
        {showHistory && (
          <Card className="w-full lg:w-80 flex-shrink-0 animate-slide-in-right">
            <CardHeader className="flex-shrink-0 border-b">
              <div className="flex items-center justify-between">
                <CardTitle>History</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <ScrollArea className="flex-1 p-4">
              {history ? (
                history.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No conversation history</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((conv) => (
                      <Card
                        key={conv.id}
                        className="cursor-pointer hover:bg-muted/50 transition-colors animate-fade-in"
                        onClick={() => loadFromHistory(conv)}
                      >
                        <CardContent className="p-3">
                          <p className="text-sm line-clamp-2 mb-2">{conv.prompt}</p>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{new Date(conv.createdAt).toLocaleDateString()}</span>
                            <Badge variant="outline" className="text-xs">{conv.model}</Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20" />
                  ))}
                </div>
              )}
            </ScrollArea>
          </Card>
        )}
      </div>
    </div>
  );
}

