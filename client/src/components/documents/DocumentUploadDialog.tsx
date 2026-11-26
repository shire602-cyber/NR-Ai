import { DatePicker } from "@/components/ui/date-picker";
import { FileDrop } from "@/components/ui/file-drop";
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
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";
import { Loader2 } from "lucide-react";

export interface NewDocumentForm {
  name: string;
  nameAr: string;
  category: string;
  description: string;
  expiryDate: string;
  reminderDays: number;
}

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newDocument: NewDocumentForm;
  setNewDocument: (next: NewDocumentForm) => void;
  selectedFile: File | null;
  setSelectedFile: (file: File | null) => void;
  categories: readonly { value: string; labelEn: string; labelAr: string }[];
  isUploading: boolean;
  onCancel: () => void;
  onUpload: () => void;
}

export default function DocumentUploadDialog({
  open,
  onOpenChange,
  newDocument,
  setNewDocument,
  selectedFile,
  setSelectedFile,
  categories,
  isUploading,
  onCancel,
  onUpload,
}: DocumentUploadDialogProps) {
  const { t, locale } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {locale === "ar" ? "رفع مستند جديد" : t["documentVault.uploadNewDocument"]}
          </DialogTitle>
          <DialogDescription>
            {locale === "ar"
              ? "ارفع مستنداً مهماً مثل الرخصة التجارية أو العقود"
              : t["documentVault.uploadAnImportantDocumentLike"]}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{locale === "ar" ? "اسم المستند (إنجليزي)" : "Document name (English)"}</Label>
              <Input
                dir="ltr"
                value={newDocument.name}
                onChange={(e) => setNewDocument({ ...newDocument, name: e.target.value })}
                placeholder={t["documentVault.tradeLicense2025"]}
                data-testid="input-document-name"
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === "ar" ? "اسم المستند (عربي)" : "Document name (Arabic)"}</Label>
              <Input
                value={newDocument.nameAr}
                onChange={(e) => setNewDocument({ ...newDocument, nameAr: e.target.value })}
                placeholder="الرخصة التجارية 2025"
                dir="rtl"
                data-testid="input-document-name-ar"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{locale === "ar" ? "الفئة" : "Category"}</Label>
            <Select
              value={newDocument.category}
              onValueChange={(val) => setNewDocument({ ...newDocument, category: val })}
            >
              <SelectTrigger
                data-testid="select-document-category"
                aria-label={t["documentVault.documentCategory"]}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {locale === "ar" ? cat.labelAr : cat.labelEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>{locale === "ar" ? "الوصف (اختياري)" : "Description (optional)"}</Label>
            <Textarea
              value={newDocument.description}
              onChange={(e) => setNewDocument({ ...newDocument, description: e.target.value })}
              placeholder={
                locale === "ar"
                  ? "أضف ملاحظات حول هذا المستند..."
                  : "Add notes about this document..."
              }
              data-testid="input-document-description"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>
                {locale === "ar" ? "تاريخ الانتهاء (اختياري)" : "Expiry date (optional)"}
              </Label>
              <DatePicker
                value={newDocument.expiryDate}
                onChange={(v) => setNewDocument({ ...newDocument, expiryDate: v })}
                data-testid="input-expiry-date"
              />
            </div>
            <div className="space-y-2">
              <Label>{locale === "ar" ? "تذكير قبل (أيام)" : "Remind before (days)"}</Label>
              <Input
                type="number"
                value={newDocument.reminderDays}
                onChange={(e) =>
                  setNewDocument({
                    ...newDocument,
                    reminderDays: parseInt(e.target.value) || 30,
                  })
                }
                min="1"
                max="365"
                data-testid="input-reminder-days"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{locale === "ar" ? "الملف" : "File"}</Label>
            <FileDrop
              accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
              inputTestId="input-document-file"
              value={
                selectedFile
                  ? `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)`
                  : undefined
              }
              onFiles={([f]) => setSelectedFile(f ?? null)}
              onClear={() => setSelectedFile(null)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {locale === "ar" ? "إلغاء" : "Cancel"}
          </Button>
          <Button onClick={onUpload} disabled={isUploading} data-testid="button-confirm-upload">
            {isUploading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {locale === "ar" ? "رفع" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
