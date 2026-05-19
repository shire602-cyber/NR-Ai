export const CLIENT_SERVICE_OPTIONS = [
  {
    code: 'vat',
    label: 'VAT',
    shortLabel: 'VAT',
    description: 'VAT returns, VAT workpapers, FTA copy fields, and VAT evidence follow-up.',
  },
  {
    code: 'bookkeeping',
    label: 'Bookkeeping',
    shortLabel: 'Books',
    description: 'Monthly source documents, receipts, bank reconciliation, and close readiness.',
  },
  {
    code: 'corporate_tax',
    label: 'Corporate Tax',
    shortLabel: 'CT',
    description: 'Corporate tax registration, annual tax prep, and filing-readiness tracking.',
  },
  {
    code: 'accounting',
    label: 'Accounting Review',
    shortLabel: 'Accounting',
    description: 'Trial balance review, journal posting, and manager review workflow.',
  },
] as const;

export type ClientServiceCode = typeof CLIENT_SERVICE_OPTIONS[number]['code'];

export type ClientServicePlan = {
  engagementId: string | null;
  engagementType: string;
  servicesIncluded: ClientServiceCode[];
  source: 'engagement' | 'default';
  status: string;
  monthlyFee: number | null;
  billingCycle: string | null;
};

export const DEFAULT_CLIENT_SERVICE_CODES: ClientServiceCode[] = [
  'vat',
  'bookkeeping',
  'corporate_tax',
  'accounting',
];

const VALID_CLIENT_SERVICE_CODES = new Set<ClientServiceCode>(
  CLIENT_SERVICE_OPTIONS.map(option => option.code),
);

export function normalizeClientServices(
  value: unknown,
  fallback: readonly ClientServiceCode[] = DEFAULT_CLIENT_SERVICE_CODES,
): ClientServiceCode[] {
  let raw: unknown = value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [...fallback];

    try {
      raw = JSON.parse(trimmed);
    } catch {
      raw = trimmed.split(',').map(part => part.trim());
    }
  }

  if (!Array.isArray(raw)) return [...fallback];

  const normalized: ClientServiceCode[] = [];
  for (const item of raw) {
    const code = String(item).trim().toLowerCase() as ClientServiceCode;
    if (VALID_CLIENT_SERVICE_CODES.has(code) && !normalized.includes(code)) {
      normalized.push(code);
    }
  }

  return normalized.length > 0 ? normalized : [...fallback];
}

export function clientHasService(
  services: readonly ClientServiceCode[] | null | undefined,
  service: ClientServiceCode,
): boolean {
  return (services ?? DEFAULT_CLIENT_SERVICE_CODES).includes(service);
}

export function serviceLabels(services: readonly ClientServiceCode[]): string[] {
  return services.map(
    service => CLIENT_SERVICE_OPTIONS.find(option => option.code === service)?.shortLabel ?? service,
  );
}

export function engagementTypeForServices(services: readonly ClientServiceCode[]): string {
  const unique = normalizeClientServices(services);
  if (unique.length >= DEFAULT_CLIENT_SERVICE_CODES.length) return 'full_service';
  if (unique.length === 1) {
    if (unique[0] === 'corporate_tax') return 'corporate_tax_only';
    return `${unique[0]}_only`;
  }
  return 'custom_scope';
}
