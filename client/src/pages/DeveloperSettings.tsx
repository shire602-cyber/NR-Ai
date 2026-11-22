import { T } from "@/components/layout/T";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { useTranslation, translateNow, formatMessage } from "@/lib/i18n";
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
import { Key, Webhook, Plus, Trash2, Copy, Check, Send, Eye, RefreshCw } from "lucide-react";

// ===========================
// Types
// ===========================

interface ApiKeyItem {
  id: string;
  companyId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  rateLimitPerMinute?: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

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
  maxAttempts?: number;
  status?: "pending" | "in_flight" | "retrying" | "delivered" | "dead";
  nextAttemptAt?: string | null;
  lastError?: string | null;
  createdAt: string;
}

// ===========================
// Constants
// ===========================

// W5-B: must match API_SCOPES in server/middleware/api-key-auth.ts and WEBHOOK_EVENTS in
// server/services/webhook.service.ts (the server rejects anything else).
const API_KEY_SCOPES = [
  "read:invoices",
  "write:invoices",
  "read:contacts",
  "write:contacts",
  "read:bills",
  "read:payments",
  "write:payments",
  "read:accounts",
  "read:reports",
] as const;

const WEBHOOK_EVENTS = [
  "invoice.created",
  "invoice.issued",
  "invoice.paid",
  "invoice.voided",
  "payment.received",
  "credit_note.issued",
  "bill.approved",
  "bill.paid",
  "contact.created",
  "payroll.approved",
  "payroll.paid",
] as const;

// ===========================
// Main Component
// ===========================

export default function DeveloperSettings() {
  const { t } = useTranslation();
  const { companyId } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  if (!canAccess("apiAccess")) {
    return (
      <div className="max-w-narrow">
        <PageHeader
          eyebrow="Settings"
          title={t["developerSettings.developerSettings"]}
          className="mb-6"
        />
        <UpgradePrompt
          feature="apiAccess"
          requiredTier={getRequiredTier("apiAccess")}
          title={t["developerSettings.unlockApiWebhookAccess"]}
          description={t["developerSettings.apiKeysAndWebhooksAre"]}
        />
      </div>
    );
  }

  return (
    <SettingsLayout>
      <div className="max-w-narrow">
        <PageHeader
          eyebrow="Settings"
          title={t["developerSettings.developerSettings"]}
          description={t["developerSettings.manageApiKeysAndWebhook"]}
          className="mb-6"
        />
        <Tabs defaultValue="api-keys">
          <TabsList className="mb-6">
            <TabsTrigger value="api-keys" className="gap-2">
              <Key className="h-4 w-4" />
              <T k="pages.apiKeys" />
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-2">
              <Webhook className="h-4 w-4" />
              <T k="pageLabels.webhooks" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys">
            {companyId && <ApiKeysTab companyId={companyId} />}
          </TabsContent>

          <TabsContent value="webhooks">
            {companyId && <WebhooksTab companyId={companyId} />}
          </TabsContent>
        </Tabs>
      </div>
    </SettingsLayout>
  );
}

// ===========================
// API Keys Tab
// ===========================

function ApiKeysTab({ companyId }: { companyId: string }) {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Form state
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["read:invoices"]);

  const { data: apiKeys, isLoading } = useQuery<ApiKeyItem[]>({
    queryKey: ["/api/companies", companyId, "api-keys"],
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; scopes: string[] }) =>
      apiRequest("POST", `/api/companies/${companyId}/api-keys`, data),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "api-keys"] });
      setCreatedKey(result.key);
      setCreateOpen(false);
      setShowKeyDialog(true);
      setNewKeyName("");
      setNewKeyScopes(["read"]);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToCreateApiKey"),
        description: error?.message,
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PUT", `/api/api-keys/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "api-keys"] });
      toast({ title: translateNow("toasts.apiKeyUpdated") });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToUpdateApiKey"),
        description: error?.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "api-keys"] });
      toast({ title: translateNow("toasts.apiKeyRevoked") });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToRevokeApiKey"),
        description: error?.message,
      });
    },
  });

  const handleCopy = async () => {
    if (createdKey) {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleScopeToggle = (scope: string) => {
    setNewKeyScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>
              <T k="pages.apiKeys" />
            </CardTitle>
            <CardDescription>{t["developerSettings.createAndManageApiKeys"]}</CardDescription>
            {/* W5-B (R19-15): keys authenticate the versioned public API only. */}
            <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
              <span translate="no">{"Authorization: ApiKey muh_…  ·  /api/v1  ·  "}</span>
              <a className="underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                <span translate="no">{"openapi.json"}</span>
              </a>
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            <T k="pageLabels.createKey" />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">
              <T k="pages.loading" />
            </p>
          ) : !apiKeys?.length ? (
            <p className="text-muted-foreground py-8 text-center">
              <T k="pageLabels.noAPIKeysCreatedYetCreateOneToGetStarted" />
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>
                    <T k="pages.scopes" />
                  </TableHead>
                  <TableHead>
                    <T k="pageLabels.lastUsed" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="pages.actions" />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <code className="text-sm bg-muted px-2 py-1 rounded">{key.keyPrefix}</code>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {key.scopes.map((scope) => (
                          <Badge key={scope} variant="secondary" className="text-xs" dir="ltr">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.lastUsedAt
                        ? new Date(key.lastUsedAt).toLocaleDateString(
                            locale === "ar" ? "ar-AE" : undefined
                          )
                        : t["banking.common.never"]}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={key.isActive}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: key.id, isActive: checked })
                        }
                      />
                    </TableCell>
                    <TableCell data-numeric>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(key.id)}>
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create API Key Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.createAPIKey" />
            </DialogTitle>
            <DialogDescription>
              <T k="pageLabels.generateANewAPIKeyForProgrammaticAccess" />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name"
                placeholder="e.g., Production Server"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                <T k="pages.scopes" />
              </Label>
              <div className="flex flex-col gap-2">
                {API_KEY_SCOPES.map((scope) => (
                  <div key={scope} className="flex items-center gap-2">
                    <Checkbox
                      id={`scope-${scope}`}
                      checked={newKeyScopes.includes(scope)}
                      onCheckedChange={() => handleScopeToggle(scope)}
                    />
                    <Label
                      htmlFor={`scope-${scope}`}
                      className="tabular-nums text-xs font-normal"
                      dir="ltr"
                    >
                      {scope}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              <T k="pages.cancel" />
            </Button>
            <Button
              onClick={() =>
                createMutation.mutate({
                  name: newKeyName,
                  scopes: newKeyScopes,
                })
              }
              disabled={!newKeyName.trim() || newKeyScopes.length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : t["pageLabels.createKey"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Created Key Dialog */}
      <Dialog
        open={showKeyDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowKeyDialog(false);
            setCreatedKey(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <T k="pageLabels.aPIKeyCreated" />
            </DialogTitle>
            <DialogDescription>
              <T k="pageLabels.copyThisKeyNowYouWillNotBeAbleToSeeItAgain" />
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Input readOnly value={createdKey || ""} className="tabular-nums text-sm" />
              <Button variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t["developerSettings.storeThisKeySecurelyIt"]}
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowKeyDialog(false);
                setCreatedKey(null);
                setCopied(false);
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T k="pageLabels.revokeAPIKey" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t["developerSettings.thisActionCannotBeUndone"]}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pageLabels.revokeKey" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ===========================
// Webhooks Tab
// ===========================

function WebhooksTab({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
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

  // W5-B (R19-02): replay any delivery (same event id, new signed attempt).
  const replayMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      apiRequest("POST", `/api/webhooks/${deliveriesEndpointId}/deliveries/${deliveryId}/replay`),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["/api/webhooks", deliveriesEndpointId, "deliveries"],
      }),
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
        title: translateNow("toasts.failedToCreateWebhook"),
        description: error?.message,
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PUT", `/api/webhooks/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "webhooks"] });
      toast({ title: t["developerSettings.webhookUpdated"] });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToUpdateWebhook"),
        description: error?.message,
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/webhooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "webhooks"] });
      toast({ title: t["developerSettings.webhookDeleted"] });
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToDeleteWebhook"),
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
          title: translateNow("toasts.testSent"),
          description: formatMessage(translateNow("toasts.receivedHttp"), {
            responseStatus: result.responseStatus,
          }),
        });
      } else {
        toast({
          variant: "destructive",
          title: translateNow("toasts.testFailed"),
          description: result.responseStatus
            ? formatMessage(translateNow("toasts.receivedHttp"), {
                responseStatus: result.responseStatus,
              })
            : translateNow("toasts.couldNotReachEndpoint"),
        });
      }
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.testFailed"),
        description: error?.message,
      });
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
            <CardTitle>
              <T k="pageLabels.webhookEndpoints" />
            </CardTitle>
            <CardDescription>
              {t["developerSettings.receiveRealTimeNotificationsWhen"]}
            </CardDescription>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            <T k="pageLabels.addEndpoint" />
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">
              <T k="pages.loading" />
            </p>
          ) : !webhooks?.length ? (
            <p className="text-muted-foreground py-8 text-center">
              {t["developerSettings.noWebhookEndpointsConfiguredAdd"]}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead>
                    <T k="pages.events" />
                  </TableHead>
                  <TableHead>
                    <T k="pages.status" />
                  </TableHead>
                  <TableHead>
                    <T k="pageLabels.failures" />
                  </TableHead>
                  <TableHead>
                    <T k="pageLabels.lastTriggered" />
                  </TableHead>
                  <TableHead data-numeric>
                    <T k="pages.actions" />
                  </TableHead>
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
                        : "Never"}
                    </TableCell>
                    <TableCell data-numeric>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t["developerSettings.viewDeliveries"]}
                          onClick={() => setDeliveriesEndpointId(wh.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t["developerSettings.sendTestEvent"]}
                          disabled={testMutation.isPending}
                          onClick={() => testMutation.mutate(wh.id)}
                        >
                          {testMutation.isPending ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(wh.id)}>
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
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
            <DialogTitle>
              <T k="pageLabels.addWebhookEndpoint" />
            </DialogTitle>
            <DialogDescription>{t["developerSettings.weWillSendPostRequests"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="webhook-url">
                <T k="pageLabels.endpointURL" />
              </Label>
              <Input
                id="webhook-url"
                placeholder="https://example.com/webhook"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                <T k="pages.events" />
              </Label>
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
              <T k="pages.cancel" />
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
              {createMutation.isPending ? "Creating..." : t["pageLabels.addEndpoint"]}
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
            <DialogTitle>
              <T k="pageLabels.webhookSecretCreated" />
            </DialogTitle>
            <DialogDescription>{t["developerSettings.copyThisSigningSecretNow"]}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-center gap-2">
              <Input readOnly value={createdSecret || ""} className="font-mono text-sm" />
              <Button variant="outline" size="icon" onClick={handleCopySecret}>
                {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {t["developerSettings.eachWebhookDeliveryIncludesAn"]}
            </p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setShowSecretDialog(false);
                setCreatedSecret(null);
                setCopied(false);
              }}
            >
              Done
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
            <DialogTitle>
              <T k="pageLabels.recentDeliveries" />
            </DialogTitle>
            <DialogDescription>
              {t["developerSettings.last100WebhookDeliveryAttempts"]}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {!deliveries?.length ? (
              <p className="text-muted-foreground text-center py-4">
                <T k="pageLabels.noDeliveriesRecordedYet" />
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <T k="pageLabels.event" />
                    </TableHead>
                    <TableHead>
                      <T k="pages.status" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.response" />
                    </TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead />
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
                            {delivery.status ?? "delivered"}
                          </Badge>
                        ) : (
                          <Badge
                            variant={delivery.status === "retrying" ? "outline" : "destructive"}
                          >
                            {delivery.status ?? "failed"}
                          </Badge>
                        )}
                        <span className="ms-2 text-xs text-muted-foreground">
                          {delivery.attemptNumber}/{delivery.maxAttempts ?? 1}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {delivery.responseStatus
                          ? `HTTP ${delivery.responseStatus}`
                          : t["developerSettings.noResponse"]}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(delivery.createdAt).toLocaleString()}
                        {delivery.status === "retrying" && delivery.nextAttemptAt && (
                          <span className="block text-xs">
                            → {new Date(delivery.nextAttemptAt).toLocaleTimeString()}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={t["developerSettings.replay"]}
                          onClick={() => replayMutation.mutate(delivery.id)}
                          disabled={replayMutation.isPending}
                          data-testid={`button-replay-${delivery.id}`}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
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
            <AlertDialogTitle>
              <T k="pageLabels.deleteWebhookEndpoint" />
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t["developerSettings.thisWillPermanentlyDeleteThis"]}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <T k="pages.cancel" />
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              <T k="pageLabels.deleteEndpoint" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
