import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { formatDistanceToNow } from "date-fns";
import {
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Eye,
  MousePointer,
  AlertTriangle,
  Activity,
  Users,
  Clock,
} from "lucide-react";

interface AnalyticsDashboard {
  summary: {
    totalPageViews: number;
    totalFeatureUses: number;
    totalErrors: number;
    totalEvents: number;
  };
  eventsByName: Record<string, number>;
  pagesByUrl: Record<string, number>;
  recentEvents: any[];
  featureMetrics: any[];
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", "#82CA9D"];

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("overview");

  const { data: analytics, isLoading } = useQuery<AnalyticsDashboard>({
    queryKey: ["/api/analytics/my-dashboard"],
  });

  const eventChartData = analytics?.eventsByName
    ? Object.entries(analytics.eventsByName)
        .map(([name, count]) => ({ name: name.replace(/_/g, " "), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
    : [];

  const pageChartData = analytics?.pagesByUrl
    ? Object.entries(analytics.pagesByUrl)
        .map(([url, count]) => ({
          name: url.replace("/", "") || "Home",
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    : [];

  const pieData = eventChartData.slice(0, 5);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Insights"
        title="Usage Analytics"
        description="Monitor feature engagement and user activity"
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.pageViews" />
            </CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-page-views">
              {analytics?.summary?.totalPageViews || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              <T k="pages.totalPageViews" />
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.featureUses" />
            </CardTitle>
            <MousePointer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-feature-uses">
              {analytics?.summary?.totalFeatureUses || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              <T k="pages.featureInteractions" />
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.errors" />
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-errors">
              {analytics?.summary?.totalErrors || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              <T k="pages.errorEvents" />
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              <T k="pages.totalEvents" />
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-total-events">
              {analytics?.summary?.totalEvents || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              <T k="pages.allTrackedEvents" />
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">
            <BarChart3 className="w-4 h-4 mr-2" />
            <T k="pages.overview" />
          </TabsTrigger>
          <TabsTrigger value="pages" data-testid="tab-pages">
            <Eye className="w-4 h-4 mr-2" />
            <T k="pages.pages" />
          </TabsTrigger>
          <TabsTrigger value="events" data-testid="tab-events">
            <Activity className="w-4 h-4 mr-2" />
            <T k="pages.events" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  <T k="pages.topEvents" />
                </CardTitle>
                <CardDescription>
                  <T k="pages.mostFrequentUserActions" />
                </CardDescription>
              </CardHeader>
              <CardContent>
                {eventChartData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <BarChart3 className="w-12 h-12 mb-4 opacity-50" />
                    <p>
                      <T k="pages.noEventDataYet" />
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={eventChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChartIcon className="w-5 h-5" />
                  <T k="pages.eventDistribution" />
                </CardTitle>
                <CardDescription>
                  <T k="pages.breakdownOfEventTypes" />
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <PieChartIcon className="w-12 h-12 mb-4 opacity-50" />
                    <p>
                      <T k="pages.noDataToDisplay" />
                    </p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        outerRadius={100}
                        fill="#8884d8"
                        dataKey="count"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="pages" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5" />
                <T k="pages.pageViews" />
              </CardTitle>
              <CardDescription>
                <T k="pages.mostVisitedPages" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pageChartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Eye className="w-12 h-12 mb-4 opacity-50" />
                  <p>
                    <T k="pages.noPageViewDataYet" />
                  </p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={pageChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <T k="pages.recentEvents" />
              </CardTitle>
              <CardDescription>
                <T k="pages.latestUserActivity" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!analytics?.recentEvents?.length ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Activity className="w-12 h-12 mb-4 opacity-50" />
                  <p>
                    <T k="pages.noEventsRecordedYet" />
                  </p>
                </div>
              ) : (
                <ScrollArea className="h-[500px]">
                  <div className="space-y-2">
                    {analytics.recentEvents.map((event: any, index: number) => (
                      <div
                        key={event.id || index}
                        className="flex items-center justify-between p-3 rounded-lg border"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              event.eventType === "error"
                                ? "bg-destructive"
                                : event.eventType === "page_view"
                                  ? "bg-info"
                                  : event.eventType === "feature_use"
                                    ? "bg-success"
                                    : "bg-muted-foreground"
                            }`}
                          />
                          <div>
                            <div className="font-medium">{event.eventName?.replace(/_/g, " ")}</div>
                            <div className="text-sm text-muted-foreground">
                              {event.pageUrl || "-"}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="outline">{event.eventType}</Badge>
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
