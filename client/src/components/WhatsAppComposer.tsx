import { useEffect, useMemo, useState } from 'react';
import { SiWhatsapp } from 'react-icons/si';
import { Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useI18n } from '@/lib/i18n';
import {
  MESSAGE_TEMPLATES,
  fillTemplate,
  openWhatsApp,
  pickWhatsAppNumber,
  type MessageTemplate,
} from '@/lib/whatsapp-templates';

export interface WhatsAppComposerRecipient {
  name?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
}

interface WhatsAppComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipient?: WhatsAppComposerRecipient | null;
  // Pre-filled message body. Editable.
  defaultMessage?: string;
  // Restrict the template picker by category (e.g. invoice, payment).
  allowedCategories?: MessageTemplate['category'][];
  // Default template to apply if defaultMessage is not provided.
  defaultTemplateId?: string;
  // Variables to feed templates when applied.
  templateVars?: Record<string, string>;
  title?: string;
  description?: string;
}

export function WhatsAppComposer({
  open,
  onOpenChange,
  recipient,
  defaultMessage,
  allowedCategories,
  defaultTemplateId,
  templateVars,
  title,
  description,
}: WhatsAppComposerProps) {
  const { locale } = useI18n();
  const { toast } = useToast();
  const en = locale !== 'ar';

  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [templateId, setTemplateId] = useState<string>('');

  const visibleTemplates = useMemo(() => {
    if (!allowedCategories || allowedCategories.length === 0) return MESSAGE_TEMPLATES;
    return MESSAGE_TEMPLATES.filter((t) => allowedCategories.includes(t.category));
  }, [allowedCategories]);

  const applyTemplate = (id: string) => {
    const tpl = MESSAGE_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    const str = en ? tpl.template : tpl.templateAr;
    const vars = {
      customer_name: recipient?.name || (en ? '[Customer Name]' : '[اسم العميل]'),
      ...(templateVars || {}),
    };
    setMessage(fillTemplate(str, vars));
  };

  useEffect(() => {
    if (!open) return;
    setPhone(pickWhatsAppNumber(recipient || {}) || '');
    if (defaultMessage) {
      setMessage(defaultMessage);
      setTemplateId('');
    } else if (defaultTemplateId) {
      setTemplateId(defaultTemplateId);
      applyTemplate(defaultTemplateId);
    } else {
      setMessage('');
      setTemplateId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSend = () => {
    const trimmed = phone.trim();
    if (!trimmed) {
      toast({
        title: en ? 'Phone number required' : 'رقم الهاتف مطلوب',
        variant: 'destructive',
      });
      return;
    }
    if (!message.trim()) {
      toast({
        title: en ? 'Message required' : 'الرسالة مطلوبة',
        variant: 'destructive',
      });
      return;
    }

    apiRequest('POST', '/api/integrations/whatsapp/log-message', {
      to: trimmed,
      message,
    }).catch(() => {});

    openWhatsApp(trimmed, message);
    toast({ title: en ? 'Opening WhatsApp...' : 'جاري فتح واتساب...' });

    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations/whatsapp/messages'] });
    }, 1000);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SiWhatsapp className="w-5 h-5 text-green-500" />
            {title || (en ? 'Send WhatsApp Message' : 'إرسال رسالة واتساب')}
          </DialogTitle>
          <DialogDescription>
            {description ||
              (en
                ? 'Compose and send via your personal WhatsApp Desktop or Web. The message will be logged to your history.'
                : 'اكتب وأرسل عبر واتساب الشخصي. ستُسجَّل الرسالة في السجل.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{en ? 'Recipient' : 'المستلم'}</Label>
            {recipient?.name && (
              <p className="text-sm text-muted-foreground">{recipient.name}</p>
            )}
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={en ? 'e.g. 971501234567' : 'مثال: 971501234567'}
              data-testid="composer-phone"
            />
          </div>

          <div className="space-y-2">
            <Label>{en ? 'Template' : 'القالب'}</Label>
            <Select
              value={templateId}
              onValueChange={(val) => {
                setTemplateId(val);
                applyTemplate(val);
              }}
            >
              <SelectTrigger data-testid="composer-template">
                <SelectValue placeholder={en ? 'Choose a template…' : 'اختر قالب…'} />
              </SelectTrigger>
              <SelectContent>
                {visibleTemplates.map((tpl) => (
                  <SelectItem key={tpl.id} value={tpl.id}>
                    {en ? tpl.name : tpl.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{en ? 'Message' : 'الرسالة'}</Label>
            <Textarea
              rows={8}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              data-testid="composer-message"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {en ? 'Cancel' : 'إلغاء'}
          </Button>
          <Button
            onClick={handleSend}
            className="bg-green-600 hover:bg-green-700"
            data-testid="composer-send"
          >
            <Send className="w-4 h-4 mr-2" />
            {en ? 'Open in WhatsApp' : 'فتح في واتساب'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
