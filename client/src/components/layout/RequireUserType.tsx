import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
        title: "Access Restricted",
        description: "You do not have access to this page.",
        variant: "destructive",
      });
      setLocation(redirectTo);
    }
  }, [isLoading, isAllowed, setLocation, redirectTo, toast]);

  if (isLoading || !isAllowed) return null;
  return <>{children}</>;
}
