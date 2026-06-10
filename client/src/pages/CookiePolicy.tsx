import { useEffect } from 'react';
import { LegalLayout } from '@/components/LegalLayout';

export default function CookiePolicy() {
  useEffect(() => {
    document.title = 'Cookie Policy | Muhasib.ai';
  }, []);

  return (
    <LegalLayout title="Cookie Policy" effectiveDate="26 April 2026">
      <p>
        This Cookie Policy explains how Muhasib.ai uses cookies and similar technologies on our
        website and platform. It should be read alongside our <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>1. What Are Cookies?</h2>
      <p>
        Cookies are small text files placed on your device when you visit a website. They allow the
        site to recognise your device and remember information about your visit, such as your
        preferences and login state. We also use related browser-storage technologies (e.g.
        localStorage) for similar purposes.
      </p>

      <h2>2. Categories of Cookies We Use</h2>

      <h3>Strictly necessary</h3>
      <p>
        These are required for the Service to function — for example, authentication tokens, your
        selected language (English / Arabic), and security cookies. The Service cannot function
        without them, so they cannot be disabled.
      </p>

      <h3>Functional</h3>
      <p>
        These remember choices you make to provide a more personalised experience, such as your
        default company, dashboard layout, and notification preferences.
      </p>

      <h3>Analytics</h3>
      <p>
        We use first-party analytics to understand how the Service is used (pages visited, features
        used, errors encountered). The data is aggregated and used to improve the product. We do not
        use cross-site tracking cookies.
      </p>

      <h3>Marketing</h3>
      <p>
        We do not currently set marketing or advertising cookies. If this changes, we will update
        this policy and request your consent where required.
      </p>

      <h2>3. Third-Party Cookies</h2>
      <p>
        Some pages may load content from trusted third parties (such as Google Fonts) which may set
        their own cookies. We do not control these cookies; please consult the relevant provider's
        privacy policy.
      </p>

      <h2>4. Managing Cookies</h2>
      <p>
        Most browsers allow you to refuse or delete cookies via their settings. Note that disabling
        strictly necessary cookies will prevent you from signing in or using core features of the
        Service. For instructions specific to your browser, visit{' '}
        <a href="https://www.aboutcookies.org" target="_blank" rel="noopener noreferrer">aboutcookies.org</a>.
      </p>

      <h2>5. Changes to This Policy</h2>
      <p>
        We may update this Cookie Policy from time to time to reflect changes in technology or
        regulation. The "Effective date" above shows when this policy was last updated.
      </p>

      <h2>6. Contact</h2>
      <p>
        If you have questions about how we use cookies, contact{' '}
        <a href="mailto:privacy@muhasib.ai">privacy@muhasib.ai</a>.
      </p>
    </LegalLayout>
  );
}
