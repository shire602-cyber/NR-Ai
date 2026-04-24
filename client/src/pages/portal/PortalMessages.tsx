import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, MessageSquare, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function PortalMessages() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');

  const { data: messages = [], isLoading } = useQuery<any[]>({
    queryKey: ['portal-messages'],
    queryFn: () => apiRequest('GET', '/api/client-portal/messages'),
  });

  const sendMutation = useMutation({
    mutationFn: (payload: any) => apiRequest('POST', '/api/client-portal/messages', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-messages'] });
      setSubject('');
      setContent('');
      toast({ title: 'Message sent', description: 'NR Accounting will respond shortly.' });
    },
    onError: (e: any) => toast({ title: 'Failed to send', description: e.message, variant: 'destructive' }),
  });

  function handleSend() {
    if (!content.trim()) return;
    sendMutation.mutate({ subject: subject.trim() || null, content: content.trim() });
  }

  const sorted = [...messages].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Messages</h2>
        <p className="text-sm text-gray-500 mt-1">Communicate with your NR Accounting team.</p>
      </div>

      {/* Compose */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">New Message</p>
          <Input
            placeholder="Subject (optional)"
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
          <Textarea
            placeholder="Write your message..."
            rows={4}
            value={content}
            onChange={e => setContent(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSend}
              disabled={!content.trim() || sendMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {sendMutation.isPending
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Send className="w-4 h-4 mr-2" />}
              Send
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Message list */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12">
              <MessageSquare className="w-9 h-9 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No messages yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sorted.map((msg: any) => (
                <div key={msg.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {msg.subject && (
                        <p className="text-sm font-semibold text-gray-900 truncate">{msg.subject}</p>
                      )}
                      <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">{msg.content}</p>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
                      {msg.createdAt ? format(new Date(msg.createdAt), 'MMM d, h:mm a') : ''}
                    </span>
                  </div>
                  {!msg.isRead && (
                    <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">Unread</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
