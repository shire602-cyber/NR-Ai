// ClientPortfolio module (W5-D split of ClientPortfolio.tsx; no behaviour change).
import { T } from "@/components/layout/T";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Target, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { GrowthDashboard, GrowthOpportunityStatus } from "./types";
import { formatAed } from "./helpers";

export function RevenueGrowthPanel({
  onOpenClient,
}: {
  onOpenClient: (companyId: string) => void;
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<GrowthDashboard>({
    queryKey: ["/api/firm/growth-opportunities"],
  });

  const refreshMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/firm/growth-opportunities/refresh"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/growth-opportunities"] });
      toast({ title: "Revenue opportunities refreshed" });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not refresh revenue opportunities",
        description: e?.message,
      }),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      status,
      actionType,
      resolutionNote,
    }: {
      id: string;
      status: GrowthOpportunityStatus;
      actionType: string;
      resolutionNote?: string;
    }) =>
      apiRequest("PATCH", `/api/firm/growth-opportunities/${id}`, {
        status,
        actionType,
        resolutionNote,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/firm/growth-opportunities"] });
    },
    onError: (e: any) =>
      toast({
        variant: "destructive",
        title: "Could not update opportunity",
        description: e?.message,
      }),
  });

  const opportunities = data?.opportunities ?? [];
  const active = opportunities
    .filter((item) => item.status !== "dismissed" && item.status !== "completed")
    .slice(0, 6);
  const summary = data?.summary ?? {
    estimated: 0,
    accepted: 0,
    completed: 0,
    missed: 0,
    openCount: 0,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <T k="pages.revenueGrowth" />
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Internal opportunity queue for service AR, cleanup work, advisory packs, and
              compliance extras.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className="w-4 h-4 me-2" />
            <T k="pages.refreshSignals" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="pages.openPipeline" />
            </p>
            <p className="text-lg font-semibold">{formatAed(summary.estimated)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="pages.accepted" />
            </p>
            <p className="text-lg font-semibold">{formatAed(summary.accepted)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="pages.completed" />
            </p>
            <p className="text-lg font-semibold">{formatAed(summary.completed)}</p>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              <T k="pages.openCount" />
            </p>
            <p className="text-lg font-semibold">{summary.openCount}</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">
            <T k="pages.loadingRevenueSignals" />
          </p>
        ) : active.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No active revenue opportunities yet. Refresh signals after new AR, cleanup, or
            compliance data lands.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((opportunity) => (
              <div key={opportunity.id} className="rounded-md border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{opportunity.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {opportunity.companyName ?? "Client"}
                    </p>
                  </div>
                  <Badge variant={opportunity.priority === "critical" ? "destructive" : "outline"}>
                    {opportunity.priority}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{opportunity.reason}</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">
                    {formatAed(Number(opportunity.estimatedValue ?? 0))}
                  </span>
                  <span className="text-muted-foreground">
                    {Math.round(Number(opportunity.confidence ?? 0) * 100)}% confidence
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenClient(opportunity.companyId)}
                  >
                    <T k="pages.client" />
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      updateMutation.mutate({
                        id: opportunity.id,
                        status: "accepted",
                        actionType: "accept",
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    <T k="pages.accept" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMutation.mutate({
                        id: opportunity.id,
                        status: "completed",
                        actionType: "complete",
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    <T k="pages.complete" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateMutation.mutate({
                        id: opportunity.id,
                        status: "dismissed",
                        actionType: "dismiss",
                        resolutionNote: "Dismissed from Client Operations.",
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    <T k="pages.dismiss" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
