import { Link } from "wouter";
import { BrandMark } from "@/components/BrandMark";
import { MARKETING_BRAND, supportEmail } from "@shared/marketing-brand";
import { editorialPages } from "../editorial/pages";
import type { LegacySectionProps } from "./types";
import { useMarketingText } from "./text";

export function SiteFooter({ base, locale, tr }: LegacySectionProps) {
  const text = useMarketingText(locale);
  return (
    <footer id="footer" data-testid="section-footer" className="phase-footer">
      <div className="phase-wrap">
        <Link className="phase-brand" href={base} translate="no">
          <BrandMark size="sm" />
          <bdi>{MARKETING_BRAND.name[locale]}</bdi>
        </Link>
        <nav aria-label={text("hxFootLabel")}>
          <Link href={`${base}/trust`}>{tr(editorialPages["/trust"].title)}</Link>
          <Link href={`${base}/tools`}>{text("hxFootFreeTools")}</Link>
          <Link href={`${base}/compare`}>{text("hxFootCompare")}</Link>
          <Link href={`${base}/uae-e-invoicing`}>{text("hxFootEinvoicing")}</Link>
          <Link href={`${base}/about`}>{tr(["About", "عن الشركة"])}</Link>
          <Link href={`${base}/contact`}>{tr(["Contact", "تواصل معنا"])}</Link>
          <Link href="/cookies">{tr(["Cookies", "ملفات تعريف الارتباط"])}</Link>
          <Link href="/privacy">{tr(["Privacy", "الخصوصية"])}</Link>
          <Link href="/terms">{tr(["Terms", "الشروط"])}</Link>
          <Link href="/help">{tr(["Help", "المساعدة"])}</Link>
          <a href={`mailto:${supportEmail}`} dir="ltr">
            {supportEmail}
          </a>
        </nav>
      </div>
    </footer>
  );
}
