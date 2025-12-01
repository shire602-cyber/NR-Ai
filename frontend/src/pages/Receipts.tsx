import { useState, useCallback, useEffect, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format, isWithinInterval, parseISO, startOfDay, endOfDay } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { useToast } from '@/hooks/use-toast';
import { useDefaultCompany } from '@/hooks/useDefaultCompany';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { DateRangeFilter, type DateRange } from '@/components/DateRangeFilter';
import { exportToExcel, exportToGoogleSheets, prepareReceiptsForExport } from '@/lib/export';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
import { Upload, FileText, Sparkles, CheckCircle2, XCircle, Loader2, Camera, Image as ImageIcon, X, Trash2, Edit, Download, FileSpreadsheet } from 'lucide-react';
import { SiGooglesheets } from 'react-icons/si';
import { formatCurrency } from '@/lib/format';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

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

const receiptSchema = z.object({
  merchant: z.string().min(1, 'Merchant name is required'),
  date: z.string().min(1, 'Date is required'),
  amount: z.coerce.number().min(0, 'Amount must be positive'),
  vatAmount: z.coerce.number().nullable(),
  category: z.string().nullable(),
  currency: z.string().default('AED'),
});

type ReceiptFormData = z.infer<typeof receiptSchema>;

export default function Receipts() {
  const { t, locale } = useTranslation();
  const { toast } = useToast();
  const { companyId, isLoading: isLoadingCompany } = useDefaultCompany();
  const [processedReceipts, setProcessedReceipts] = useState<ProcessedReceipt[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessingBulk, setIsProcessingBulk] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [totalToSave, setTotalToSave] = useState(0);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<any>(null);
  const [postDialogOpen, setPostDialogOpen] = useState(false);
  const [postingReceipt, setPostingReceipt] = useState<any>(null);
  const [selectedExpenseAccount, setSelectedExpenseAccount] = useState<string>('');
  const [selectedPaymentAccount, setSelectedPaymentAccount] = useState<string>('');
  const [createAccountDialogOpen, setCreateAccountDialogOpen] = useState(false);
  const [newAccountType, setNewAccountType] = useState<'expense' | 'asset'>('expense');
  const [newAccountCode, setNewAccountCode] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [similarWarningOpen, setSimilarWarningOpen] = useState(false);
  const [similarTransactions, setSimilarTransactions] = useState<any[]>([]);
  const [pendingSaveData, setPendingSaveData] = useState<any>(null);
  const [dateRange, setDateRange] = useState<DateRange>({ from: undefined, to: undefined });
  const [isExporting, setIsExporting] = useState(false);
  const [manualExpenseDialogOpen, setManualExpenseDialogOpen] = useState(false);
  
  const manualExpenseForm = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      merchant: '',
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      vatAmount: null,
      category: '',
      currency: 'AED',
    },
  });

  // Fetch receipts
  const { data: receipts, isLoading } = useQuery<any[]>({
    queryKey: ['/api/companies', companyId, 'receipts'],
    enabled: !!companyId,
  });

  // Fetch accounts for posting
  const { data: accounts } = useQuery<any[]>({
    queryKey: ['/api/companies', companyId, 'accounts'],
    enabled: !!companyId,
  });

  const form = useForm<ReceiptFormData>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      merchant: '',
      date: '',
      amount: 0,
      vatAmount: null,
      category: '',
      currency: 'AED',
    },
  });

  // Save single receipt mutation
  const saveReceiptMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('POST', `/api/companies/${companyId}/receipts`, data);
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ReceiptFormData }) => 
      apiRequest('PUT', `/api/receipts/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'receipts'] });
      toast({
        title: 'Receipt updated successfully',
        description: 'Your receipt has been updated.',
      });
      setEditDialogOpen(false);
      setEditingReceipt(null);
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to update receipt',
        description: error.message || 'Please try again.',
      });
    },
  });

  const postExpenseMutation = useMutation({
    mutationFn: ({ id, accountId, paymentAccountId }: { id: string; accountId: string; paymentAccountId: string }) => 
      apiRequest('POST', `/api/receipts/${id}/post`, { accountId, paymentAccountId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'receipts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'journal-entries'] });
      toast({
        title: 'Expense posted successfully',
        description: 'Journal entry has been created.',
      });
      setPostDialogOpen(false);
      setPostingReceipt(null);
      setSelectedExpenseAccount('');
      setSelectedPaymentAccount('');
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to post expense',
        description: error.message || 'Please try again.',
      });
    },
  });

  const manualExpenseMutation = useMutation({
    mutationFn: async (data: ReceiptFormData) => {
      return apiRequest('POST', `/api/companies/${companyId}/receipts`, {
        merchant: data.merchant,
        date: data.date,
        amount: data.amount,
        vatAmount: data.vatAmount,
        category: data.category,
        currency: data.currency,
        status: 'pending',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'receipts'] });
      toast({
        title: 'Expense created successfully',
        description: 'The expense has been added. You can now post it to the journal.',
      });
      setManualExpenseDialogOpen(false);
      manualExpenseForm.reset();
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create expense',
        description: error.message || 'Please try again.',
      });
    },
  });

  const createAccountMutation = useMutation({
    mutationFn: (data: any) => 
      apiRequest('POST', `/api/companies/${companyId}/accounts`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'accounts'] });
      toast({
        title: 'Account created successfully',
        description: `${data.nameEn} has been added.`,
      });
      setCreateAccountDialogOpen(false);
      setNewAccountCode('');
      setNewAccountName('');
      // Auto-select the new account if it matches the type
      if (newAccountType === 'expense') {
        setSelectedExpenseAccount(data.id);
      } else if (newAccountType === 'asset') {
        setSelectedPaymentAccount(data.id);
      }
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to create account',
        description: error.message || 'Please try again.',
      });
    },
  });

  const checkSimilarMutation = useMutation({
    mutationFn: (data: any) => 
      apiRequest('POST', `/api/companies/${companyId}/receipts/check-similar`, data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => 
      apiRequest('DELETE', `/api/receipts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/companies', companyId, 'receipts'] });
      toast({
        title: 'Expense deleted',
        description: 'The expense has been deleted successfully.',
      });
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Failed to delete expense',
        description: error.message || 'Please try again.',
      });
    },
  });

  const handleDeleteReceipt = (receipt: any) => {
    if (window.confirm('Are you sure you want to delete this expense? This action cannot be undone.')) {
      deleteMutation.mutate(receipt.id);
    }
  };

  const handleEditReceipt = (receipt: any) => {
    setEditingReceipt(receipt);
    form.reset({
      merchant: receipt.merchant || '',
      date: receipt.date || '',
      amount: receipt.amount || 0,
      vatAmount: receipt.vatAmount || null,
      category: receipt.category || '',
      currency: receipt.currency || 'AED',
    });
    setEditDialogOpen(true);
  };

  const handlePostExpense = (receipt: any) => {
    setPostingReceipt(receipt);
    setSelectedExpenseAccount('');
    setSelectedPaymentAccount('');
    setPostDialogOpen(true);
  };

  const submitPostExpense = () => {
    if (!postingReceipt || !selectedExpenseAccount || !selectedPaymentAccount) {
      toast({
        variant: 'destructive',
        title: 'Missing information',
        description: 'Please select both expense and payment accounts.',
      });
      return;
    }

    postExpenseMutation.mutate({
      id: postingReceipt.id,
      accountId: selectedExpenseAccount,
      paymentAccountId: selectedPaymentAccount,
    });
  };

  const onEditSubmit = (data: ReceiptFormData) => {
    if (!editingReceipt) return;
    
    // Clean up data: convert empty strings to null for optional UUID fields, ensure numeric conversion
    const cleanedData = {
      ...data,
      amount: Number(data.amount),
      category: data.category === '' ? null : data.category,
      vatAmount: data.vatAmount === 0 || data.vatAmount === null || isNaN(data.vatAmount as number) ? null : Number(data.vatAmount),
    };
    
    editMutation.mutate({ id: editingReceipt.id, data: cleanedData });
  };

  const resetForm = () => {
    setProcessedReceipts([]);
    setIsProcessingBulk(false);
    setIsSavingAll(false);
    setTotalToSave(0);
  };

  const onManualExpenseSubmit = (data: ReceiptFormData) => {
    manualExpenseMutation.mutate({
      ...data,
      amount: Number(data.amount),
      vatAmount: data.vatAmount === 0 || data.vatAmount === null || isNaN(data.vatAmount as number) ? null : Number(data.vatAmount),
    });
  };

  const convertPdfToImage = async (file: File): Promise<{ blob: Blob; preview: string }> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    
    const scale = 2;
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    await page.render({
      canvasContext: context,
      viewport: viewport,
      canvas: canvas,
    } as any).promise;
    
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const preview = canvas.toDataURL('image/png');
        resolve({ blob: blob!, preview });
      }, 'image/png');
    });
  };

  const handleFilesSelect = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      
      if (!isImage && !isPdf) {
        toast({
          title: 'Invalid file',
          description: `${file.name} must be an image or PDF file`,
          variant: 'destructive',
        });
        continue;
      }

      if (isPdf) {
        try {
          toast({
            title: 'Converting PDF',
            description: `Processing first page of ${file.name}...`,
          });
          
          const { blob, preview } = await convertPdfToImage(file);
          const imageFile = new File([blob], file.name.replace('.pdf', '.png'), { type: 'image/png' });
          
          setProcessedReceipts((prev) => [
            ...prev,
            {
              file: imageFile,
              preview,
              status: 'pending',
              progress: 0,
            },
          ]);
          
          toast({
            title: 'PDF converted',
            description: `${file.name} converted successfully. Only the first page is processed.`,
          });
        } catch (error: any) {
          console.error('PDF conversion error:', error);
          toast({
            title: 'PDF conversion failed',
            description: `Could not convert ${file.name}. Please upload an image instead (JPG, PNG, HEIC).`,
            variant: 'destructive',
          });
        }
      } else {
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
      }
    }
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

    // Proceed with save directly - similar check removed for better UX
    await performSave(completedIndices);
  };

  const performSave = async (completedIndices: any[]) => {

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
          amount: Number(receipt.data!.total) || 0,
          vatAmount: receipt.data!.vatAmount ? Number(receipt.data!.vatAmount) : null,
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

  const filteredReceipts = useMemo(() => {
    if (!receipts || receipts.length === 0) return [];
    if (!dateRange.from && !dateRange.to) return receipts;
    
    const fromDate = dateRange.from ? startOfDay(dateRange.from) : null;
    const toDate = dateRange.to ? endOfDay(dateRange.to) : null;
    
    return receipts.filter((receipt: any) => {
      if (!receipt.date) return false;
      
      const receiptDate = typeof receipt.date === 'string' 
        ? parseISO(receipt.date) 
        : new Date(receipt.date);
      
      if (fromDate && toDate) {
        return isWithinInterval(receiptDate, { start: fromDate, end: toDate });
      }
      if (fromDate) {
        return receiptDate >= fromDate;
      }
      if (toDate) {
        return receiptDate <= toDate;
      }
      return true;
    });
  }, [receipts, dateRange.from, dateRange.to]);

  const handleExportExcel = () => {
    if (!filteredReceipts.length) {
      toast({ variant: 'destructive', title: 'No data', description: 'No expenses to export' });
      return;
    }
    
    const dateRangeStr = dateRange.from && dateRange.to 
      ? `_${format(dateRange.from, 'yyyy-MM-dd')}_to_${format(dateRange.to, 'yyyy-MM-dd')}`
      : '';
    
    exportToExcel([prepareReceiptsForExport(filteredReceipts, locale)], `expenses${dateRangeStr}`);
    toast({ title: 'Export successful', description: `${filteredReceipts.length} expenses exported to Excel` });
  };

  const handleExportGoogleSheets = async () => {
    if (!companyId || !filteredReceipts.length) {
      toast({ variant: 'destructive', title: 'No data', description: 'No expenses to export' });
      return;
    }
    
    setIsExporting(true);
    const dateRangeStr = dateRange.from && dateRange.to 
      ? ` (${format(dateRange.from, 'MMM dd, yyyy')} - ${format(dateRange.to, 'MMM dd, yyyy')})`
      : '';

    const result = await exportToGoogleSheets(
      [prepareReceiptsForExport(filteredReceipts, locale)],
      `Expenses${dateRangeStr}`,
      companyId
    );

    setIsExporting(false);

    if (result.success) {
      toast({ 
        title: 'Export successful', 
        description: `${filteredReceipts.length} expenses exported to Google Sheets` 
      });
      if (result.spreadsheetUrl) {
        window.open(result.spreadsheetUrl, '_blank');
      }
    } else {
      toast({ 
        variant: 'destructive',
        title: 'Export failed', 
        description: result.error || 'Failed to export to Google Sheets' 
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Receipt Scanner</h1>
          <p className="text-muted-foreground">
            Upload receipts for AI extraction or enter manually
          </p>
        </div>
        <Button onClick={() => setManualExpenseDialogOpen(true)} data-testid="button-add-manual-expense">
          + Add Expense Manually
        </Button>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Receipts
          </CardTitle>
          <CardDescription>
            Drag & drop receipt images or click to browse (supports bulk upload)
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
              accept="image/*,application/pdf"
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
                  Supports: JPG, PNG, HEIC, PDF • Bulk upload enabled
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
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle>Recent Expenses</CardTitle>
              <CardDescription>Previously scanned and saved expenses</CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={isExporting} data-testid="button-export-expenses">
                  <Download className="w-4 h-4 mr-2" />
                  {isExporting ? 'Exporting...' : 'Export'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportExcel} data-testid="menu-export-expenses-excel">
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  Export to Excel
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportGoogleSheets} data-testid="menu-export-expenses-sheets">
                  <SiGooglesheets className="w-4 h-4 mr-2" />
                  Export to Google Sheets
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap pb-4 border-b">
            <span className="text-sm font-medium">Filter by date:</span>
            <DateRangeFilter 
              dateRange={dateRange} 
              onDateRangeChange={setDateRange} 
            />
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredReceipts && filteredReceipts.length > 0 ? (
            <div className="space-y-2">
              {filteredReceipts.map((receipt: any) => (
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
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-mono font-semibold">
                        {formatCurrency(receipt.amount || 0, 'AED', locale)}
                      </p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="outline">
                          {receipt.category || 'Uncategorized'}
                        </Badge>
                        {receipt.posted && (
                          <Badge variant="default" className="bg-green-600">
                            Posted
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!receipt.posted && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => handlePostExpense(receipt)}
                          data-testid={`button-post-receipt-${receipt.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Post
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditReceipt(receipt)}
                        data-testid={`button-edit-receipt-${receipt.id}`}
                      >
                        <Edit className="w-4 h-4 mr-2" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteReceipt(receipt)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-receipt-${receipt.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
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

      {/* Edit Receipt Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Receipt</DialogTitle>
            <DialogDescription>
              Update receipt details
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="merchant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Merchant</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-edit-merchant" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" data-testid="input-edit-date" />
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
                    <FormLabel>Amount</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        step="0.01" 
                        className="font-mono"
                        value={field.value ?? ''} 
                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : '')}
                        data-testid="input-edit-amount" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vatAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>VAT Amount (Optional)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" step="0.01" className="font-mono" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : null)} data-testid="input-edit-vat" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                      <FormControl>
                        <SelectTrigger data-testid="select-edit-category">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
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
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={editMutation.isPending} className="flex-1" data-testid="button-submit-edit-receipt">
                  {editMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Similar Transactions Warning Dialog */}
      <Dialog open={similarWarningOpen} onOpenChange={setSimilarWarningOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-yellow-500" />
              Similar Transactions Found
            </DialogTitle>
            <DialogDescription>
              We found similar transactions that might be duplicates. Review them before proceeding.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {similarTransactions.map((transaction, idx) => (
                <div key={idx} className="p-3 border rounded-md bg-muted/50">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">{transaction.merchant || 'Unknown Merchant'}</p>
                      <p className="text-sm text-muted-foreground">{transaction.date}</p>
                      {transaction.category && (
                        <Badge variant="outline" className="mt-1">{transaction.category}</Badge>
                      )}
                    </div>
                    <p className="font-mono font-semibold">
                      {formatCurrency(transaction.amount || 0, 'AED', locale)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setSimilarWarningOpen(false);
                  setPendingSaveData(null);
                  setSimilarTransactions([]);
                }}
                className="flex-1"
                data-testid="button-cancel-similar-warning"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setSimilarWarningOpen(false);
                  if (pendingSaveData) {
                    await performSave(pendingSaveData);
                  }
                  setPendingSaveData(null);
                  setSimilarTransactions([]);
                }}
                className="flex-1"
                data-testid="button-save-anyway"
              >
                Save Anyway
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Account Dialog */}
      <Dialog open={createAccountDialogOpen} onOpenChange={setCreateAccountDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Account</DialogTitle>
            <DialogDescription>
              Add a new {newAccountType === 'expense' ? 'expense' : 'payment'} account
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-code">Account Code</Label>
              <Input 
                id="account-code"
                value={newAccountCode}
                onChange={(e) => setNewAccountCode(e.target.value)}
                placeholder="e.g., 5220"
                data-testid="input-account-code"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-name">Account Name</Label>
              <Input 
                id="account-name"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                placeholder="e.g., Travel Expenses"
                data-testid="input-account-name"
              />
            </div>
            <div className="flex gap-3 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setCreateAccountDialogOpen(false)} 
                className="flex-1"
                disabled={createAccountMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                type="button" 
                onClick={() => {
                  if (!newAccountCode.trim() || !newAccountName.trim()) {
                    toast({
                      variant: 'destructive',
                      title: 'Missing information',
                      description: 'Please enter both account code and name.',
                    });
                    return;
                  }
                  createAccountMutation.mutate({
                    code: newAccountCode.trim(),
                    nameEn: newAccountName.trim(),
                    nameAr: newAccountName.trim(),
                    type: newAccountType,
                    isActive: true,
                  });
                }}
                disabled={createAccountMutation.isPending || !newAccountCode.trim() || !newAccountName.trim()}
                className="flex-1"
                data-testid="button-create-account-submit"
              >
                {createAccountMutation.isPending ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post Expense Dialog */}
      <Dialog open={postDialogOpen} onOpenChange={setPostDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Post Expense to Journal</DialogTitle>
            <DialogDescription>
              Select accounts to create journal entry for this expense
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {postingReceipt && (
              <div className="p-4 rounded-md bg-muted">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{postingReceipt.merchant || 'Unknown Merchant'}</p>
                    <p className="text-sm text-muted-foreground">{postingReceipt.date}</p>
                  </div>
                  <p className="font-mono font-semibold text-lg">
                    {formatCurrency((postingReceipt.amount || 0) + (postingReceipt.vatAmount || 0), 'AED', locale)}
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="expense-account">Expense Account (Debit)</Label>
                <Button 
                  type="button" 
                  size="sm" 
                  variant="ghost"
                  onClick={() => {
                    setNewAccountType('expense');
                    setCreateAccountDialogOpen(true);
                  }}
                  data-testid="button-create-expense-account"
                >
                  + Create
                </Button>
              </div>
              <Select value={selectedExpenseAccount} onValueChange={setSelectedExpenseAccount}>
                <SelectTrigger id="expense-account" data-testid="select-expense-account">
                  <SelectValue placeholder="Select expense account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.filter(acc => acc.type === 'expense').map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      {locale === 'ar' && account.nameAr ? account.nameAr : account.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The account that will be debited (increased) for this expense
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="payment-account">Payment Account (Credit)</Label>
                <Button 
                  type="button" 
                  size="sm" 
                  variant="ghost"
                  onClick={() => {
                    setNewAccountType('asset');
                    setCreateAccountDialogOpen(true);
                  }}
                  data-testid="button-create-payment-account"
                >
                  + Create
                </Button>
              </div>
              <Select value={selectedPaymentAccount} onValueChange={setSelectedPaymentAccount}>
                <SelectTrigger id="payment-account" data-testid="select-payment-account">
                  <SelectValue placeholder="Select payment account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts?.filter(acc => acc.type === 'asset').map(account => (
                    <SelectItem key={account.id} value={account.id}>
                      {locale === 'ar' && account.nameAr ? account.nameAr : account.nameEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The cash or bank account that was used to pay (will be credited/decreased)
              </p>
            </div>

            <div className="p-4 rounded-md border bg-card">
              <p className="text-sm font-medium mb-2">Journal Entry Preview:</p>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>Dr. {accounts?.find(a => a.id === selectedExpenseAccount)?.nameEn || 'Expense Account'}</span>
                  <span>{formatCurrency((postingReceipt?.amount || 0) + (postingReceipt?.vatAmount || 0), 'AED', locale)}</span>
                </div>
                <div className="flex justify-between pl-4">
                  <span>Cr. {accounts?.find(a => a.id === selectedPaymentAccount)?.nameEn || 'Payment Account'}</span>
                  <span>{formatCurrency((postingReceipt?.amount || 0) + (postingReceipt?.vatAmount || 0), 'AED', locale)}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setPostDialogOpen(false)} 
                className="flex-1"
                disabled={postExpenseMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                type="button" 
                onClick={submitPostExpense} 
                disabled={postExpenseMutation.isPending || !selectedExpenseAccount || !selectedPaymentAccount} 
                className="flex-1"
                data-testid="button-submit-post-expense"
              >
                {postExpenseMutation.isPending ? 'Posting...' : 'Post to Journal'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manual Expense Entry Dialog */}
      <Dialog open={manualExpenseDialogOpen} onOpenChange={setManualExpenseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Expense Manually</DialogTitle>
            <DialogDescription>
              Enter expense details without OCR scanning
            </DialogDescription>
          </DialogHeader>
          <Form {...manualExpenseForm}>
            <form onSubmit={manualExpenseForm.handleSubmit(onManualExpenseSubmit)} className="space-y-4">
              <FormField
                control={manualExpenseForm.control}
                name="merchant"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Merchant/Vendor</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Office Depot" {...field} data-testid="input-manual-merchant" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={manualExpenseForm.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-manual-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={manualExpenseForm.control}
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount (AED)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-manual-amount" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={manualExpenseForm.control}
                name="vatAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>VAT Amount (Optional)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="0.00" {...field} value={field.value ?? ''} data-testid="input-manual-vat" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={manualExpenseForm.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Office Supplies" {...field} value={field.value ?? ''} data-testid="input-manual-category" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setManualExpenseDialogOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={manualExpenseMutation.isPending} className="flex-1" data-testid="button-submit-manual-expense">
                  {manualExpenseMutation.isPending ? 'Creating...' : 'Create Expense'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
