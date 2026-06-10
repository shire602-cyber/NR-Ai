import { storage } from '../storage';
import { createLogger } from '../config/logger';
import { getStripe } from './stripe.service';

const log = createLogger('invoice-payment');

/**
 * Create a Stripe Checkout session for paying an invoice.
 * Used on the public invoice view page ("Pay Now" button).
 */
export async function createInvoicePaymentSession(
  invoiceId: string,
  returnUrl: string
): Promise<{ sessionUrl: string } | null> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.status === 'paid') throw new Error('Invoice already paid');
  if (invoice.status === 'void') throw new Error('Invoice is void');
  if (!invoice.total || invoice.total <= 0) throw new Error('Invoice total must be greater than zero');

  const company = await storage.getCompany(invoice.companyId);
  if (!company) throw new Error('Company not found');

  // Convert AED amount to fils (smallest unit) — Stripe expects amounts in smallest unit
  const amountInFils = Math.round((invoice.total || 0) * 100);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: (invoice.currency || 'AED').toLowerCase(),
          unit_amount: amountInFils,
          product_data: {
            name: `Invoice ${invoice.number}`,
            description: `Payment to ${company.name}`,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${returnUrl}?payment=success`,
    cancel_url: `${returnUrl}?payment=cancelled`,
    metadata: {
      invoiceId: invoice.id,
      companyId: invoice.companyId,
      invoiceNumber: invoice.number,
    },
  });

  // Store the payment intent reference
  if (session.payment_intent) {
    await storage.updateInvoice(invoiceId, {
      paymentIntentId: session.payment_intent as string,
    });
  }

  if (!session.url) {
    throw new Error('Stripe did not return a checkout session URL');
  }
  return { sessionUrl: session.url };
}

/**
 * Handle completed invoice payment from Stripe webhook.
 */
export async function handleInvoicePaymentCompleted(
  session: any
): Promise<void> {
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) {
    log.warn({ sessionId: session.id }, 'Invoice payment session missing invoiceId metadata');
    return;
  }

  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) {
    log.warn({ invoiceId }, 'Invoice not found for payment');
    return;
  }

  if (invoice.status === 'paid') {
    log.info({ invoiceId }, 'Invoice already marked as paid');
    return;
  }

  await storage.updateInvoice(invoiceId, {
    status: 'paid',
    paidAt: new Date(),
    paymentMethod: 'stripe',
    paymentIntentId: session.payment_intent || invoice.paymentIntentId,
  });

  log.info({ invoiceId, amount: invoice.total }, 'Invoice payment completed');
}
