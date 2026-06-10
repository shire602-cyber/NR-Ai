import { useEffect } from 'react';
import { LegalLayout } from '@/components/LegalLayout';

export default function TermsOfService() {
  useEffect(() => {
    document.title = 'Terms of Service | Muhasib.ai';
  }, []);

  return (
    <LegalLayout title="Terms of Service" effectiveDate="26 April 2026">
      <p>
        These Terms of Service (<strong>"Terms"</strong>) govern your access to and use of the
        Muhasib.ai platform (the <strong>"Service"</strong>) operated by Najma Al Raeda Accounting
        LLC (<strong>"NRA"</strong>, <strong>"we"</strong>, <strong>"us"</strong>). By creating an
        account or using the Service, you agree to be bound by these Terms.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old and authorised to bind your business to these Terms.
        The Service is intended for use by businesses and accounting professionals operating in or
        with the United Arab Emirates.
      </p>

      <h2>2. Accounts and Security</h2>
      <ul>
        <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
        <li>You must notify us immediately of any unauthorised access at <a href="mailto:security@muhasib.ai">security@muhasib.ai</a>.</li>
        <li>You are responsible for all activity under your account.</li>
      </ul>

      <h2>3. Subscription and Billing</h2>
      <p>
        Paid plans renew automatically at the end of each billing period until cancelled. Fees are
        quoted in AED and exclusive of VAT unless stated otherwise. You may cancel at any time;
        cancellations take effect at the end of the current billing period and no refunds are issued
        for unused time except where required by law.
      </p>

      <h2>4. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for any unlawful purpose or in breach of UAE law.</li>
        <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service.</li>
        <li>Upload malicious code, spam, or content that infringes third-party rights.</li>
        <li>Attempt to disrupt the Service or gain unauthorised access to other accounts.</li>
      </ul>

      <h2>5. Your Data and Content</h2>
      <p>
        You retain ownership of all data and content you upload (<strong>"Customer Data"</strong>).
        You grant us a limited licence to host, process, and display Customer Data solely as needed
        to provide the Service. You are responsible for the accuracy and lawfulness of Customer Data,
        including ensuring you have the right to upload third-party data such as customer or vendor
        information.
      </p>

      <h2>6. Tax and Accounting Disclaimer</h2>
      <p>
        Muhasib.ai provides software tools to assist with bookkeeping, VAT computation, and FTA
        filings. While the Service is designed to comply with FTA rules, the accuracy of any return
        depends on the data you provide. Outputs of the Service do not constitute legal, tax, or
        financial advice. You remain solely responsible for the accuracy of your filings and for
        engaging a qualified tax agent where required.
      </p>

      <h2>7. Service Availability</h2>
      <p>
        We strive to keep the Service available 24/7 but do not guarantee uninterrupted access.
        Scheduled maintenance and unforeseen outages may occur. We will provide reasonable advance
        notice of planned downtime where possible.
      </p>

      <h2>8. Intellectual Property</h2>
      <p>
        The Service, including all software, designs, trademarks, and content (excluding Customer
        Data), is owned by NRA or its licensors and is protected by intellectual property laws.
        These Terms do not grant you any rights to our trademarks or branding.
      </p>

      <h2>9. Termination</h2>
      <p>
        We may suspend or terminate your account if you breach these Terms, fail to pay fees, or
        misuse the Service. Upon termination, you may export your data for a reasonable period
        before deletion, subject to our retention obligations under FTA rules.
      </p>

      <h2>10. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, NRA's aggregate liability under these Terms shall not
        exceed the fees you paid in the twelve (12) months preceding the event giving rise to the
        claim. We are not liable for indirect, incidental, or consequential damages, including loss
        of profits or business interruption.
      </p>

      <h2>11. Indemnification</h2>
      <p>
        You agree to indemnify and hold NRA harmless from any claims arising out of your use of the
        Service in violation of these Terms or applicable law, including claims by third parties
        whose data you upload.
      </p>

      <h2>12. Governing Law and Dispute Resolution</h2>
      <p>
        These Terms are governed by the laws of the United Arab Emirates. Any dispute will be
        submitted to the exclusive jurisdiction of the courts of the Emirate of Dubai.
      </p>

      <h2>13. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be communicated through
        the Service or by email. Continued use of the Service after changes take effect constitutes
        acceptance of the revised Terms.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms? Email <a href="mailto:legal@muhasib.ai">legal@muhasib.ai</a> or
        write to: Najma Al Raeda Accounting LLC, Dubai, United Arab Emirates.
      </p>
    </LegalLayout>
  );
}
