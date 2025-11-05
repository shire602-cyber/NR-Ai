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
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import Tesseract from 'tesseract.js';
import { Upload, FileText, Sparkles, CheckCircle2, XCircle, Loader2, Camera, Image as ImageIcon, X, Trash2 } from 'lucide-react';
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

interface ProcessedReceipt {
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'completed' | 'saved' | 'error' | 'save_error';
  progress: number;
  data?: ExtractedData;
  error?: string;
}

export default function Receipts() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [processedReceipts, setProcessedReceipts] = useState<ProcessedReceipt[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [totalToSave, setTotalToSave] = useState(0);

  // Fetch receipts
  const { data: receipts, isLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', companyId, 'receipts'],
    enabled: !!companyId,
  });

  // Save single receipt mutation
  const saveReceiptMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', `/api/companies/${companyId}/receipts`, data);
    },
  });

  const resetForm = () => {
    setProcessedReceipts([]);
    setIsProcessingBulk(false);
    setIsSavingAll(false);
    setTotalToSave(0);
  };

  const handleFilesSelect = useCallback((files: FileList | File[]) => {
    const validFiles: ProcessedReceipt[] = [];
    const fileArray = Array.from(files);

    fileArray.forEach((file) => {
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid file',
          description: `${file.name} is not an image file`,
          variant: 'destructive',
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const preview = e.target?.result as string;
        setProcessedReceipts((prev) => [
          ...prev,
          {
            file,
            preview,
            status: 'pending',
            progress: 0,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
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
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesSelect(files);
    }
  };

  const removeReceipt = (index: number) => {
    setProcessedReceipts((prev) => prev.filter((_, i) => i !== index));
  };

  const processReceipt = async (index: number) => {
    const receipt = processedReceipts[index];
    if (!receipt) return;

    setProcessedReceipts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], status: 'processing', progress: 0 };
      return updated;
    });

    try {
      const result = await Tesseract.recognize(receipt.file, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setProcessedReceipts((prev) => {
              const updated = [...prev];
              updated[index] = { ...updated[index], progress: Math.round(m.progress * 100) };
              return updated;
            });
          }
        },
      });

      const text = result.data.text;
      
      // Validate that we got some text
      if (!text || text.trim().length < 10) {
        throw new Error('Could not extract readable text from image. Try a clearer photo.');
      }

      const parsed = parseReceiptText(text);

      // Validate that we extracted at least some useful data
      if (!parsed.merchant && !parsed.total) {
        // Set defaults but keep the raw text for manual editing
        parsed.merchant = 'Unknown Merchant';
        parsed.total = 0;
      }

      // AI categorization (only if we have some data to work with)
      if (parsed.merchant || parsed.total) {
        try {
          const category = await categorizeWithAI(parsed);
          if (category) {
            parsed.category = category;
          }
        } catch (aiError) {
          console.error('AI categorization failed, continuing without it:', aiError);
          // Don't fail the whole process if AI categorization fails
        }
      }

      setProcessedReceipts((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], status: 'completed', data: parsed, progress: 100 };
        return updated;
      });

    } catch (error: any) {
      console.error('OCR processing error:', error);
      setProcessedReceipts((prev) => {
        const updated = [...prev];
        updated[index] = { 
          ...updated[index], 
          status: 'error', 
          error: error.message || 'OCR processing failed. Try a clearer image.',
          progress: 0 
        };
        return updated;
      });
    }
  };

  const processAllReceipts = async () => {
    setIsProcessingBulk(true);
    
    for (let i = 0; i < processedReceipts.length; i++) {
      if (processedReceipts[i].status === 'pending') {
        await processReceipt(i);
      }
    }
    
    setIsProcessingBulk(false);
    toast({
      title: 'Processing Complete',
      description: `Processed ${processedReceipts.length} receipt(s)`,
    });
  };

  const parseReceiptText = (text: string): ExtractedData => {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    let merchant = '';
    let date = '';
    let total = 0;
    let vatAmount = 0;

    // Extract merchant (usually first or second non-empty line)
    if (lines.length > 0) {
      merchant = lines[0].trim();
      // If first line is too short, try second line
      if (merchant.length < 3 && lines.length > 1) {
        merchant = lines[1].trim();
      }
    }

    // Extract total - try multiple patterns
    const totalPatterns = [
      /(?:total|amount|grand total|net total)[:\s]*(?:AED|aed|dhs)?\s*([\d,]+\.?\d*)/i,
      /(?:AED|aed|dhs)[:\s]*([\d,]+\.?\d*)[\s]*(?:total)?/i,
      /([\d,]+\.?\d*)[:\s]*(?:AED|aed|dhs)/i,
    ];

    for (const pattern of totalPatterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (value > 0 && value < 1000000) { // Sanity check
          total = value;
          break;
        }
      }
    }

    // Extract VAT - try multiple patterns
    const vatPatterns = [
      /(?:vat|tax|gst)[:\s]*(?:AED|aed|dhs)?\s*([\d,]+\.?\d*)/i,
      /(?:5%|5\s*%)[:\s]*(?:AED|aed|dhs)?\s*([\d,]+\.?\d*)/i,
    ];

    for (const pattern of vatPatterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        if (value > 0 && value < total) { // VAT should be less than total
          vatAmount = value;
          break;
        }
      }
    }

    // If no VAT found but we have a total, estimate 5% UAE VAT
    if (total > 0 && vatAmount === 0) {
      // Check if the total might already include VAT (look for subtotal)
      const subtotalPattern = /(?:subtotal|sub total|sub-total)[:\s]*(?:AED|aed|dhs)?\s*([\d,]+\.?\d*)/i;
      const subtotalMatch = text.match(subtotalPattern);
      if (subtotalMatch) {
        const subtotal = parseFloat(subtotalMatch[1].replace(/,/g, ''));
        vatAmount = total - subtotal;
      }
    }

    // Extract date - try multiple formats
    const datePatterns = [
      /\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/,
      /\d{4}[-/]\d{1,2}[-/]\d{1,2}/,
      /\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}/i,
    ];

    for (const pattern of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        date = match[0];
        break;
      }
    }

    // If no date found, use today
    if (!date) {
      date = new Date().toISOString().split('T')[0];
    }

    return {
      merchant: merchant || 'Unknown Merchant',
      date,
      total,
      vatAmount,
      currency: 'AED',
      rawText: text,
      confidence: 0.85,
    };
  };

  const categorizeWithAI = async (data: ExtractedData): Promise<string | null> => {
    if (!companyId) return null;
    
    try {
      const response = await fetch('/api/ai/categorize', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          companyId,
          description: `${data.merchant || 'Unknown'} - ${data.total} ${data.currency}`,
          amount: data.total,
          currency: data.currency || 'AED',
        }),
      });

      if (response.ok) {
        const result = await response.json();
        return result.suggestedAccountName || result.category;
      }
    } catch (error) {
      console.error('AI categorization failed:', error);
    }
    return null;
  };

  const updateReceiptData = (index: number, updates: Partial<ExtractedData>) => {
    setProcessedReceipts((prev) => {
      const updated = [...prev];
      if (updated[index].data) {
        updated[index] = {
          ...updated[index],
          data: { ...updated[index].data!, ...updates },
        };
      }
      return updated;
    });
  };

  const saveAllReceipts = async () => {
    const completedIndices = processedReceipts
      .map((r, i) => ({ receipt: r, index: i }))
      .filter(({ receipt }) => receipt.status === 'completed' && receipt.data);
    
    if (completedIndices.length === 0) {
      toast({
        title: 'No receipts to save',
        description: 'Please process receipts before saving',
        variant: 'destructive',
      });
      return;
    }

    if (!companyId) {
      toast({
        title: 'Error',
        description: 'Company not found. Please try refreshing the page.',
        variant: 'destructive',
      });
      return;
    }

    // Capture total count before starting to prevent denominator from shrinking
    const total = completedIndices.length;
    setTotalToSave(total);
    setIsSavingAll(true);
    let successCount = 0;
    let errorCount = 0;

    // Save each receipt sequentially with status updates
    for (const { receipt, index } of completedIndices) {
      try {
        const receiptData = {
          companyId: companyId,
          merchant: receipt.data!.merchant || 'Unknown',
          date: receipt.data!.date || new Date().toISOString().split('T')[0],
          amount: receipt.data!.total || 0,
          vatAmount: receipt.data!.vatAmount || null,
          category: receipt.data!.category || 'Uncategorized',
          currency: receipt.data!.currency || 'AED',
          imageData: receipt.preview,
          rawText: receipt.data!.rawText,
        };

        await apiRequest('POST', `/api/companies/${companyId}/receipts`, receiptData);
        
        // Mark this receipt as saved
        setProcessedReceipts((prev) => {
          const updated = [...prev];
          updated[index] = { ...updated[index], status: 'saved' };
          return updated;
        });
        
        successCount++;
      } catch (error: any) {
        console.error('Failed to save receipt:', error);
        
        // Extract error message
        const errorMessage = error.message || 'Failed to save to database';
        
        // Mark this receipt as failed to save
        setProcessedReceipts((prev) => {
          const updated = [...prev];
          updated[index] = { 
            ...updated[index], 
            status: 'save_error',
            error: errorMessage
          };
          return updated;
        });
        
        errorCount++;
      }
    }

    // Wait for queries to invalidate and refresh
    await queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'receipts'] });
    
    setIsSavingAll(false);

    if (successCount > 0) {
      toast({
        title: 'Receipts Saved',
        description: `Successfully saved ${successCount} receipt(s)${errorCount > 0 ? `. ${errorCount} failed` : ''}`,
      });
      
      // Only clear successfully saved receipts
      if (errorCount === 0) {
        resetForm();
      } else {
        // Remove only the saved ones, keep the failed ones for retry
        setProcessedReceipts((prev) => prev.filter((r) => r.status !== 'saved'));
      }
    } else {
      toast({
        title: 'Save Failed',
        description: 'Failed to save any receipts. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const pendingCount = processedReceipts.filter((r) => r.status === 'pending').length;
  const processingCount = processedReceipts.filter((r) => r.status === 'processing').length;
  const completedCount = processedReceipts.filter((r) => r.status === 'completed').length;
  const savedCount = processedReceipts.filter((r) => r.status === 'saved').length;
  const errorCount = processedReceipts.filter((r) => r.status === 'error').length;
  const saveErrorCount = processedReceipts.filter((r) => r.status === 'save_error').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Receipt Scanner</h1>
        <p className="text-muted-foreground">
          Upload multiple receipts and let AI extract and categorize expenses automatically
        </p>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Receipts
          </CardTitle>
          <CardDescription>
            Drag & drop multiple images or click to browse (supports bulk upload)
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
              ${processedReceipts.length > 0 ? 'border-green-500 bg-green-500/5' : ''}
              hover:border-primary hover:bg-accent/50 cursor-pointer
            `}
            onClick={() => document.getElementById('file-input')?.click()}
            data-testid="drop-zone"
          >
            <input
              id="file-input"
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) handleFilesSelect(files);
              }}
              data-testid="input-file"
            />

            {processedReceipts.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <CheckCircle2 className="w-5 h-5" />
                  <span>{processedReceipts.length} image(s) loaded</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Click or drop more images to add them
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <Camera className="w-8 h-8 text-primary" />
                  </div>
                </div>
                <div>
                  <p className="text-lg font-medium">Drop your receipts here</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    or click to browse files (multiple selection supported)
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Supports: JPG, PNG, HEIC • Bulk upload enabled
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {processedReceipts.length > 0 && (
            <div className="flex gap-2">
              <Button
                onClick={processAllReceipts}
                disabled={isProcessingBulk || pendingCount === 0}
                className="flex-1"
                size="lg"
                data-testid="button-process-all"
              >
                {isProcessingBulk ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Process All Receipts ({pendingCount})
                  </>
                )}
              </Button>
              
              <Button
                onClick={saveAllReceipts}
                disabled={completedCount === 0 || isSavingAll || isProcessingBulk}
                className="flex-1"
                size="lg"
                data-testid="button-save-all"
              >
                {isSavingAll ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving ({savedCount}/{totalToSave})...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Save All ({completedCount})
                  </>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={resetForm}
                disabled={isProcessingBulk}
                data-testid="button-reset"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Status Summary */}
          {processedReceipts.length > 0 && (
            <div className="flex flex-wrap gap-2 text-sm">
              {pendingCount > 0 && (
                <Badge variant="outline">{pendingCount} pending</Badge>
              )}
              {processingCount > 0 && (
                <Badge variant="outline">{processingCount} processing</Badge>
              )}
              {completedCount > 0 && (
                <Badge variant="outline" className="bg-green-500/10 border-green-500">
                  {completedCount} ready to save
                </Badge>
              )}
              {savedCount > 0 && (
                <Badge variant="outline" className="bg-blue-500/10 border-blue-500">
                  {savedCount} saved
                </Badge>
              )}
              {errorCount > 0 && (
                <Badge variant="outline" className="bg-red-500/10 border-red-500">
                  {errorCount} OCR errors
                </Badge>
              )}
              {saveErrorCount > 0 && (
                <Badge variant="outline" className="bg-orange-500/10 border-orange-500">
                  {saveErrorCount} save failed
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Processed Receipts */}
      {processedReceipts.length > 0 && (
        <div className="space-y-3">
          {processedReceipts.map((receipt, index) => (
            <Card key={index} data-testid={`receipt-card-${index}`}>
              <CardContent className="p-4">
                <div className="flex gap-4">
                  {/* Thumbnail */}
                  <div className="relative">
                    <img
                      src={receipt.preview}
                      alt={`Receipt ${index + 1}`}
                      className="w-24 h-24 object-cover rounded-lg border"
                    />
                    <Button
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6"
                      onClick={() => removeReceipt(index)}
                      disabled={isProcessingBulk}
                      data-testid={`button-remove-${index}`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Status and Data */}
                  <div className="flex-1 space-y-3">
                    {receipt.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Pending</Badge>
                        <p className="text-sm text-muted-foreground">
                          Ready to process
                        </p>
                      </div>
                    )}

                    {receipt.status === 'processing' && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Processing with OCR...
                          </span>
                          <span>{receipt.progress}%</span>
                        </div>
                        <Progress value={receipt.progress} />
                      </div>
                    )}

                    {receipt.status === 'error' && (
                      <div className="flex items-center gap-2 text-red-600">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm">{receipt.error}</span>
                      </div>
                    )}

                    {receipt.status === 'saved' && (
                      <div className="flex items-center gap-2 text-blue-600">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-sm font-medium">Successfully saved to database</span>
                      </div>
                    )}

                    {receipt.status === 'save_error' && (
                      <div className="flex items-center gap-2 text-orange-600">
                        <XCircle className="w-4 h-4" />
                        <span className="text-sm">{receipt.error || 'Failed to save'}</span>
                      </div>
                    )}

                    {receipt.status === 'completed' && receipt.data && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs">Merchant</Label>
                          <Input
                            value={receipt.data.merchant || ''}
                            onChange={(e) =>
                              updateReceiptData(index, { merchant: e.target.value })
                            }
                            className="h-8"
                            data-testid={`input-merchant-${index}`}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Date</Label>
                          <Input
                            type="date"
                            value={receipt.data.date || ''}
                            onChange={(e) =>
                              updateReceiptData(index, { date: e.target.value })
                            }
                            className="h-8"
                            data-testid={`input-date-${index}`}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={receipt.data.total || ''}
                            onChange={(e) =>
                              updateReceiptData(index, { total: parseFloat(e.target.value) })
                            }
                            className="h-8"
                            data-testid={`input-amount-${index}`}
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs">Category</Label>
                          <Select
                            value={receipt.data.category}
                            onValueChange={(value) =>
                              updateReceiptData(index, { category: value })
                            }
                          >
                            <SelectTrigger className="h-8" data-testid={`select-category-${index}`}>
                              <SelectValue placeholder="Category" />
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
                        </div>

                        {receipt.data.confidence && (
                          <div className="col-span-2">
                            <p className="text-xs text-muted-foreground">
                              OCR Confidence: {Math.round(receipt.data.confidence * 100)}%
                              {receipt.data.category && (
                                <Badge variant="secondary" className="ml-2">
                                  <Sparkles className="w-2 h-2 mr-1" />
                                  AI
                                </Badge>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
