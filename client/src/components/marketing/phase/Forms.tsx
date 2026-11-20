import { useRef, useState, type FormEvent } from "react";
import { normalizeCallbackPhone } from "@shared/demo-callback";
import { supportEmail } from "@shared/marketing-brand";
import type { Bilingual, SiteLocale } from "./content";

type Translate = (text: Bilingual) => string;
const checks: readonly Bilingual[] = [
  [
    "Our company and customer tax details are up to date.",
    "البيانات الضريبية لشركتنا وعملائنا محدّثة.",
  ],
  [
    "We can identify the invoices and credit notes covered by the rules.",
    "يمكننا تحديد الفواتير والإشعارات الدائنة الخاضعة للقواعد.",
  ],
  ["We have selected an accredited service provider.", "اخترنا مزوّد خدمة معتمدًا."],
  [
    "We have tested the exchange of structured invoices with our provider.",
    "اختبرنا تبادل الفواتير المهيكلة مع مزوّد الخدمة.",
  ],
];

export function FreeTool({
  slug,
  tr,
  locale,
}: {
  slug: string;
  tr: Translate;
  locale: SiteLocale;
}) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("add");
  const [taxClass, setTaxClass] = useState("standard");
  const [completed, setCompleted] = useState<Set<number>>(() => new Set());
  const format = new Intl.NumberFormat(locale === "ar" ? "ar-AE" : "en-AE", {
    style: "currency",
    currency: "AED",
  });
  const corporate = slug === "corporate-tax-estimator";
  const value = Number(amount);
  const valid =
    amount.trim() !== "" &&
    Number.isFinite(value) &&
    value <= 1_000_000_000_000 &&
    (corporate || value >= 0);
  const cents = Math.round(value * 100);
  const taxCents = corporate
    ? Math.round((Math.max(0, cents - 37_500_000) * 9) / 100)
    : taxClass !== "standard"
      ? 0
      : Math.round(cents * (mode === "extract" ? 5 / 105 : 5 / 100));
  const money = (minor: number) => <bdi>{format.format(minor / 100)}</bdi>;
  if (slug === "e-invoicing-readiness")
    return (
      <div className="phase-form">
        <p>
          {tr([
            "Work through these setup checks with your finance team. Check which rules and dates apply to your business with the Ministry of Finance.",
            "راجع خطوات الإعداد مع فريقك المالي. تحقّق من القواعد والمواعيد المطبقة على شركتك لدى وزارة المالية.",
          ])}
        </p>
        <fieldset>
          <legend>{tr(["Setup checklist", "قائمة الإعداد"])}</legend>
          {checks.map((check, i) => (
            <label className="phase-check" key={check[0]}>
              <input
                type="checkbox"
                checked={completed.has(i)}
                onChange={(e) => {
                  const next = new Set(completed);
                  if (e.target.checked) next.add(i);
                  else next.delete(i);
                  setCompleted(next);
                }}
              />
              {tr(check)}
            </label>
          ))}
        </fieldset>
        <output className="phase-result" aria-live="polite">
          {tr([
            `${completed.size} of ${checks.length} checks completed`,
            `اكتملت ${completed.size} من ${checks.length} خطوات`,
          ])}
        </output>
        <a className="phase-textlink" href="https://mof.gov.ae/einvoicing/">
          {tr([
            "Ministry of Finance e-invoicing guidance",
            "إرشادات وزارة المالية للفوترة الإلكترونية",
          ])}
        </a>
      </div>
    );
  return (
    <div className="phase-form">
      {corporate ? (
        <p>
          {tr([
            "For the standard UAE corporate tax regime, taxable income up to AED 375,000 is taxed at 0%, with 9% on the portion above that threshold.",
            "في النظام العام لضريبة الشركات في الإمارات، تخضع الأرباح الخاضعة للضريبة حتى 375,000 درهم لنسبة 0%، ويخضع الجزء الزائد لنسبة 9%.",
          ])}
        </p>
      ) : null}
      <label>
        {tr(
          corporate
            ? ["Taxable income (AED)", "الدخل الخاضع للضريبة (درهم)"]
            : ["Amount (AED)", "المبلغ (درهم)"]
        )}
        <input
          type="number"
          dir="ltr"
          inputMode="decimal"
          min={corporate ? undefined : 0}
          max={1_000_000_000_000}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>
      {!corporate && (
        <>
          <label>
            {tr(["VAT treatment", "المعاملة الضريبية"])}
            <select value={taxClass} onChange={(e) => setTaxClass(e.target.value)}>
              <option value="standard">
                {tr(["Standard-rated (5%)", "النسبة الأساسية (5%)"])}
              </option>
              <option value="zero">{tr(["Zero-rated (0%)", "خاضع لنسبة الصفر (0%)"])}</option>
              <option value="exempt">{tr(["Exempt", "معفى"])}</option>
            </select>
          </label>
          {taxClass === "standard" && (
            <label>
              {tr(["Calculation", "طريقة الحساب"])}
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="add">
                  {tr(["Add 5% VAT to a net amount", "أضف 5% إلى المبلغ قبل الضريبة"])}
                </option>
                <option value="extract">
                  {tr([
                    "Extract 5% VAT from a gross amount",
                    "استخرج ضريبة 5% من المبلغ الشامل للضريبة",
                  ])}
                </option>
              </select>
            </label>
          )}
          <p>
            {tr([
              "Zero-rated supplies are taxable at 0% and may allow recovery of related input VAT. Exempt supplies generally do not allow recovery of related input VAT.",
              "التوريدات الخاضعة لنسبة الصفر توريدات خاضعة للضريبة بنسبة 0% وقد تتيح استرداد ضريبة المدخلات المرتبطة بها. أما التوريدات المعفاة فلا تتيح عادةً استرداد ضريبة المدخلات المرتبطة بها.",
            ])}
          </p>
        </>
      )}
      <output className="phase-result" aria-live="polite">
        {valid ? (
          <>
            <span>
              {tr(corporate ? ["Estimated tax", "الضريبة المقدّرة"] : ["VAT", "الضريبة"])}{" "}
              {money(taxCents)}
            </span>
            {!corporate && (
              <span>
                {tr(["Net", "الصافي"])} {money(mode === "extract" ? cents - taxCents : cents)} {"·"}{" "}
                {tr(["Total", "الإجمالي"])} {money(mode === "extract" ? cents : cents + taxCents)}
              </span>
            )}
          </>
        ) : (
          tr(["Enter a valid amount to calculate.", "أدخل مبلغاً صالحاً للحساب."])
        )}
      </output>
      {corporate && (
        <p>
          {tr([
            "Small Business Relief may apply if you meet the Federal Tax Authority’s conditions and elect to use it. This estimate does not apply relief, credits or special tax regimes.",
            "قد ينطبق تسهيل الأعمال الصغيرة إذا استوفيت شروط الهيئة الاتحادية للضرائب واخترت الاستفادة منه. لا يشمل هذا التقدير التسهيلات أو الأرصدة الضريبية أو الأنظمة الضريبية الخاصة.",
          ])}
        </p>
      )}
    </div>
  );
}

export function DemoRequest({ tr }: { tr: Translate }) {
  const [status, setStatus] = useState<"idle" | "sending" | "accepted" | "invalid" | "error">(
    "idle"
  );
  const [invalidPhone, setInvalidPhone] = useState(false);
  const phoneInput = useRef<HTMLInputElement>(null);
  const submission = useRef<{ payload: string; id: string }>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending" || status === "accepted") return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const phone = normalizeCallbackPhone(String(data.phone ?? ""));
    setInvalidPhone(phone === null);
    if (phone === null) {
      setStatus("idle");
      phoneInput.current?.focus();
      return;
    }
    data.phone = phone;
    const payload = JSON.stringify(data);
    if (submission.current?.payload !== payload) {
      submission.current = { payload, id: crypto.randomUUID() };
    }
    setStatus("sending");
    try {
      const token = await fetch("/api/csrf-token", { cache: "no-store" });
      if (!token.ok) throw new Error();
      const { csrfToken } = await token.json();
      const response = await fetch("/api/marketing/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ ...data, requestId: submission.current.id }),
      });
      if (response.status === 400) {
        const invalid = await response.json();
        setInvalidPhone(invalid.field === "phone");
        setStatus(invalid.field === "phone" ? "idle" : "invalid");
      } else {
        setStatus(response.status === 202 ? "accepted" : "error");
      }
    } catch {
      setStatus("error");
    }
  }
  return (
    <form className="phase-form" onSubmit={submit}>
      <p>
        {tr([
          "Request a callback for a walkthrough. Tell us when you’re usually available in Dubai time (UTC+4). We’ll contact you to arrange a time.",
          "اطلب اتصالاً لشرح طريقة العمل. أخبرنا بالأوقات المناسبة لك عادةً بتوقيت دبي (UTC+4)، وسنتواصل معك لتحديد الموعد.",
        ])}
      </p>
      {status !== "accepted" && (
        <fieldset disabled={status === "sending"}>
          <label>
            {tr(["Name", "الاسم"])}
            <input name="name" autoComplete="name" required maxLength={100} />
          </label>
          <label>
            {tr(["Work email", "البريد الإلكتروني للعمل"])}
            <input
              name="email"
              type="email"
              autoComplete="email"
              dir="ltr"
              required
              maxLength={254}
            />
          </label>
          <label>
            {tr(["Phone number", "رقم الهاتف"])}
            <input
              ref={phoneInput}
              name="phone"
              type="tel"
              autoComplete="tel"
              dir="ltr"
              required
              maxLength={32}
              aria-invalid={invalidPhone || undefined}
              aria-describedby={invalidPhone ? "callback-phone-error" : undefined}
              onChange={() => setInvalidPhone(false)}
            />
          </label>
          {invalidPhone && (
            <p id="callback-phone-error" role="alert">
              {tr([
                "Enter a valid phone number with at least 7 digits.",
                "أدخل رقم هاتف صالحًا يتكوّن من ٧ أرقام على الأقل.",
              ])}
            </p>
          )}
          <label>
            {tr(["Preferred time in Dubai (optional)", "الوقت المفضل بتوقيت دبي (اختياري)"])}
            <input name="availability" maxLength={160} />
          </label>
          <button type="submit" className="phase-button phase-primary">
            {status === "sending"
              ? tr(["Sending…", "جارٍ الإرسال…"])
              : tr(["Request a callback", "اطلب اتصالاً"])}
          </button>
        </fieldset>
      )}
      <div role="status" aria-live="polite">
        {status === "accepted" &&
          tr([
            "We received your callback request. A time will be arranged separately.",
            "استلمنا طلب الاتصال. سننسّق معك لتحديد الموعد.",
          ])}
        {status === "invalid" &&
          tr(["Check your details and try again.", "تحقّق من بياناتك وحاول مجددًا."])}
        {status === "error" && (
          <p>
            {tr([
              "We couldn’t accept the request right now. Email us to arrange a demo.",
              "تعذّر استلام الطلب الآن. راسلنا لترتيب العرض.",
            ])}{" "}
            <a href={`mailto:${supportEmail}`} dir="ltr">
              {supportEmail}
            </a>
          </p>
        )}
      </div>
      <a href="/privacy">{tr(["Privacy policy", "سياسة الخصوصية"])}</a>
    </form>
  );
}
