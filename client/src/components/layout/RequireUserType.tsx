import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { translateNow } from "@/lib/i18n";

interface Props {
  allowedTypes: string[];
  children: React.ReactNode;
  redirectTo?: string;
}

export function RequireUserType({ allowedTypes, children, redirectTo = "/dashboard" }: Props) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: user, isLoading } = useCurrentUser();

  const userType = user?.userType || "customer";
  const isAllowed = allowedTypes.includes(userType);

  useEffect(() => {
    if (!isLoading && !isAllowed) {
      toast({
        title: translateNow("toasts.accessRestricted"),
        description: translateNow("toasts.youDoNotHaveAccessToThis"),
        variant: "destructive",
      });
      setLocation(redirectTo);
    }
  }, [isLoading, isAllowed, setLocation, redirectTo, toast]);

  if (isLoading || !isAllowed) return null;
  return <>{children}</>;
}
