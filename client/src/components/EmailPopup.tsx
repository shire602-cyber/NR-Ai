import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Gift, Sparkles, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiUrl } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { messages as pageMessages } from "./EmailPopup.i18n";

interface EmailPopupProps {
  open: boolean;
  onClose: () => void;
  locale?: string;
}

export function EmailPopup({ open, onClose, locale = "en" }: EmailPopupProps) {
  const tr = pageMessages.useT();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !email.includes("@")) {
      toast({
        title: tr("invalidEmail"),
        description: tr("pleaseEnterAValidEmailAddress"),
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(apiUrl("/api/waitlist"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source: "popup" }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.message);
      }

      toast({
        title: tr("success"),
        description: tr("youReOnTheListCheck"),
      });

      setEmail("");
      onClose();
    } catch (error: any) {
      toast({
        title: tr("error"),
        description: error?.message || tr("failedToJoinWaitlist"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <button
          onClick={onClose}
          className="absolute end-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          data-testid="button-close-popup"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{tr("close")}</span>
        </button>

        <DialogHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full flex items-center justify-center">
            <Gift className="w-8 h-8 text-primary-foreground" />
          </div>

          <DialogTitle className="text-center text-2xl">{tr("lifetimeDealAlert")}</DialogTitle>

          <DialogDescription className="text-center text-base">
            {tr("joinOurExclusiveWaitlistForA")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              {tr("emailAddress")}
            </Label>
            <Input
              id="email"
              type="email"
              placeholder={locale === "en" ? "you@example.com" : "you@example.com"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
              data-testid="input-waitlist-email"
              className="w-full"
            />
          </div>

          <Button
            type="submit"
            className="w-full gap-2"
            disabled={loading}
            data-testid="button-join-waitlist"
          >
            <Sparkles className="w-4 h-4" />
            {loading ? tr("joining") : tr("claimMySpot")}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            {tr("noSpamEverJustTheLifetime")}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
