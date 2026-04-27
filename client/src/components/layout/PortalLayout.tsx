import { useLocation, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FileText, FolderOpen, BarChart2, MessageSquare, LogOut, Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiRequest } from '@/lib/queryClient';
import { removeToken } from '@/lib/auth';

const NAV_ITEMS = [
  { label: 'Dashboard',   href: '/client-portal/dashboard',   icon: LayoutDashboard },
  { label: 'Invoices',    href: '/client-portal/invoices',    icon: FileText },
  { label: 'Documents',   href: '/client-portal/documents',   icon: FolderOpen },
  { label: 'Statements',  href: '/client-portal/statements',  icon: BarChart2 },
  { label: 'Messages',    href: '/client-portal/messages',    icon: MessageSquare },
];

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();

  const { data: company } = useQuery({
    queryKey: ['portal-company'],
    queryFn: () => apiRequest('GET', '/api/client-portal/company'),
    staleTime: 5 * 60 * 1000,
  });

  function handleLogout() {
    removeToken();
    navigate('/login');
  }

  return (
    <div className="flex h-screen w-full bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col bg-white border-r border-gray-200 shadow-sm">
        {/* Company header */}
        <div className="px-5 py-6 border-b border-gray-100">
          <div className="flex items-center gap-3">
            {company?.logoUrl ? (
              <img src={company.logoUrl} alt="logo" className="w-9 h-9 rounded-lg object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {company?.name ?? 'My Company'}
              </p>
              <p className="text-xs text-gray-500">Client Portal</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
            const active = location === href || location.startsWith(href + '/');
            return (
              <Link key={href} href={href}>
                <a
                  className={[
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                  ].join(' ')}
                >
                  <Icon className={['w-4 h-4', active ? 'text-blue-600' : 'text-gray-400'].join(' ')} />
                  {label}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-gray-100">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-gray-500 hover:text-gray-900"
            onClick={handleLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top bar */}
        <header className="h-14 flex items-center justify-between px-6 bg-white border-b border-gray-200">
          <h1 className="text-sm font-semibold text-gray-700">
            {NAV_ITEMS.find(n => location.startsWith(n.href))?.label ?? 'Portal'}
          </h1>
          <span className="text-xs text-gray-400">NR Accounting — Client Portal</span>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={location}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
