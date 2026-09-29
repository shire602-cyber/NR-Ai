// Shared fixtures for the Arabic PDF rendering tests. Values only; no secrets.
export const ARABIC_COMPANY = "شركة الخليج للتجارة ذ.م.م";
export const ARABIC_CUSTOMER = "مؤسسة النخبة للمقاولات العامة والصيانة - فرع أبوظبي";
export const ARABIC_LINE = "خدمات استشارية محاسبية وضريبية (شهر أغسطس)";
export const TRN = "100123456700003";

const date = new Date("2026-08-15T00:00:00Z");

export const company: any = {
  id: "c1",
  name: ARABIC_COMPANY,
  companyType: "customer",
  trnVatNumber: TRN,
  businessAddress: "مكتب 1204، برج الأعمال، شارع الشيخ زايد، دبي",
  contactPhone: "+971 4 123 4567",
  contactEmail: "info@example.ae",
};

export const invoiceLines: any[] = [
  { id: "l1", description: ARABIC_LINE, quantity: 2, unitPrice: 500, vatRate: 0.05 },
  { id: "l2", description: "Software licence - annual", quantity: 1, unitPrice: 1200, vatRate: 0.05 },
];

export const invoice: any = {
  id: "i1",
  number: "INV-2026-0042",
  date,
  dueDate: date,
  status: "sent",
  currency: "AED",
  customerName: ARABIC_CUSTOMER,
  customerTrn: "100987654300003",
  customerAddress: "شارع المرور، أبوظبي، الإمارات العربية المتحدة",
  subtotal: 2200,
  vatAmount: 110,
  total: 2310,
  reverseCharge: false,
  paymentTerms: "net30",
};

export const creditNote: any = {
  id: "cn1",
  number: "CN-2026-0007",
  date,
  status: "issued",
  currency: "AED",
  customerName: ARABIC_CUSTOMER,
  customerTrn: "100987654300003",
  reason: "إرجاع بضاعة تالفة",
  subtotal: 1000,
  vatAmount: 50,
  total: 1050,
};

export const quote: any = {
  id: "q1",
  number: "QT-2026-0011",
  date,
  expiryDate: date,
  status: "sent",
  currency: "AED",
  customerName: ARABIC_CUSTOMER,
  customerTrn: "100987654300003",
  subtotal: 1000,
  vatAmount: 50,
  total: 1050,
};

export const purchaseOrder: any = {
  id: "po1",
  number: "PO-2026-0003",
  date,
  expectedDeliveryDate: date,
  status: "sent",
  currency: "AED",
  vendorName: ARABIC_CUSTOMER,
  vendorTrn: "100987654300003",
  subtotal: 1000,
  vatAmount: 50,
  total: 1050,
};

export const docLines: any[] = [
  { id: "d1", description: ARABIC_LINE, quantity: 2, unitPrice: 500, vatRate: 0.05 },
];
