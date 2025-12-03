import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Gift, Sparkles, X } from 'lucide-react';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/lib/api';

interface EmailPopupProps {
  open: boolean;
  onClose: () => void;
  locale?: string;
}

export function EmailPopup({ open, onClose, locale = 'en' }: EmailPopupProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes('@')) {
      toast({
        title: locale === 'en' ? 'Invalid Email' : 'بريد إلكتروني غير صالح',
        description: locale === 'en' ? 'Please enter a valid email address' : 'يرجى إدخال عنوان بريد إلكتروني صالح',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    
    try {
      const response = await fetch(apiUrl('/api/waitlist'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'popup' }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }

      toast({
        title: locale === 'en' ? 'Success!' : 'نجح!',
        description: locale === 'en' 
          ? "You're on the list! Check your email for the lifetime deal details." 
          : 'أنت في القائمة! تحقق من بريدك الإلكتروني للحصول على تفاصيل العرض.',
      });

      setEmail('');
      onClose();
    } catch (error: any) {
      toast({
        title: locale === 'en' ? 'Error' : 'خطأ',
        description: error.message || (locale === 'en' ? 'Failed to join waitlist' : 'فشل الانضمام إلى القائمة'),
        variant: 'destructive',
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
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
          data-testid="button-close-popup"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </button>
        
        <DialogHeader className="space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center">
            <Gift className="w-8 h-8 text-primary-foreground" />
          </div>
          
          <DialogTitle className="text-center text-2xl">
            {locale === 'en' ? 'Lifetime Deal Alert!' : 'عرض مدى الحياة!'}
          </DialogTitle>
          
          <DialogDescription className="text-center text-base">
            {locale === 'en' 
              ? "Join our exclusive waitlist for a chance to get lifetime access at a one-time payment. Limited spots available!" 
              : 'انضم إلى قائمة الانتظار الحصرية للحصول على فرصة الوصول مدى الحياة بدفعة لمرة واحدة. الأماكن محدودة!'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-sm font-medium">
              {locale === 'en' ? 'Email Address' : 'البريد الإلكتروني'}
            </Label>
            <Input
              id="email"
              type="email"
              placeholder={locale === 'en' ? 'you@example.com' : 'you@example.com'}
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
            {loading 
              ? (locale === 'en' ? 'Joining...' : 'جاري الانضمام...')
              : (locale === 'en' ? 'Claim My Spot' : 'احجز مكاني')}
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            {locale === 'en' 
              ? 'No spam. Ever. Just the lifetime deal details when available.' 
              : 'لا بريد عشوائي. أبدا. فقط تفاصيل العرض عندما تكون متاحة.'}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
