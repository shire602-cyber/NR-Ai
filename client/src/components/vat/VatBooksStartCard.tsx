import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { booksStartBody, booksStartOk, dayOnly } from "@/lib/vat-filed-elsewhere";
import { messages as pageMessages } from "./VatBooksStartCard.i18n";

interface CompanyWithBooksStart {
  vatBooksStart?: string | null;
}

/** Company setting: the first VAT period Muhasib books. The server trims VAT Filing and Autopilot from it. */
export function VatBooksStartCard({ companyId }: { companyId: string }) {
  const tr = pageMessages.useT();
  const { toast } = useToast();
  const { data: company } = useQuery<CompanyWithBooksStart>({
    queryKey: ["/api/companies", companyId],
    enabled: !!companyId,
  });
  const saved = company?.vatBooksStart ? dayOnly(company.vatBooksStart) : "";
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const valid = booksStartOk(value);

  const mutation = useMutation({
    mutationFn: (next: string) =>
      apiRequest("PATCH", `/api/companies/${companyId}`, booksStartBody(next)),
    onSuccess: (_data, next) => {
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/companies", companyId, "vat-returns"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vat/autopilot"] });
      toast({
        title: tr("savedTitle"),
        description: next ? tr("savedDescription") : tr("clearedDescription"),
      });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: tr("failedTitle"), description: error.message });
    },
  });

  return (
    <Card id="vat-books-start" data-testid="vat-books-start-card">
      <CardHeader>
        <CardTitle>{tr("title")}</CardTitle>
        <CardDescription>{tr("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-w-xs space-y-1">
          <Label htmlFor="vat-books-start-input">{tr("label")}</Label>
          <Input
            id="vat-books-start-input"
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!valid}
            data-testid="input-vat-books-start"
          />
          <p className="text-xs text-muted-foreground">{valid ? tr("hint") : tr("rule")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => mutation.mutate(value)}
            disabled={!valid || value === saved || mutation.isPending}
            data-testid="button-save-vat-books-start"
          >
            {mutation.isPending ? tr("saving") : tr("save")}
          </Button>
          {saved ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => mutation.mutate("")}
              disabled={mutation.isPending}
              data-testid="button-clear-vat-books-start"
            >
              {tr("clear")}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
