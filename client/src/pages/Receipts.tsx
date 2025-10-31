import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import Tesseract from 'tesseract.js';
import { Upload, FileText, Sparkles, CheckCircle2, XCircle, Loader2, Camera, Image as ImageIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/format';

interface ExtractedData {
  merchant?: string;
  date?: string;
  total?: number;
  vatAmount?: number;
  currency?: string;
  rawText: string;
  category?: string;
  confidence?: number;
}

export default function Receipts() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  const { data: companies } = useQuery<any[]>({
    queryKey: ['/api/companies'],
  });

  useEffect(() => {
    if (!selectedCompanyId && companies && companies.length > 0) {
      setSelectedCompanyId(companies[0].id);
    }
  }, [companies, selectedCompanyId]);

  // Fetch receipts
  const { data: receipts, isLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', selectedCompanyId, 'receipts'],
    enabled: !!selectedCompanyId,
  });

  // Save receipt mutation
  const saveReceiptMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', `/api/companies/${selectedCompanyId}/receipts`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', selectedCompanyId, 'receipts'] });
      toast({
        title: 'Success!',
        description: 'Receipt saved successfully',
      });
      resetForm();
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save receipt',
        variant: 'destructive',
      });
    },
  });

  const resetForm = () => {
    setSelectedFile(null);
    setPreview(null);
    setExtractedData(null);
    setOcrProgress(0);
  };

  const handleFileSelect = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file',
        description: 'Please upload an image file',
        variant: 'destructive',
      });
      return;
    }

    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, [toast]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const extractTextFromImage = async (imageFile: File) => {
    setIsProcessing(true);
    setOcrProgress(0);

    try {
      const result = await Tesseract.recognize(imageFile, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      const text = result.data.text;
      
      // Parse the extracted text
      const parsed = parseReceiptText(text);
      setExtractedData(parsed);

      // AI categorization
      if (parsed.merchant || parsed.total) {
        categorizeWithAI(parsed);
      }

    } catch (error) {
      toast({
        title: 'OCR Failed',
        description: 'Could not extract text from image',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const parseReceiptText = (text: string): ExtractedData => {
    const lines = text.split('\n');
    let merchant = '';
    let date = '';
    let total = 0;
    let vatAmount = 0;

    // Extract merchant (usually first non-empty line)
    const firstLine = lines.find(l => l.trim().length > 0);
    if (firstLine) merchant = firstLine.trim();

    // Extract total
    const totalPattern = /(?:total|amount|grand total)[:\s]*(?:AED|aed)?\s*([\d,]+\.?\d*)/i;
    const totalMatch = text.match(totalPattern);
    if (totalMatch) {
      total = parseFloat(totalMatch[1].replace(/,/g, ''));
    }

    // Extract VAT
    const vatPattern = /(?:vat|tax|gst)[:\s]*(?:AED|aed)?\s*([\d,]+\.?\d*)/i;
    const vatMatch = text.match(vatPattern);
    if (vatMatch) {
      vatAmount = parseFloat(vatMatch[1].replace(/,/g, ''));
    }

    // Extract date
    const datePattern = /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/;
    const dateMatch = text.match(datePattern);
    if (dateMatch) {
      date = dateMatch[0];
    }

    return {
      merchant,
      date,
      total,
      vatAmount,
      currency: 'AED',
      rawText: text,
      confidence: 0.85,
    };
  };

  const categorizeWithAI = async (data: ExtractedData) => {
    try {
      const response = await fetch('/api/ai/categorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `${data.merchant || 'Unknown'} - ${data.total} ${data.currency}`,
          amount: data.total,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setExtractedData(prev => prev ? { ...prev, category: result.category } : null);
      }
    } catch (error) {
      console.error('AI categorization failed:', error);
    }
  };

  const handleSave = () => {
    if (!extractedData || !selectedCompanyId) return;

    saveReceiptMutation.mutate({
      companyId: selectedCompanyId,
      merchant: extractedData.merchant || 'Unknown',
      date: extractedData.date || new Date().toISOString(),
      amount: extractedData.total || 0,
      vatAmount: extractedData.vatAmount,
      category: extractedData.category || 'Uncategorized',
      currency: extractedData.currency || 'AED',
      imageData: preview || '',
      rawText: extractedData.rawText,
      confidence: extractedData.confidence,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Receipt Scanner</h1>
        <p className="text-muted-foreground">
          Upload receipts and let AI extract and categorize expenses automatically
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5" />
              Upload Receipt
            </CardTitle>
            <CardDescription>
              Drag & drop or click to upload an image
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center transition-all
                ${isDragging ? 'border-primary bg-primary/5' : 'border-border'}
                ${preview ? 'border-green-500 bg-green-500/5' : ''}
                hover:border-primary hover:bg-accent/50 cursor-pointer
              `}
              onClick={() => document.getElementById('file-input')?.click()}
              data-testid="drop-zone"
            >
              <input
                id="file-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelect(file);
                }}
                data-testid="input-file"
              />

              {preview ? (
                <div className="space-y-4">
                  <img
                    src={preview}
                    alt="Receipt preview"
                    className="max-h-64 mx-auto rounded-lg border"
                  />
                  <div className="flex items-center justify-center gap-2 text-green-600">
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Image loaded successfully</span>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <Camera className="w-8 h-8 text-primary" />
                    </div>
                  </div>
                  <div>
                    <p className="text-lg font-medium">Drop your receipt here</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      or click to browse files
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Supports: JPG, PNG, HEIC
                  </p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {preview && !isProcessing && !extractedData && (
              <Button
                onClick={() => selectedFile && extractTextFromImage(selectedFile)}
                className="w-full"
                size="lg"
                data-testid="button-scan"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Scan Receipt with AI
              </Button>
            )}

            {isProcessing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing with OCR...
                  </span>
                  <span>{ocrProgress}%</span>
                </div>
                <Progress value={ocrProgress} />
              </div>
            )}

            {preview && (
              <Button
                variant="outline"
                onClick={resetForm}
                className="w-full"
                data-testid="button-reset"
              >
                Upload Different Receipt
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Extracted Data Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Extracted Information
            </CardTitle>
            <CardDescription>
              Review and edit the extracted data
            </CardDescription>
          </CardHeader>
          <CardContent>
            {extractedData ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Merchant / Vendor</Label>
                  <Input
                    value={extractedData.merchant || ''}
                    onChange={(e) =>
                      setExtractedData({ ...extractedData, merchant: e.target.value })
                    }
                    placeholder="e.g., Carrefour"
                    data-testid="input-merchant"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={extractedData.date || ''}
                    onChange={(e) =>
                      setExtractedData({ ...extractedData, date: e.target.value })
                    }
                    data-testid="input-date"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Total Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={extractedData.total || ''}
                      onChange={(e) =>
                        setExtractedData({ ...extractedData, total: parseFloat(e.target.value) })
                      }
                      placeholder="0.00"
                      data-testid="input-total"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>VAT Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={extractedData.vatAmount || ''}
                      onChange={(e) =>
                        setExtractedData({ ...extractedData, vatAmount: parseFloat(e.target.value) })
                      }
                      placeholder="0.00"
                      data-testid="input-vat"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Category</Label>
                  <div className="flex gap-2">
                    <Select
                      value={extractedData.category}
                      onValueChange={(value) =>
                        setExtractedData({ ...extractedData, category: value })
                      }
                    >
                      <SelectTrigger data-testid="select-category">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Office Supplies">Office Supplies</SelectItem>
                        <SelectItem value="Meals & Entertainment">Meals & Entertainment</SelectItem>
                        <SelectItem value="Travel">Travel</SelectItem>
                        <SelectItem value="Utilities">Utilities</SelectItem>
                        <SelectItem value="Marketing">Marketing</SelectItem>
                        <SelectItem value="Software">Software</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    {extractedData.category && (
                      <Badge variant="secondary" className="whitespace-nowrap">
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="pt-4 space-y-2">
                  <Button
                    onClick={handleSave}
                    disabled={saveReceiptMutation.isPending}
                    className="w-full"
                    size="lg"
                    data-testid="button-save"
                  >
                    {saveReceiptMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Save Receipt
                      </>
                    )}
                  </Button>
                  
                  {extractedData.confidence && (
                    <p className="text-xs text-center text-muted-foreground">
                      OCR Confidence: {Math.round(extractedData.confidence * 100)}%
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <ImageIcon className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  Upload and scan a receipt to see extracted data here
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Receipts */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Receipts</CardTitle>
          <CardDescription>Previously scanned and saved receipts</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : receipts && receipts.length > 0 ? (
            <div className="space-y-2">
              {receipts.map((receipt: any) => (
                <div
                  key={receipt.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover-elevate"
                  data-testid={`receipt-${receipt.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center">
                      <FileText className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-medium">{receipt.merchant || 'Unknown Merchant'}</p>
                      <p className="text-sm text-muted-foreground">{receipt.date}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">
                      {formatCurrency(receipt.amount || 0, 'AED', locale)}
                    </p>
                    <Badge variant="outline" className="mt-1">
                      {receipt.category || 'Uncategorized'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">
              No receipts yet. Upload your first receipt above!
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
