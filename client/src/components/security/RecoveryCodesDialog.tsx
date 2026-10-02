import { useState } from "react";
import { Copy, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyText, downloadTextFile } from "@/lib/browser-file";
import { formatRecoveryCode, recoveryCodesFileText } from "@/lib/security-api";
import { messages as pageMessages } from "./TwoFactorCard.i18n";

interface Props {
  codes: string[] | null;
  onClose: () => void;
}

/** Shows the ten recovery codes once. They cannot be shown again, so the dialog insists on a saved copy. */
export function RecoveryCodesDialog({ codes, onClose }: Props) {
  const tr = pageMessages.useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const open = codes !== null;

  const text = codes ? recoveryCodesFileText(codes, tr("recoveryFileTitle")) : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && saved) {
          setSaved(false);
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md" data-testid="dialog-recovery-codes">
        <DialogHeader>
          <DialogTitle>{tr("recoveryTitle")}</DialogTitle>
          <DialogDescription>{tr("recoveryBody")}</DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm" dir="ltr" data-testid="list-recovery-codes">
          {codes?.map((code) => (
            <li key={code} className="tabular-nums">
              {formatRecoveryCode(code)}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              setCopied(await copyText(codes?.map(formatRecoveryCode).join("\n") ?? ""));
              setSaved(true);
            }}
          >
            <Copy className="me-2 h-4 w-4" aria-hidden="true" />
            {copied ? tr("copied") : tr("copy")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              downloadTextFile("muhasib-recovery-codes.txt", text);
              setSaved(true);
            }}
          >
            <Download className="me-2 h-4 w-4" aria-hidden="true" />
            {tr("download")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              window.print();
              setSaved(true);
            }}
          >
            <Printer className="me-2 h-4 w-4" aria-hidden="true" />
            {tr("print")}
          </Button>
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={!saved}
            onClick={() => {
              setSaved(false);
              setCopied(false);
              onClose();
            }}
            data-testid="button-recovery-done"
          >
            {saved ? tr("done") : tr("saveFirst")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
