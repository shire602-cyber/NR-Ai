import { Card,CardContent } from '@/components/ui/card';
import { apiRequest } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Loader2,MessageSquare } from 'lucide-react';

export default function PortalMessages() {
  const { data: messages = [], isLoading } = useQuery<any[]>({
    queryKey: ['portal-messages'],
    queryFn: () => apiRequest('GET', '/api/client-portal/messages'),
  });

  const sorted = [...messages].sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Messages</h2>
        <p className="text-sm text-gray-500 mt-1">Messages from your NR Accounting team.</p>
      </div>

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
