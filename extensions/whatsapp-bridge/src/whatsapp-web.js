const BANNER_ID = 'nr-whatsapp-bridge-banner';

function ensureBanner() {
  if (document.getElementById(BANNER_ID)) return;
  const params = new URLSearchParams(window.location.search);
  if (!params.get('phone') || !params.get('text')) return;

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.textContent = 'NR WhatsApp Bridge: review this drafted message, then press Send in WhatsApp Web.';
  banner.style.position = 'fixed';
  banner.style.zIndex = '2147483647';
  banner.style.left = '50%';
  banner.style.bottom = '24px';
  banner.style.transform = 'translateX(-50%)';
  banner.style.maxWidth = '520px';
  banner.style.padding = '12px 16px';
  banner.style.borderRadius = '8px';
  banner.style.background = '#111827';
  banner.style.color = '#fff';
  banner.style.boxShadow = '0 12px 30px rgba(0,0,0,.28)';
  banner.style.font = '13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  banner.style.textAlign = 'center';
  document.documentElement.appendChild(banner);

  window.setTimeout(() => {
    banner.remove();
  }, 12000);
}

ensureBanner();
window.addEventListener('popstate', ensureBanner);

let lastHref = window.location.href;
window.setInterval(() => {
  if (window.location.href === lastHref) return;
  lastHref = window.location.href;
  ensureBanner();
}, 1000);
