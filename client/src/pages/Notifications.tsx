import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { 
  Bell, 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Clock, 
  FileText,
  Newspaper,
  ChevronRight,
  Check,
  Trash2,
  RefreshCw
} from 'lucide-react';
import type { Notification, RegulatoryNews } from '@shared/schema';

export default function Notifications() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('notifications');

  const { data: notificationsData, isLoading: notificationsLoading } = useQuery<{
    notifications: Notification[];
    unreadCount: number;
  }>({
    queryKey: ['/api/notifications'],
  });

  const { data: regulatoryNews, isLoading: newsLoading } = useQuery<RegulatoryNews[]>({
    queryKey: ['/api/regulatory-news'],
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id: string) => apiRequest('PATCH', `/api/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: () => apiRequest('POST', '/api/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      toast({ title: 'All notifications marked as read' });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiRequest('PATCH', `/api/notifications/${id}/dismiss`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      toast({ title: 'Notification dismissed' });
    },
  });

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'deadline':
      case 'payment_due':
        return <Clock className="w-5 h-5 text-amber-500" />;
      case 'overdue':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'regulatory':
        return <Newspaper className="w-5 h-5 text-blue-500" />;
      case 'referral':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'system':
        return <Bell className="w-5 h-5 text-gray-500" />;
      default:
        return <Bell className="w-5 h-5" />;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <Badge variant="destructive">Urgent</Badge>;
      case 'high':
        return <Badge className="bg-amber-500">High</Badge>;
      case 'normal':
        return <Badge variant="secondary">Normal</Badge>;
      default:
        return <Badge variant="outline">Low</Badge>;
    }
  };

  const getNewsBadge = (category: string) => {
    const colors: Record<string, string> = {
      vat: 'bg-blue-500',
      corporate_tax: 'bg-purple-500',
      customs: 'bg-green-500',
      labor: 'bg-amber-500',
      general: 'bg-gray-500',
    };
    return <Badge className={colors[category] || 'bg-gray-500'}>{category.replace('_', ' ').toUpperCase()}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Notifications & News</h1>
          <p className="text-muted-foreground">
            Stay updated with deadlines, reminders, and regulatory changes
          </p>
        </div>
        {activeTab === 'notifications' && notificationsData?.unreadCount ? (
          <Button 
            onClick={() => markAllAsReadMutation.mutate()}
            disabled={markAllAsReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            <Check className="w-4 h-4 mr-2" />
            Mark All as Read
          </Button>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="notifications" data-testid="tab-notifications">
            <Bell className="w-4 h-4 mr-2" />
            Notifications
            {notificationsData?.unreadCount ? (
              <Badge variant="destructive" className="ml-2">
                {notificationsData.unreadCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="regulatory" data-testid="tab-regulatory">
            <Newspaper className="w-4 h-4 mr-2" />
            Regulatory News
          </TabsTrigger>
        </TabsList>

        <TabsContent value="notifications" className="mt-6">
          {notificationsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : !notificationsData?.notifications?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Bell className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No notifications</h3>
                <p className="text-muted-foreground text-center">
                  You're all caught up! New notifications will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <ScrollArea className="h-[600px]">
              <div className="space-y-3">
                {notificationsData.notifications.map((notification) => (
                  <Card 
                    key={notification.id}
                    className={`transition-colors ${!notification.isRead ? 'bg-accent/50' : ''}`}
                    data-testid={`card-notification-${notification.id}`}
                  >
                    <CardContent className="flex items-start gap-4 p-4">
                      <div className="mt-1">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{notification.title}</h4>
                          {getPriorityBadge(notification.priority)}
                          {!notification.isRead && (
                            <Badge variant="outline" className="bg-blue-50">New</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{notification.message}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {notification.actionUrl && (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={notification.actionUrl}>
                              <ChevronRight className="w-4 h-4" />
                            </a>
                          </Button>
                        )}
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markAsReadMutation.mutate(notification.id)}
                            data-testid={`button-read-${notification.id}`}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => dismissMutation.mutate(notification.id)}
                          data-testid={`button-dismiss-${notification.id}`}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="regulatory" className="mt-6">
          {newsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : !regulatoryNews?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Newspaper className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No regulatory updates</h3>
                <p className="text-muted-foreground text-center">
                  Latest regulatory news and updates will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {regulatoryNews.map((news) => (
                <Card key={news.id} data-testid={`card-news-${news.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {getNewsBadge(news.category)}
                          {news.importance === 'critical' && (
                            <Badge variant="destructive">Critical</Badge>
                          )}
                          {news.importance === 'high' && (
                            <Badge className="bg-amber-500">Important</Badge>
                          )}
                        </div>
                        <CardTitle>{news.title}</CardTitle>
                        {news.source && (
                          <CardDescription>Source: {news.source}</CardDescription>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {formatDistanceToNow(new Date(news.publishedAt), { addSuffix: true })}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{news.summary}</p>
                    {news.effectiveDate && (
                      <p className="text-sm mt-2">
                        <strong>Effective:</strong> {new Date(news.effectiveDate).toLocaleDateString()}
                      </p>
                    )}
                    {news.sourceUrl && (
                      <Button variant="link" className="p-0 mt-2" asChild>
                        <a href={news.sourceUrl} target="_blank" rel="noopener noreferrer">
                          Read more <ChevronRight className="w-4 h-4 ml-1" />
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
