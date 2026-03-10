/**
 * Cross-Selling Service
 * ─────────────────────
 * Rule-based service recommendation engine for NR Accounting.
 * Identifies complementary services clients don't have and
 * generates admin-approved promotional campaigns.
 *
 * Flow:
 * 1. System identifies clients missing complementary services
 * 2. AI generates personalized messages per client language
 * 3. Admin reviews and approves the campaign
 * 4. Messages sent via WhatsApp queue (rate-limited)
 * 5. Track responses and conversions
 */

import OpenAI from 'openai';
import { createLogger } from '../config/logger';
import { getOpenAIKey, getAIModel } from '../config/settings';
import { storage } from '../storage';
import { enqueueTemplatedMessage } from './messageQueue';
import { cleanPhone, mapLocaleToLanguage, sanitizeForAI } from '../utils/locale';
import type { Company, CrossSellCampaign } from '@shared/schema';

const log = createLogger('cross-selling');

// ── NR Accounting Services Catalog ──────────────────────────────

export interface ServiceOffering {
  id: string;
  name: string;
  nameAr: string;
  nameSo: string;
  description: string;
  descriptionAr: string;
  descriptionSo: string;
  category: string;
  /** Engagement types that include this service */
  includedIn: string[];
  /** Services that commonly pair with this one */
  complementaryTo: string[];
  /** Trigger conditions for recommending this service */
  triggers: string[];
}

/**
 * NR Accounting's service catalog.
 * These are the services NR offers to their managed clients.
 */
export const SERVICE_CATALOG: ServiceOffering[] = [
  {
    id: 'vat_filing',
    name: 'VAT Filing & Compliance',
    nameAr: 'تقديم وامتثال ضريبة القيمة المضافة',
    nameSo: 'Gudbinta & Waafaqida VAT',
    description: 'Quarterly/annual VAT return preparation and filing with the FTA.',
    descriptionAr: 'إعداد وتقديم إقرارات ضريبة القيمة المضافة الربع سنوية/السنوية لدى الهيئة الاتحادية للضرائب.',
    descriptionSo: 'Diyaarinta iyo gudbinta soo-celinta VAT rubuc-sano/sannad ahaan ee FTA.',
    category: 'tax',
    includedIn: ['full_service', 'vat_only'],
    complementaryTo: ['bookkeeping', 'corporate_tax'],
    triggers: ['has_trn', 'vat_registered'],
  },
  {
    id: 'corporate_tax',
    name: 'Corporate Tax Advisory & Filing',
    nameAr: 'استشارات وتقديم ضريبة الشركات',
    nameSo: 'Latalinta & Gudbinta Canshuurta Shirkadaha',
    description: 'UAE Corporate Tax registration, compliance, and annual return filing.',
    descriptionAr: 'تسجيل ضريبة الشركات في الإمارات، والامتثال، وتقديم الإقرارات السنوية.',
    descriptionSo: 'Diiwaangelinta Canshuurta Shirkadaha UAE, waafaqida, iyo gudbinta soo-celinta sanadlaha ah.',
    category: 'tax',
    includedIn: ['full_service'],
    complementaryTo: ['vat_filing', 'bookkeeping', 'audit_prep'],
    triggers: ['revenue_above_threshold'],
  },
  {
    id: 'bookkeeping',
    name: 'Monthly Bookkeeping',
    nameAr: 'المحاسبة الشهرية',
    nameSo: 'Xisaabinta Bishii',
    description: 'Full monthly bookkeeping including bank reconciliation and financial statements.',
    descriptionAr: 'محاسبة شهرية كاملة تشمل تسوية البنك والقوائم المالية.',
    descriptionSo: 'Xisaabinta bishii oo buuxda oo ay ku jiraan heshiisinta bangiga iyo warbixinnada maaliyadda.',
    category: 'accounting',
    includedIn: ['full_service', 'bookkeeping'],
    complementaryTo: ['vat_filing', 'payroll', 'audit_prep'],
    triggers: ['no_bookkeeping'],
  },
  {
    id: 'audit_prep',
    name: 'Audit Preparation',
    nameAr: 'إعداد التدقيق',
    nameSo: 'Diyaarinta Baaritaanka',
    description: 'Annual audit preparation and coordination with external auditors.',
    descriptionAr: 'إعداد التدقيق السنوي والتنسيق مع المدققين الخارجيين.',
    descriptionSo: 'Diyaarinta baaritaanka sanadlaha ah iyo isku-dubbaridka baarayaasha dibadda.',
    category: 'audit',
    includedIn: ['full_service'],
    complementaryTo: ['bookkeeping', 'corporate_tax'],
    triggers: ['free_zone', 'mainland_llc'],
  },
  {
    id: 'payroll',
    name: 'Payroll Management',
    nameAr: 'إدارة الرواتب',
    nameSo: 'Maareynta Mushaharka',
    description: 'Monthly payroll processing, WPS compliance, and end-of-service calculations.',
    descriptionAr: 'معالجة الرواتب الشهرية، وامتثال نظام حماية الأجور، وحسابات نهاية الخدمة.',
    descriptionSo: 'Habsami wax-ku-oolka mushaharka bishii, waafaqida WPS, iyo xisaabinta dhammaadka-adeegga.',
    category: 'hr',
    includedIn: ['full_service'],
    complementaryTo: ['bookkeeping'],
    triggers: ['has_employees'],
  },
  {
    id: 'company_formation',
    name: 'Company Formation & PRO Services',
    nameAr: 'تأسيس الشركات وخدمات العلاقات العامة',
    nameSo: 'Aasaasista Shirkadaha & Adeegyada PRO',
    description: 'Trade license renewal, visa processing, and government relations.',
    descriptionAr: 'تجديد الرخصة التجارية، ومعالجة التأشيرات، والعلاقات الحكومية.',
    descriptionSo: 'Cusbooneysiinta shatiga ganacsiga, habsami wax-ku-oolka fiisaha, iyo xiriirka dawladda.',
    category: 'pro',
    includedIn: [],
    complementaryTo: ['bookkeeping', 'vat_filing'],
    triggers: ['license_renewal'],
  },
];

// ── Recommendation Engine ───────────────────────────────────────

export interface ServiceRecommendation {
  service: ServiceOffering;
  reason: string;
  companyId: string;
  companyName: string;
  locale: string;
}

/**
 * Identify cross-sell opportunities across all active clients.
 * Returns services each client doesn't currently have but could benefit from.
 */
export async function identifyOpportunities(): Promise<ServiceRecommendation[]> {
  const recommendations: ServiceRecommendation[] = [];

  try {
    const allCompanies = await storage.getAllCompaniesWithContacts();

    for (const company of allCompanies) {
      try {
        const companyId = company.id;
        const companyName = company.name;
        const locale = company.locale || 'en';

        // Get existing services from engagement
        const existingServices = await getClientServices(companyId);

        // Find services the client doesn't have
        for (const service of SERVICE_CATALOG) {
          if (existingServices.has(service.id)) continue;

          // Check if any of the client's existing services are complementary
          const hasComplementary = service.complementaryTo.some(s => existingServices.has(s));

          if (hasComplementary) {
            const existingServiceNames = [...existingServices]
              .map(s => SERVICE_CATALOG.find(sc => sc.id === s)?.name || s)
              .join(', ');

            recommendations.push({
              service,
              reason: `Client already uses ${existingServiceNames}, which pairs well with ${service.name}`,
              companyId,
              companyName,
              locale,
            });
          }
        }
      } catch (err: any) {
        log.warn({ companyId: (company as any).id, error: err.message }, 'Error analyzing company for cross-sell');
      }
    }
  } catch (err: any) {
    log.error({ error: err.message }, 'Failed to identify cross-sell opportunities');
  }

  return recommendations;
}

/**
 * Get the set of service IDs a client currently has.
 */
async function getClientServices(companyId: string): Promise<Set<string>> {
  const services = new Set<string>();

  try {
    // Check engagements for service info
    const allEngagements = await storage.getEngagementsByCompany(companyId);

    for (const engagement of allEngagements) {
      if (engagement.status !== 'active') continue;

      // Map engagement type to services
      const type = engagement.engagementType;
      for (const service of SERVICE_CATALOG) {
        if (service.includedIn.includes(type)) {
          services.add(service.id);
        }
      }

      // Check servicesIncluded JSON
      if (engagement.servicesIncluded) {
        try {
          const included = JSON.parse(engagement.servicesIncluded);
          if (Array.isArray(included)) {
            included.forEach((s: string) => services.add(s));
          }
        } catch {
          // Not valid JSON, skip
        }
      }
    }
  } catch {
    // Might not have engagements yet
  }

  return services;
}

// ── Campaign Creation ───────────────────────────────────────────

/**
 * Create a cross-sell campaign from recommendations.
 * The campaign is created in 'draft' status and needs admin approval.
 */
export async function createCampaignFromRecommendations(opts: {
  serviceId: string;
  name: string;
  description?: string;
  targetCompanyIds?: string[];
  createdBy: string;
}): Promise<CrossSellCampaign> {
  const service = SERVICE_CATALOG.find(s => s.id === opts.serviceId);
  if (!service) {
    throw new Error(`Service '${opts.serviceId}' not found in catalog`);
  }

  // Get all recommendations for this service
  const allOpportunities = await identifyOpportunities();
  let targets = allOpportunities.filter(r => r.service.id === opts.serviceId);

  // Filter to specific companies if specified
  if (opts.targetCompanyIds?.length) {
    targets = targets.filter(r => opts.targetCompanyIds!.includes(r.companyId));
  }

  // Create campaign
  const campaign = await storage.createCrossSellCampaign({
    name: opts.name,
    description: opts.description,
    serviceName: service.name,
    serviceDescription: service.description,
    targetCriteria: JSON.stringify({
      serviceId: opts.serviceId,
      targetCompanyIds: opts.targetCompanyIds,
    }),
    status: 'draft',
    createdBy: opts.createdBy,
    targetCount: targets.length,
  });

  // Create target records
  if (targets.length > 0) {
    const targetRecords = targets.map(t => ({
      campaignId: campaign.id,
      companyId: t.companyId,
      status: 'pending' as const,
    }));

    await storage.bulkCreateCrossSellTargets(targetRecords);
  }

  log.info(
    { campaignId: campaign.id, service: service.name, targets: targets.length },
    'Cross-sell campaign created',
  );

  return campaign;
}

/**
 * Generate personalized messages for campaign targets using AI.
 */
export async function generateCampaignMessages(campaignId: string): Promise<number> {
  const campaign = await storage.getCrossSellCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const targets = await storage.getCrossSellTargetsByCampaign(campaignId);
  if (targets.length === 0) return 0;

  const openai = await getOpenAIClientForCrossSell();
  let generated = 0;

  for (const target of targets) {
    try {
      const company = await storage.getCompany(target.companyId);
      if (!company) continue;

      const locale = company.locale || 'en';
      const language = locale === 'ar' ? 'Arabic' : locale === 'so' ? 'Somali' : 'English';

      const service = SERVICE_CATALOG.find(s => s.name === campaign.serviceName);

      let message: string;

      if (openai && service) {
        // Use AI to generate personalized message
        const model = await getAIModel();
        const response = await openai.chat.completions.create({
          model,
          messages: [
            {
              role: 'system',
              content: `You are writing a brief, friendly WhatsApp message for NR Accounting Services (a Dubai accounting firm) to offer a new service to an existing client. Write in ${language}. Keep it under 200 words. Be professional but warm. Do not use emojis excessively (max 1-2). Include a clear call to action. The message should feel personalized, not like a mass promotion.`,
            },
            {
              role: 'user',
              content: `Client name: ${sanitizeForAI(company.name, 200)}
Service to promote: ${sanitizeForAI(campaign.serviceName, 200)}
Service description: ${sanitizeForAI(campaign.serviceDescription || '', 500)}
Write a personalized WhatsApp message offering this service.`,
            },
          ],
          temperature: 0.7,
          max_tokens: 300,
        });

        message = response.choices[0]?.message?.content?.trim() || '';
      } else {
        // Fallback: use template
        const serviceLang = service
          ? (locale === 'ar' ? service.nameAr : locale === 'so' ? service.nameSo : service.name)
          : campaign.serviceName;
        const descLang = service
          ? (locale === 'ar' ? service.descriptionAr : locale === 'so' ? service.descriptionSo : service.description)
          : campaign.serviceDescription;

        message = locale === 'ar'
          ? `عزيزي ${company.name}، نود إعلامك بخدمة ${serviceLang} التي يمكن أن تفيد عملك. ${descLang} تواصل معنا لمعرفة المزيد! - خدمات NR المحاسبية`
          : locale === 'so'
            ? `Mudane ${company.name}, waxaan rabnay inaan kugu wargelino adeegga ${serviceLang} oo faa'iido u noqon kara ganacsigaaga. ${descLang} Nala soo xiriir si aad wax badan uga ogaato! - NR Accounting Services`
            : `Dear ${company.name}, we wanted to let you know about our ${serviceLang} service that could benefit your business. ${descLang} Contact us to learn more! - NR Accounting Services`;
      }

      if (message) {
        await storage.updateCrossSellTarget(target.id, {
          personalizedMessage: message,
        });
        generated++;
      }
    } catch (err: any) {
      log.warn(
        { targetId: target.id, error: err.message },
        'Failed to generate message for cross-sell target',
      );
    }
  }

  return generated;
}

/**
 * Approve and execute a campaign — queue messages for sending.
 */
export async function executeCampaign(
  campaignId: string,
  approvedBy: string,
): Promise<{ queued: number; failed: number }> {
  const campaign = await storage.getCrossSellCampaign(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  if (campaign.status !== 'draft' && campaign.status !== 'pending_approval') {
    throw new Error(`Campaign is in '${campaign.status}' state, cannot execute`);
  }

  // Mark as approved
  await storage.updateCrossSellCampaign(campaignId, {
    status: 'sending',
    approvedBy,
    approvedAt: new Date(),
  });

  const targets = await storage.getCrossSellTargetsByCampaign(campaignId);
  let queued = 0;
  let failed = 0;

  // ── Batch-load companies once (fixes N+1 query) ─────────────
  const companyMap = new Map<string, Company>();
  const allCompanies = await storage.getAllCompaniesWithContacts();
  for (const c of allCompanies) {
    companyMap.set(c.id, c);
  }

  for (const target of targets) {
    try {
      const company = companyMap.get(target.companyId);
      if (!company) {
        // Try direct lookup as fallback (company might not have contactPhone)
        const directCompany = await storage.getCompany(target.companyId);
        if (!directCompany) {
          failed++;
          continue;
        }
        // Company exists but has no contactPhone
        await storage.updateCrossSellTarget(target.id, {
          status: 'failed',
          lastError: 'No phone number found',
        });
        failed++;
        continue;
      }

      // Use contactPhone (the actual field name in the Company schema)
      const phone = cleanPhone(company.contactPhone);

      if (!phone) {
        await storage.updateCrossSellTarget(target.id, {
          status: 'failed',
          lastError: 'No phone number found',
        });
        failed++;
        continue;
      }

      const language = mapLocaleToLanguage(company.locale);

      // Use personalized message if available, otherwise use template
      if (target.personalizedMessage) {
        const { enqueueMessage } = await import('./messageQueue');
        const queueItemId = await enqueueMessage({
          recipientPhone: phone,
          recipientName: company.name,
          messageType: 'text',
          content: target.personalizedMessage,
          companyId: target.companyId,
          relatedEntityType: 'cross_sell_campaign',
          relatedEntityId: campaignId,
          priority: 7, // Lower priority than reminders
          status: 'queued',
          attempts: 0,
          maxAttempts: 3,
        });

        await storage.updateCrossSellTarget(target.id, {
          status: 'queued',
          queueItemId,
        });
      } else {
        // Use template
        const queueItemId = await enqueueTemplatedMessage({
          templateName: 'service_promotion',
          language,
          recipientPhone: phone,
          recipientName: company.name,
          placeholders: {
            clientName: company.name,
            serviceName: campaign.serviceName,
            serviceDescription: campaign.serviceDescription,
          },
          companyId: target.companyId,
          relatedEntityType: 'cross_sell_campaign',
          relatedEntityId: campaignId,
          priority: 7,
        });

        await storage.updateCrossSellTarget(target.id, {
          status: 'queued',
          queueItemId,
        });
      }

      queued++;
    } catch (err: any) {
      log.error(
        { targetId: target.id, error: err.message },
        'Failed to queue cross-sell message',
      );
      await storage.updateCrossSellTarget(target.id, {
        status: 'failed',
        lastError: err.message,
      });
      failed++;
    }
  }

  // Update campaign stats
  const finalStatus = failed === targets.length ? 'failed' : 'completed';
  await storage.updateCrossSellCampaign(campaignId, {
    status: finalStatus,
    sentCount: queued,
    failedCount: failed,
    completedAt: new Date(),
  });

  log.info(
    { campaignId, queued, failed },
    'Cross-sell campaign executed',
  );

  return { queued, failed };
}

/**
 * Get the service catalog with localized names.
 */
export function getServiceCatalog(language?: string): Array<{
  id: string;
  name: string;
  description: string;
  category: string;
}> {
  return SERVICE_CATALOG.map(s => ({
    id: s.id,
    name: language === 'ar' ? s.nameAr : language === 'so' ? s.nameSo : s.name,
    description: language === 'ar' ? s.descriptionAr : language === 'so' ? s.descriptionSo : s.description,
    category: s.category,
  }));
}

// ── Helpers ─────────────────────────────────────────────────────

async function getOpenAIClientForCrossSell(): Promise<OpenAI | null> {
  const apiKey = await getOpenAIKey();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}
