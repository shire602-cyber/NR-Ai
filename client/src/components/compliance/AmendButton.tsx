import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FilePlus2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useComplianceText } from "@/lib/i18n-compliance";
import { filingBase, type FilingKind } from "./filing-types";

interface Props {
  kind: FilingKind;
  returnId: string;
  invalidateKeys: unknown[][];
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  /** Called with the new amendment's id. */
  onCreated?: (amendmentId: string) => void;
}

/** "Amend" action on a filed return: creates a linked amendment after a confirmation. */
export default function AmendButton({ kind, returnId, invalidateKeys, size = "sm", variant = "outline", onCreated }: Props) {
  const { c } = useComplianceText();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", `${filingBase(kind, returnId)}/amend`),
    onSuccess: (data: any) => {
      invalidateKeys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
      toast({ title: c.amendCreated, description: c.amendCreatedBody });
      setOpen(false);
      if (data?.amendment?.id) onCreated?.(data.amendment.id);
    },
    onError: (err: any) => setError(err?.message || c.amendFailed),
  });

  return (
    <>
      <Button
        size={size}
        variant={variant}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-testid={`button-amend-${returnId}`}
      >
        <FilePlus2 className="me-1 h-4 w-4" />
        {c.amend}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{c.amendConfirmTitle}</DialogTitle>
            <DialogDescription>{c.amendConfirmBody}</DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
              {c.cancel}
            </Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-confirm-amend">
              {mutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {c.amendReturn}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
