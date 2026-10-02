import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Copy, KeyRound, Plus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useCompanyRole } from "@/hooks/useCompanyRole";
import { copyText } from "@/lib/browser-file";
import { useI18n } from "@/lib/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ApiKeyCreateDialog } from "./ApiKeyCreateDialog";
import { messages as pageMessages } from "./ApiKeysTab.i18n";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: "active" | "revoked" | "expired";
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  ratePerMinute: number;
  ratePerDay: number;
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ApiKeysTab({ companyId }: { companyId: string }) {
  const tr = pageMessages.useT();
  const locale = useI18n((s) => s.locale);
  const { toast } = useToast();
  const { role } = useCompanyRole();
  const canCreate = role === "owner" || role === "accountant";
  const queryKey = ["/api/companies", companyId, "api-keys"];
  const { data: keys, isLoading, isError } = useQuery<ApiKeyRow[]>({ queryKey });

  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/companies/${companyId}/api-keys/${id}`),
    onSuccess: () => {
      setRevoking(null);
      queryClient.invalidateQueries({ queryKey });
      toast({ title: tr("revokedToast") });
    },
    onError: () => toast({ variant: "destructive", title: tr("errGeneric") }),
  });

  const statusLabel = { active: tr("active"), revoked: tr("revoked"), expired: tr("expired") } as const;

  return (
    <Card data-testid="card-api-keys">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="h-5 w-5" aria-hidden="true" />
              <h2>{tr("title")}</h2>
            </CardTitle>
            <CardDescription className="max-w-2xl">{tr("intro")}</CardDescription>
            <Link href="/developers/api" className="inline-block text-sm text-primary underline-offset-4 hover:underline">
              {tr("docs")}
            </Link>
          </div>
          <div className="flex flex-col items-start gap-1">
            <Button onClick={() => setCreateOpen(true)} disabled={!canCreate} data-testid="button-create-key">
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />
              {tr("create")}
            </Button>
            {!canCreate && role && <span className="text-xs text-muted-foreground">{tr("ownerOnly")}</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">{tr("loading")}</p>}
        {isError && <p role="alert" className="text-sm text-destructive">{tr("loadFailed")}</p>}
        {keys && keys.length === 0 && <p className="text-sm text-muted-foreground" data-testid="text-no-keys">{tr("empty")}</p>}
        {keys && keys.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr("colName")}</TableHead>
                  <TableHead>{tr("colKey")}</TableHead>
                  <TableHead>{tr("colScopes")}</TableHead>
                  <TableHead>{tr("colStatus")}</TableHead>
                  <TableHead>{tr("colLastUsed")}</TableHead>
                  <TableHead>{tr("colExpires")}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id} data-testid={`row-key-${k.id}`}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell>
                      <code dir="ltr" className="font-mono text-xs">{k.keyPrefix}</code>
                    </TableCell>
                    <TableCell>
                      <details>
                        <summary className="cursor-pointer text-sm">{tr.plural("scopesCount", k.scopes.length)}</summary>
                        <p className="mt-1 max-w-xs break-words font-mono text-[11px] text-muted-foreground" dir="ltr">{k.scopes.join(" ")}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{tr("limits", { perMinute: k.ratePerMinute, perDay: k.ratePerDay })}</p>
                      </details>
                    </TableCell>
                    <TableCell>
                      <Badge variant={k.status === "active" ? "default" : "secondary"}>{statusLabel[k.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{k.lastUsedAt ? formatDate(k.lastUsedAt, locale) : tr("notUsed")}</TableCell>
                    <TableCell className="text-sm">{k.expiresAt ? formatDate(k.expiresAt, locale) : tr("never")}</TableCell>
                    <TableCell className="text-end">
                      {k.status === "active" && canCreate && (
                        <Button variant="ghost" size="sm" onClick={() => setRevoking(k)} aria-label={tr("revokeKey", { name: k.name })}>
                          {tr("revoke")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ApiKeyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (body) => {
          const result = await apiRequest("POST", `/api/companies/${companyId}/api-keys`, body);
          setCreateOpen(false);
          setStored(false);
          setCopied(false);
          setCreated(result.key as string);
          queryClient.invalidateQueries({ queryKey });
        }}
      />

      <Dialog open={created !== null} onOpenChange={(next) => !next && stored && setCreated(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-key-once">
          <DialogHeader>
            <DialogTitle>{tr("keyTitle")}</DialogTitle>
            <DialogDescription>{tr("keyBody")}</DialogDescription>
          </DialogHeader>
          <code dir="ltr" className="block break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm" data-testid="text-new-key">
            {created}
          </code>
          <Button
            type="button"
            variant="outline"
            onClick={async () => setCopied(await copyText(created ?? ""))}
            className="self-start"
          >
            <Copy className="me-2 h-4 w-4" aria-hidden="true" />
            {copied ? tr("copied") : tr("copy")}
          </Button>
          <div className="flex items-center gap-2">
            <Checkbox id="key-stored" checked={stored} onCheckedChange={(v) => setStored(v === true)} />
            <label htmlFor="key-stored" className="text-sm">{tr("savedConfirm")}</label>
          </div>
          <DialogFooter>
            <Button type="button" disabled={!stored} onClick={() => setCreated(null)} data-testid="button-key-done">
              {tr("done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revoking !== null} onOpenChange={(next) => !next && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("revokeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("revokeBody", { name: revoking?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => revoking && revoke.mutate(revoking.id)} data-testid="button-revoke-confirm">
              {tr("revokeConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
