import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isAdminOnlyRoute,isCustomerOnlyRoute } from '@/lib/route-config';
import { useLocation } from 'wouter';
import { RequireUserType } from './RequireUserType';

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading || !user) return null;

  const userType = user.userType || 'customer';
  const isAdmin = user.isAdmin === true;

  // Admin can access everything
  if (isAdmin) return <>{children}</>;

  // Client users cannot access customer-only routes
  if (userType === 'client' && isCustomerOnlyRoute(location)) {
    return (
      <RequireUserType allowedTypes={['customer', 'admin']}>
        {children}
      </RequireUserType>
    );
  }

  // Non-admin users cannot access admin routes
  if (!isAdmin && isAdminOnlyRoute(location)) {
    return (
      <RequireUserType allowedTypes={['admin']}>
        {children}
      </RequireUserType>
    );
  }

  return <>{children}</>;
}
