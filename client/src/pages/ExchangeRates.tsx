import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { useSubscription } from "@/hooks/useSubscription";
import { UpgradePrompt } from "@/components/UpgradePrompt";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatDate, formatNumber } from "@/lib/format";
import { Plus, ArrowRightLeft, RefreshCw } from "lucide-react";

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "INR", "PKR", "EGP", "BHD", "QAR"];

interface ExchangeRate {
  id: string;
  companyId: string;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate: string;
  source: string;
  createdAt: string;
}

interface ConvertResult {
  from: string;
  to: string;
  amount: number;
  convertedAmount: number;
  rate: number;
  effectiveDate?: string;
}

export default function ExchangeRates() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const { canAccess, getRequiredTier } = useSubscription();

  // Dialog state
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formFromCurrency, setFormFromCurrency] = useState("USD");
  const [formToCurrency, setFormToCurrency] = useState("AED");
  const [formRate, setFormRate] = useState("");
  const [formEffectiveDate, setFormEffectiveDate] = useState(new Date().toISOString().slice(0, 10));

  // Converter state
  const [convertFrom, setConvertFrom] = useState("USD");
  const [convertTo, setConvertTo] = useState("AED");
  const [convertAmount, setConvertAmount] = useState("");
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);

  // Fetch exchange rates
  const { data: rates, isLoading: isLoadingRates } = useQuery<ExchangeRate[]>({
    queryKey: [`/api/companies/${companyId}/exchange-rates`],
    enabled: !!companyId,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: {
      fromCurrency: string;
      toCurrency: string;
      rate: number;
      effectiveDate: string;
    }) => {
      return apiRequest("POST", `/api/companies/${companyId}/exchange-rates`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/companies/${companyId}/exchange-rates`] });
      setShowAddDialog(false);
      setFormRate("");
      toast({ title: "Exchange rate added successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add rate", description: error?.message, variant: "destructive" });
    },
  });

  // Convert mutation
  const convertMutation = useMutation({
    mutationFn: async () => {
      const params = new URLSearchParams({
        from: convertFrom,
        to: convertTo,
        amount: convertAmount,
      });
      return apiRequest("GET", `/api/companies/${companyId}/exchange-rates/convert?${params}`);
    },
    onSuccess: (data: ConvertResult) => {
      setConvertResult(data);
    },
    onError: (error: Error) => {
      toast({ title: "Conversion failed", description: error?.message, variant: "destructive" });
      setConvertResult(null);
    },
  });

  const handleAddRate = () => {
    const rate = parseFloat(formRate);
    if (isNaN(rate) || rate <= 0) {
      toast({ title: "Please enter a valid rate", variant: "destructive" });
      return;
    }
    if (formFromCurrency === formToCurrency) {
      toast({ title: "Currencies must be different", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      fromCurrency: formFromCurrency,
      toCurrency: formToCurrency,
      rate,
      effectiveDate: formEffectiveDate,
    });
  };

  const handleConvert = () => {
    const amount = parseFloat(convertAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Please enter a valid amount", variant: "destructive" });
      return;
    }
    convertMutation.mutate();
  };

  if (!canAccess("multiCurrency")) {
    return (
      <UpgradePrompt feature="multiCurrency" requiredTier={getRequiredTier("multiCurrency")} />
    );
  }

  if (isLoadingCompany) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">No company found. Please create a company first.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        eyebrow="Accounting"
        title="Exchange Rates"
        description="Manage currency exchange rates and convert amounts"
        actions={
          <Button onClick={() => setShowAddDialog(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Rate
          </Button>
        }
      />

      {/* Currency Converter Widget */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Currency Converter
          </CardTitle>
          <CardDescription>Convert amounts using your latest exchange rates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label>From</Label>
              <Select value={convertFrom} onValueChange={setConvertFrom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <Select value={convertTo} onValueChange={setConvertTo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="Enter amount"
                value={convertAmount}
                onChange={(e) => {
                  setConvertAmount(e.target.value);
                  setConvertResult(null);
                }}
              />
            </div>
            <Button onClick={handleConvert} disabled={convertMutation.isPending || !convertAmount}>
              {convertMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4 mr-2" />
              )}
              Convert
            </Button>
          </div>
          {convertResult && (
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <p className="text-lg font-semibold">
                {formatNumber(convertResult.amount, locale)} {convertResult.from} ={" "}
                {formatNumber(convertResult.convertedAmount, locale)} {convertResult.to}
              </p>
              <p className="text-sm text-muted-foreground">
                Rate: 1 {convertResult.from} = {convertResult.rate.toFixed(6)} {convertResult.to}
                {convertResult.effectiveDate && (
                  <> (as of {formatDate(convertResult.effectiveDate, locale)})</>
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Exchange Rates Table */}
      <Card>
        <CardHeader>
          <CardTitle>Saved Rates</CardTitle>
          <CardDescription>All exchange rates configured for your company</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingRates ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !rates || rates.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ArrowRightLeft className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>No exchange rates configured yet.</p>
              <p className="text-sm">Add your first rate to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-medium">{rate.fromCurrency}</TableCell>
                    <TableCell className="font-medium">{rate.toCurrency}</TableCell>
                    <TableCell className="text-right font-mono">{rate.rate.toFixed(6)}</TableCell>
                    <TableCell>{formatDate(rate.effectiveDate, locale)}</TableCell>
                    <TableCell className="capitalize">{rate.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Rate Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Exchange Rate</DialogTitle>
            <DialogDescription>
              Add a new currency exchange rate for your company.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Currency</Label>
                <Select value={formFromCurrency} onValueChange={setFormFromCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>To Currency</Label>
                <Select value={formToCurrency} onValueChange={setFormToCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Rate</Label>
              <Input
                type="number"
                step="0.000001"
                min="0"
                placeholder="e.g. 3.6725"
                value={formRate}
                onChange={(e) => setFormRate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                1 {formFromCurrency} = ? {formToCurrency}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={formEffectiveDate}
                onChange={(e) => setFormEffectiveDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddRate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Adding..." : "Add Rate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
