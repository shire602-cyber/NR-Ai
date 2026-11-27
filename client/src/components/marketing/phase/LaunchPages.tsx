import { Link } from "wouter";
import { MARKETING_BRAND } from "@shared/marketing-brand";
import { features, type Bilingual } from "./content";
import type { LaunchPagePath } from "./editorial/pages";
import { featurePath } from "./route-content";

const invoiceSample = "/samples/muhasib-sample-invoice.pdf";
type Translate = (text: Bilingual) => string;

export function LaunchPages({
  path,
  base,
  tr,
}: {
  path: LaunchPagePath;
  base: string;
  tr: Translate;
}) {
  // /tools is rendered by pages/ToolsIndex (lazy), not here.
  if (path === "/product") {
    return (
      <div className="phase-feature-grid">
        {features.map((feature) => (
          <Link
            className="phase-card phase-feature-card"
            key={feature.slug}
            href={base + featurePath(feature.slug)}
          >
            <h2>{tr(feature.title)}</h2>
            <p>{tr(feature.lead)}</p>
          </Link>
        ))}
      </div>
    );
  }
  if (path === "/tools/invoice-template") {
    return (
      <div className="phase-form">
        <a className="phase-button phase-primary" href={invoiceSample} download>
          {tr(["Download the sample PDF", "حمّل نموذج PDF"])}
        </a>
        <p>
          {tr([
            "The sample uses fictional records. A structured e-invoice uses machine-readable data and a separate provider workflow.",
            "يستخدم النموذج بيانات افتراضية. وتعتمد الفاتورة الإلكترونية المهيكلة على بيانات قابلة للقراءة آليًا ومسار عمل منفصل عبر مزوّد الخدمة.",
          ])}
        </p>
        <Link className="phase-textlink" href={`${base}/product/invoicing`}>
          {tr(["See the invoicing workflow", "اطّلع على طريقة إصدار الفواتير"])}
        </Link>
      </div>
    );
  }
  if (path === "/about" || path === "/contact") {
    return (
      <div className="phase-split">
        <article className="phase-card">
          <h2>{tr(["Software and support", "البرنامج والدعم"])} </h2>
          <p>
            {tr([
              "For help with your workspace or a question about a plan, email our team.",
              "للمساعدة في استخدام مساحة عملك أو للاستفسار عن إحدى الباقات، راسل فريقنا.",
            ])}
          </p>
          <a className="phase-textlink" href={`mailto:${MARKETING_BRAND.supportEmail}`} dir="ltr">
            {MARKETING_BRAND.supportEmail}
          </a>
        </article>
        <article className="phase-card">
          <h2>{tr(["Demos and accounting services", "العروض التوضيحية والخدمات المحاسبية"])}</h2>
          <div className="phase-cta-row">
            <Link className="phase-button phase-primary" href={`${base}/book-demo`}>
              {tr(["Request a demo", "اطلب عرضًا توضيحيًا"])}
            </Link>
            <Link className="phase-button phase-outline" href={`${base}/services`}>
              {tr(["Accounting services", "الخدمات المحاسبية"])}
            </Link>
          </div>
        </article>
      </div>
    );
  }
  return null;
}
