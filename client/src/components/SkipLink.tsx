/**
 * Visible-on-focus skip link. Lets keyboard users jump past the sidebar/header
 * straight to the page's main content. WCAG 2.1 SC 2.4.1.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only fixed top-2 left-2 z-[100] px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Skip to main content
    </a>
  );
}
