import { useEffect, useRef, useState } from "react";
import { fetchSecurityConfig, loadTurnstile } from "@/lib/securityApi";
import { useTranslation } from "@/lib/i18n";

/**
 * W5-E (R17-24): renders Cloudflare Turnstile only when the server reports CAPTCHA as
 * live; otherwise renders nothing and reports `required = false`.
 */
export function TurnstileWidget({
  onToken,
  onRequired,
}: {
  onToken: (token: string | null) => void;
  onRequired?: (required: boolean) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement | null>(null);
  const [siteKey, setSiteKey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSecurityConfig().then((cfg) => {
      if (!alive) return;
      const key = cfg?.captcha.status === "live" ? cfg.captcha.siteKey : null;
      setSiteKey(key);
      onRequired?.(cfg?.captcha.status === "live");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let widgetId: string | null = null;
    loadTurnstile()
      .then(() => {
        if (!ref.current || !window.turnstile) return;
        widgetId = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          "expired-callback": () => onToken(null),
        });
      })
      .catch(() => onToken(null));
    return () => {
      if (widgetId && window.turnstile?.remove) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={ref} aria-label={t["security.captchaLabel"]} data-testid="captcha-widget" />;
}
