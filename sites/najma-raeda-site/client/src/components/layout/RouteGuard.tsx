import { RequireUserType } from "./RequireUserType";
import { isCustomerOnlyRoute, isAdminOnlyRoute } from "@/lib/route-config";
import { useLocation } from "wouter";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user, isLoading } = useCurrentUser();

  if (isLoading || !user) return null;

  const userType = user.userType || "customer";
  const isAdmin = user.isAdmin === true;

  if (isAdmin) return <>{children}</>;

  if (userType === "client" && isCustomerOnlyRoute(location)) {
    return <RequireUserType allowedTypes={["customer", "admin"]}>{children}</RequireUserType>;
  }

  if (!isAdmin && isAdminOnlyRoute(location)) {
    return <RequireUserType allowedTypes={["admin"]}>{children}</RequireUserType>;
  }

  return <>{children}</>;
}
