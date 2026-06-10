import { useLocation } from 'wouter';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  FileText,
  Camera,
  BarChart3,
  MoreHorizontal,
} from 'lucide-react';
import { useState, useCallback } from 'react';

interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  /** If true, this item opens the "more" sheet instead of navigating */
  isMore?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard' },
  { label: 'Invoices', icon: FileText, href: '/invoices' },
  { label: 'Receipts', icon: Camera, href: '/receipts' },
  { label: 'Reports', icon: BarChart3, href: '/reports' },
  { label: 'More', icon: MoreHorizontal, href: '#', isMore: true },
];

const moreLinks = [
  { label: 'Accounts', href: '/chart-of-accounts' },
  { label: 'Journal', href: '/journal' },
  { label: 'Contacts', href: '/contacts' },
  { label: 'Inventory', href: '/inventory' },
  { label: 'VAT Filing', href: '/vat-filing' },
  { label: 'Corporate Tax', href: '/corporate-tax' },
  { label: 'Bank Reconciliation', href: '/bank-reconciliation' },
  { label: 'AI CFO', href: '/ai-cfo' },
  { label: 'Document Vault', href: '/document-vault' },
  { label: 'Settings', href: '/company-profile' },
];

/**
 * Mobile Bottom Navigation Bar
 *
 * Renders a fixed bottom tab bar on mobile screens (< 768px).
 * Uses wouter for navigation, consistent with the rest of the app.
 * The "More" tab opens a bottom sheet with additional navigation links.
 */
export function MobileNav() {
  const [location, setLocation] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  const handleNavClick = useCallback(
    (item: NavItem) => {
      if (item.isMore) {
        setMoreOpen((prev) => !prev);
      } else {
        setMoreOpen(false);
        setLocation(item.href);
      }
    },
    [setLocation]
  );

  const handleMoreLink = useCallback(
    (href: string) => {
      setMoreOpen(false);
      setLocation(href);
    },
    [setLocation]
  );

  const isActive = (href: string) => {
    if (href === '#') return moreOpen;
    return location === href || location.startsWith(href + '/');
  };

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="mobile-nav-overlay"
          onClick={() => setMoreOpen(false)}
        />
      )}

      {/* More menu sheet */}
      {moreOpen && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 400 }}
          className="mobile-nav-more-sheet"
        >
          <div className="mobile-nav-more-handle" />
          <nav className="mobile-nav-more-grid">
            {moreLinks.map((link) => (
              <button
                key={link.href}
                onClick={() => handleMoreLink(link.href)}
                className={`mobile-nav-more-item ${
                  location === link.href ? 'mobile-nav-more-item--active' : ''
                }`}
              >
                {link.label}
              </button>
            ))}
          </nav>
        </motion.div>
      )}

      {/* Bottom tab bar */}
      <nav className="mobile-nav" role="navigation" aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);

          return (
            <button
              key={item.label}
              onClick={() => handleNavClick(item)}
              className={`mobile-nav-tab ${active ? 'mobile-nav-tab--active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
            >
              <div className="mobile-nav-tab-icon">
                <Icon className="h-5 w-5" />
                {active && (
                  <motion.div
                    layoutId="mobile-nav-indicator"
                    className="mobile-nav-indicator"
                    transition={{ type: 'spring', damping: 30, stiffness: 400 }}
                  />
                )}
              </div>
              <span className="mobile-nav-tab-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
}
