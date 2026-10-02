import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SUPPORTED_WEBHOOK_EVENTS } from "@shared/webhook-events";
import { Webhook, Plus, Trash2, Copy, Check, Send, Eye, RefreshCw } from "lucide-react";
import { ApiKeysTab } from "@/components/developers/ApiKeysTab";
import { messages as pageMessages } from "./DeveloperSettings.i18n";

// ===========================
// Types
// ===========================

interface WebhookEndpointItem {
  id: string;
  companyId: string;
  url: string;
  secretLast4: string;
  events: string;
  isActive: boolean;
  failureCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

interface WebhookDeliveryItem {
  id: string;
  webhookEndpointId: string;
  event: string;
  payload: string;
  responseStatus: number | null;
  responseBody: string | null;
  success: boolean;
  attemptNumber: number;
  createdAt: string;
}

// ===========================
// Constants
// ===========================

// Only events the platform actually emits (shared with the server, which refuses others).
const WEBHOOK_EVENTS = SUPPORTED_WEBHOOK_EVENTS;

// ===========================
// Main Component
// ===========================

export default function DeveloperSettings() {
  const tr = pageMessages.useT();

  const { companyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  if (!canAccess("apiAccess")) {
    return (
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <PageHeader eyebrow={tr("settings")} title={tr("developers")} className="mb-6" />
        <UpgradePrompt
          feature="apiAccess"
          requiredTier={getRequiredTier("apiAccess")}
          title={tr("unlockWebhookAccess")}
          description={tr("webhooksAreAvailableOnTheEnterprise")}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <PageHeader
        eyebrow={tr("settings")}
        title={tr("developers")}
        description={tr("developersDescription")}
        className="mb-6"
      />
      {companyId && (
        <Tabs defaultValue="keys">
          <TabsList>
            <TabsTrigger value="keys" data-testid="tab-api-keys">
              {tr("tabApiKeys")}
            </TabsTrigger>
            <TabsTrigger value="webhooks" data-testid="tab-webhooks">
              {tr("tabWebhooks")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="keys" className="mt-4">
            <ApiKeysTab companyId={companyId} />
          </TabsContent>
          <TabsContent value="webhooks" className="mt-4">
            <WebhooksTab companyId={companyId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ===========================
// Webhooks Tab
// ===========================

function WebhooksTab({ companyId }: { companyId: string }) {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [showSecretDialog, setShowSecretDialog] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deliveriesEndpointId, setDeliveriesEndpointId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>([]);

  const { data: webhooks, isLoading } = useQuery<WebhookEndpointItem[]>({
    queryKey: ["/api/companies", companyId, "webhooks"],
    enabled: !!companyId,
  });

  const { data: deliveries } = useQuery<WebhookDeliveryItem[]>({
    queryKey: ["/api/webhooks", deliveriesEndpointId, "deliveries"],
    queryFn: () => apiRequest("GET", `/api/webhooks/${deliveriesEndpointId}/deliveries`),
    enabled: !!deliveriesEndpointId,
  });

  const createMutation = useMutation({
    mutationFn: (data: { url: string; events: string }) =>
      apiRequest("POST", `/api/companies/${companyId}/webhooks`, data),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "webhooks"] });
      setCreatedSecret(result.secret);
      setCreateOpen(false);
      setShowSecretDialog(true);
      setNewUrl("");
      setNewEvents([]);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToCreateWebhook"),
        description: error?.message,
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PUT", `/api/webhooks/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "webhooks"] });
      toast({ title: tr("webhookUpdated") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToUpdateWebhook"),
        description: error?.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/webhooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "webhooks"] });
      toast({ title: tr("webhookDeleted") });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("failedToDeleteWebhook"),
        description: error?.message,
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/webhooks/${id}/test`),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "webhooks"] });
      if (result.success) {
        toast({
          title: tr("testSent"),
          description: tr("receivedHttp", { responseStatus: result.responseStatus }),
        });
      } else {
        toast({
          variant: "destructive",
          title: tr("testFailed"),
          description: result.responseStatus
            ? tr("receivedHttp", { responseStatus: result.responseStatus })
            : tr("couldNotReachEndpoint"),
        });
      }
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: tr("testFailed"), description: error?.message });
    },
  });

  const handleEventToggle = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCopySecret = async () => {
    if (createdSecret) {
      await navigator.clipboard.writeText(createdSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{tr("webhookEndpoints")}</CardTitle>
            <CardDescription>{tr("receiveNotificationsWhenEventsHappenIn")}</CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            {tr("addEndpoint")}
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">{tr("loading")}</p>
          ) : !webhooks?.length ? (
            <p className="text-muted-foreground py-8 text-center">
              {tr("noWebhookEndpointsConfiguredAddOne")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>{tr("events")}</TableHead>
                  <TableHead>{tr("status")}</TableHead>
                  <TableHead>{tr("failures")}</TableHead>
                  <TableHead>{tr("lastTriggered")}</TableHead>
                  <TableHead className="text-end">{tr("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webhooks.map((wh) => (
                  <TableRow key={wh.id}>
                    <TableCell className="font-mono text-sm max-w-[250px] truncate">
                      {wh.url}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap max-w-[200px]">
                        {wh.events
                          .split(",")
                          .slice(0, 3)
                          .map((event) => (
                            <Badge key={event} variant="outline" className="text-xs">
                              {event.trim()}
                            </Badge>
                          ))}
                        {wh.events.split(",").length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{wh.events.split(",").length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={wh.isActive}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: wh.id, isActive: checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {wh.failureCount > 0 ? (
                        <Badge variant="destructive">{wh.failureCount}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {wh.lastTriggeredAt
                        ? new Date(wh.lastTriggeredAt).toLocaleDateString()
                        : tr("never")}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={tr("viewDeliveries")}
                          onClick={() => setDeliveriesEndpointId(wh.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={tr("sendTestEvent")}
                          disabled={testMutation.isPending}
                          onClick={() => testMutation.mutate(wh.id)}
                        >
                          {testMutation.isPending ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={tr("deleteWebhookAria")} onClick={() => setDeleteId(wh.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Webhook Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("addWebhookEndpoint")}</DialogTitle>
            <DialogDescription>{tr("weWillSendPostRequestsTo")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">{tr("endpointUrl")}</Label>
              <Input
                id="webhook-url"
                placeholder="https://example.com/webhook"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{tr("events")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {WEBHOOK_EVENTS.map((event) => (
                  <div key={event} className="flex items-center gap-2">
                    <Checkbox
                      id={`event-${event}`}
                      checked={newEvents.includes(event)}
                      onCheckedChange={() => handleEventToggle(event)}
                    />
                    <Label htmlFor={`event-${event}`} className="font-normal text-sm">
                      {event}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  url: newUrl,
                  events: newEvents.join(","),
                })
              }
              disabled={!newUrl.trim() || newEvents.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? tr("creating") : tr("addEndpoint")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Created Secret Dialog */}
      <Dialog
        open={showSecretDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowSecretDialog(false);
            setCreatedSecret(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("webhookSecretCreated")}</DialogTitle>
            <DialogDescription>{tr("copyThisSigningSecretNowYou")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Input readOnly value={createdSecret || ""} className="font-mono text-sm" />
              <Button variant="outline" size="icon" aria-label={tr("copySecretAria")} onClick={handleCopySecret}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{tr("eachWebhookDeliveryIncludesAnX")}</p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowSecretDialog(false);
                setCreatedSecret(null);
                setCopied(false);
              }}
            >
              {tr("done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deliveries Dialog */}
      <Dialog
        open={!!deliveriesEndpointId}
        onOpenChange={(open) => !open && setDeliveriesEndpointId(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("recentDeliveries")}</DialogTitle>
            <DialogDescription>{tr("last100WebhookDeliveryAttemptsFor")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {!deliveries?.length ? (
              <p className="text-muted-foreground text-center py-4">
                {tr("noDeliveriesRecordedYet")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("event")}</TableHead>
                    <TableHead>{tr("status")}</TableHead>
                    <TableHead>{tr("response")}</TableHead>
                    <TableHead>{tr("time")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell>
                        <Badge variant="outline">{delivery.event}</Badge>
                      </TableCell>
                      <TableCell>
                        {delivery.success ? (
                          <Badge className="bg-success-subtle text-success-subtle-foreground ">
                            {tr("success")}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">{tr("failed")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {delivery.responseStatus
                          ? `HTTP ${delivery.responseStatus}`
                          : tr("noResponse")}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(delivery.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("deleteWebhookEndpoint")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr("thisWillPermanentlyDeleteThisEndpoint")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tr("deleteEndpoint")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
