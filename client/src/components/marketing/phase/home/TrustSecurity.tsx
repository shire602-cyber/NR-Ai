import {
  ArrowRight,
  FileDown,
  History,
  Lock,
  ShieldCheck,
  Smartphone,
  UserRoundX,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import type { SectionProps } from "./types";
import { SHOW_DATA_RESIDENCY } from "./flags";
import { ProofPlaceholder } from "./ProofPlaceholder";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";
import { useMarketingText, type MarketingKey } from "./text";
import "./trust.css";

/*
 * Facts only. Each entry is backed by code (checked read-only):
 *  roles   server/middleware/companyRolePolicy.ts (POLICY_RULES)
 *  audit   server/routes/audit.routes.ts (company audit log)
 *  mfa     server/services/mfa.service.ts (TOTP)
 *  lockout server/routes/auth.routes.ts (LockoutTracker on sign-in)
 *  tls     HTTPS with Strict-Transport-Security (server/middleware/security.ts)
 *  export  server/routes/backups.routes.ts (decrypted JSON export for owners and admins)
 */
const FACTS: readonly { id: string; icon: LucideIcon; title: MarketingKey; desc: MarketingKey }[] =
  [
    { id: "roles", icon: ShieldCheck, title: "hxTrustRolesTitle", desc: "hxTrustRolesDesc" },
    { id: "audit", icon: History, title: "hxTrustAuditTitle", desc: "hxTrustAuditDesc" },
    { id: "mfa", icon: Smartphone, title: "hxTrustMfaTitle", desc: "hxTrustMfaDesc" },
    { id: "lockout", icon: UserRoundX, title: "hxTrustLockTitle", desc: "hxTrustLockDesc" },
    { id: "tls", icon: Lock, title: "hxTrustTlsTitle", desc: "hxTrustTlsDesc" },
    { id: "export", icon: FileDown, title: "hxTrustExportTitle", desc: "hxTrustExportDesc" },
  ];

export function TrustSecurity({ base, locale }: SectionProps) {
  const text = useMarketingText(locale);
  return (
    <section id="trust" data-testid="section-trust" className="mz-band mz-band--light mz-trust">
      <div className="phase-wrap">
        <SectionHead title={text("hxTrustTitle")} lead={text("hxTrustLead")} />
        <Reveal>
          <ul className="mz-trust-grid" aria-label={text("hxTrustListLabel")}>
            {FACTS.map(({ id, icon: Icon, title, desc }) => (
              <li className="mz-trust-fact" data-fact={id} key={id}>
                <Icon aria-hidden="true" />
                <h3>{text(title)}</h3>
                <p>{text(desc)}</p>
              </li>
            ))}
          </ul>
        </Reveal>
        {SHOW_DATA_RESIDENCY && <p className="mz-trust-residency">{text("hxTrustResidency")}</p>}
        <ProofPlaceholder locale={locale} variant="stories" />
        <Link className="phase-textlink" href={`${base}/trust`}>
          {text("hxTrustLink")} <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
