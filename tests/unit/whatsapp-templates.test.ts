import { describe, expect, it, vi } from 'vitest';

import {
  buildWhatsAppWebDraftUrl,
  formatPhoneForWhatsApp,
  openWhatsApp,
} from '../../client/src/lib/whatsapp-templates';

describe('whatsapp template helpers', () => {
  it('normalizes UAE phone numbers for WhatsApp Web drafts', () => {
    expect(formatPhoneForWhatsApp('050 123 4567')).toBe('971501234567');
    expect(formatPhoneForWhatsApp('+971 50 123 4567')).toBe('971501234567');
    expect(formatPhoneForWhatsApp('00971501234567')).toBe('971501234567');
  });

  it('builds WhatsApp Web draft URLs instead of native app handoff URLs', () => {
    expect(buildWhatsAppWebDraftUrl('0501234567', 'Please send docs')).toBe(
      'https://web.whatsapp.com/send?phone=971501234567&text=Please%20send%20docs&app_absent=0',
    );
  });

  it('opens fallback handoffs in WhatsApp Web so users stay in the browser review flow', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });

    openWhatsApp('+971 50 123 4567', 'Hello & review');

    expect(open).toHaveBeenCalledWith(
      'https://web.whatsapp.com/send?phone=971501234567&text=Hello%20%26%20review&app_absent=0',
      '_blank',
      'noopener,noreferrer',
    );

    vi.unstubAllGlobals();
  });
});
