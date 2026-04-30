import { useEffect } from 'react';
import { LegalLayout } from '@/components/LegalLayout';

export default function PrivacyPolicy() {
  useEffect(() => {
    document.title = 'Privacy Policy | Muhasib.ai';
  }, []);

  return (
    <LegalLayout title="Privacy Policy" effectiveDate="26 April 2026">
      <p>
        This Privacy Policy describes how Najma Al Raeda Accounting LLC (<strong>"NRA"</strong>,
        <strong>"we"</strong>, <strong>"us"</strong>, or <strong>"our"</strong>) collects, uses,
        and protects personal data through the Muhasib.ai platform (the <strong>"Service"</strong>).
        We are committed to handling your data in accordance with UAE Federal Decree-Law No. 45 of
        2021 on the Protection of Personal Data (PDPL) and applicable Federal Tax Authority (FTA)
        requirements.
      </p>

      <h2>1. Data We Collect</h2>
      <p>We collect the following categories of personal and business data:</p>
      <ul>
        <li><strong>Account data</strong> — name, email, phone number, password (hashed).</li>
        <li><strong>Company data</strong> — trade licence number, TRN, address, business activity.</li>
        <li><strong>Financial data</strong> — invoices, receipts, bank transactions, ledger entries.</li>
        <li><strong>Usage data</strong> — pages visited, features used, IP address, device and browser information.</li>
        <li><strong>Support data</strong> — communications you send to our support team.</li>
      </ul>

      <h2>2. How We Use Your Data</h2>
      <p>We use your data to:</p>
      <ul>
        <li>Provide, operate, and maintain the Service.</li>
        <li>Generate FTA-compliant tax filings, e-invoices, and financial reports on your behalf.</li>
        <li>Send service-related notifications (e.g. invoice reminders, filing deadlines).</li>
        <li>Improve features through aggregated, anonymised analytics.</li>
        <li>Comply with our legal obligations under UAE law.</li>
      </ul>

      <h2>3. Legal Basis for Processing</h2>
      <p>
        We process personal data on the basis of your consent, performance of our contract with you,
        compliance with legal obligations (including FTA record-keeping rules), and our legitimate
        interests in providing and improving the Service.
      </p>

      <h2>4. Data Retention</h2>
      <p>
        Financial records and tax-related data are retained for a minimum of <strong>five (5) years</strong>
        from the end of the tax period to which they relate, in compliance with FTA Article 78
        record-keeping requirements. Account data is retained while your account is active and for a
        reasonable period after closure to handle disputes and legal obligations.
      </p>

      <h2>5. Data Sharing</h2>
      <p>We do not sell your personal data. We may share data with:</p>
      <ul>
        <li><strong>Service providers</strong> (cloud hosting, email delivery, payment processors) under data-processing agreements.</li>
        <li><strong>UAE regulatory authorities</strong> (FTA, MoF) where legally required.</li>
        <li><strong>Your authorised users</strong> (team members, accountants you have invited).</li>
      </ul>

      <h2>6. Data Security</h2>
      <p>
        We use TLS encryption for data in transit, encrypted storage at rest, role-based access
        controls, and regular security audits. Despite these safeguards, no system is 100% secure;
        we encourage you to use a strong password and enable any available second-factor authentication.
      </p>

      <h2>7. Your Rights</h2>
      <p>
        Subject to UAE PDPL, you have the right to access, correct, delete, or restrict processing of
        your personal data, to object to certain processing, and to receive a portable copy of your
        data. To exercise these rights, contact us at <a href="mailto:privacy@muhasib.ai">privacy@muhasib.ai</a>.
      </p>

      <h2>8. International Transfers</h2>
      <p>
        Your data is primarily hosted in data centres located within the UAE or jurisdictions providing
        an adequate level of protection. Where transfers outside the UAE are necessary, we apply
        appropriate safeguards as required by PDPL.
      </p>

      <h2>9. Children</h2>
      <p>
        The Service is intended for businesses and is not directed to individuals under 18. We do not
        knowingly collect personal data from children.
      </p>

      <h2>10. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be notified through
        the Service or by email. The "Effective date" above indicates the latest revision.
      </p>

      <h2>11. Contact</h2>
      <p>
        For privacy questions, contact our Data Protection Officer at{' '}
        <a href="mailto:privacy@muhasib.ai">privacy@muhasib.ai</a> or write to: Najma Al Raeda
        Accounting LLC, Dubai, United Arab Emirates.
      </p>
    </LegalLayout>
  );
}
