import { z } from "zod";
import { apiRequest } from "@/lib/queryClient";
import type { CompanyRole } from "@shared/permissions";

/** POST the same invitation the team page sends. */
export function sendTeamInvite(companyId: string, email: string, role: CompanyRole) {
  return apiRequest("POST", `/api/companies/${companyId}/team/invite`, { email, role });
}

export function isEmail(value: string): boolean {
  return z.string().email().safeParse(value.trim()).success;
}
