import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { formatPercent } from "@/lib/format";
import { apiRequest } from "@/lib/queryClient";
import { Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";
import { messages as pageMessages } from "./AICategorize.i18n";

const categorizeSchema = z.object({
  companyId: z.string().uuid(),
  description: z.string().min(3, pageMessages.marker("descriptionMustBeAtLeast3")),
  amount: z.coerce.number().min(0.01, pageMessages.marker("amountMustBePositive")),
  currency: z.string().default("AED"),
});

type CategorizeFormData = z.infer<typeof categorizeSchema>;

export default function AICategorize() {
  const tr = pageMessages.useT();

  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId } = useDefaultCompany();
  const [result, setResult] = useState<any>(null);

  const form = useForm<CategorizeFormData>({
    resolver: zodResolver(categorizeSchema),
    defaultValues: {
      companyId: companyId || "",
      description: "",
      amount: 0,
      currency: "AED",
    },
  });

  // Update form's companyId when it's loaded
  useEffect(() => {
    if (companyId) {
      form.setValue("companyId", companyId);
    }
  }, [companyId, form]);

  const categorizeMutation = useMutation({
    mutationFn: (data: CategorizeFormData) => apiRequest("POST", "/api/ai/categorize", data),
    onSuccess: (data) => {
      setResult(data);
      toast({
        title: tr("categorizationComplete"),
        description: tr("aiHasSuggestedAnAccountFor"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: tr("categorizationFailed"),
        description: error?.message || tr("pleaseTryAgain"),
      });
    },
  });

  const onSubmit = (data: CategorizeFormData) => {
    categorizeMutation.mutate(data);
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "text-success ";
    if (confidence >= 0.5) return "text-warning ";
    return "text-destructive ";
  };

  const examples = [
    { description: tr("uberRideToClientMeeting"), expected: tr("marketingExpense") },
    { description: tr("facebookAdsCampaign"), expected: tr("marketingExpense") },
    { description: tr("monthlyOfficeRentPayment"), expected: tr("rentExpense") },
    { description: tr("dewaElectricityBill"), expected: tr("utilitiesExpense") },
    { description: tr("officeStationerySupplies"), expected: tr("officeSupplies") },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold mb-2 flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-primary" />
          {t.aiCategorize}
        </h1>
        <p className="text-muted-foreground">{tr("useAiToAutomaticallyCategorizeExpenses")}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>{tr("transactionDetails")}</CardTitle>
            <CardDescription>
              {tr("enterTransactionInformationForAiCategorization")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.transactionDescription}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder={tr("eGUberRideToClient")}
                          rows={3}
                          data-testid="input-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.amount}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="100.00"
                          className="font-mono"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value ? parseFloat(e.target.value) : "")
                          }
                          data-testid="input-amount"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full"
                  disabled={categorizeMutation.isPending}
                  data-testid="button-categorize"
                >
                  <Sparkles className="w-4 h-4 me-2" />
                  {categorizeMutation.isPending ? t.loading : t.categorize}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{tr("aiSuggestion")}</CardTitle>
            <CardDescription>{tr("accountRecommendationWithConfidenceScore")}</CardDescription>
          </CardHeader>
          <CardContent>
            {categorizeMutation.isPending ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : result ? (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4 p-4 border rounded-lg bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground mb-1">{t.suggestedAccount}</div>
                    <div
                      className="font-semibold text-lg truncate"
                      data-testid="text-suggested-account"
                    >
                      {result.suggestedAccountName}
                    </div>
                    <div dir="ltr" className="font-mono text-sm text-muted-foreground">
                      {result.suggestedAccountCode}
                    </div>
                  </div>
                  <CheckCircle2 className="w-6 h-6 text-success flex-shrink-0" />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t.confidence}</span>
                    <span
                      dir="ltr"
                      className={`text-lg font-bold font-mono ${getConfidenceColor(result.confidence)}`}
                      data-testid="text-confidence"
                    >
                      {formatPercent(result.confidence, locale)}
                    </span>
                  </div>
                  <Progress value={result.confidence * 100} className="h-2" />
                  {result.confidence >= 0.8 && (
                    <Badge variant="outline" className="bg-success-subtle text-success ">
                      {tr("highConfidence")}
                    </Badge>
                  )}
                  {result.confidence >= 0.5 && result.confidence < 0.8 && (
                    <Badge variant="outline" className="bg-warning-subtle text-warning ">
                      {tr("mediumConfidence")}
                    </Badge>
                  )}
                  {result.confidence < 0.5 && (
                    <Badge variant="outline" className="bg-danger-subtle text-destructive ">
                      {tr("lowConfidence")}
                    </Badge>
                  )}
                </div>

                <div className="pt-4 border-t">
                  <div className="text-sm text-muted-foreground mb-2">{tr("reasoning")}</div>
                  <p className="text-sm" data-testid="text-reason">
                    {result.reason}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Sparkles className="w-16 h-16 mb-4 opacity-50" />
                <p className="text-sm">{tr("enterATransactionToGetAi")}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{tr("tryTheseExamples")}</CardTitle>
          <CardDescription>{tr("clickAnExampleToSeeHow")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {examples.map((example, index) => (
              <button
                key={index}
                onClick={() => {
                  form.setValue("description", example.description);
                  form.setValue("amount", 100);
                }}
                className="flex items-start justify-between gap-3 p-4 border rounded-lg hover-elevate text-start"
                data-testid={`example-${index}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium mb-1">{example.description}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    {tr("expected", { expected: example.expected })}
                    <ArrowRight className="w-3 h-3" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
