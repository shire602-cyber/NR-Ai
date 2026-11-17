import { useCurrentUser } from "@/hooks/useCurrentUser";
import { CustomerOnboarding } from "./onboarding/CustomerOnboarding";
import { FirmOnboarding } from "./onboarding/FirmOnboarding";

/*
 * /onboarding (WP-B, spec 3.3 / 3.4). Firm owners and admins get the firm flow (team, clients);
 * everyone else sets up the active company in three screens. The flows live in ./onboarding/.
 */
export default function Onboarding() {
  const { data: user, isLoading } = useCurrentUser();
  if (isLoading) return null;
  if (user?.firmRole === "firm_owner" || user?.firmRole === "firm_admin") {
    return <FirmOnboarding firmRole={user.firmRole} />;
  }
  return <CustomerOnboarding />;
}

export { FirmOnboarding };
