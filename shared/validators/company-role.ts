import { z } from "zod";
import { COMPANY_ROLES } from "../permissions";

/** A company role, validated (kept out of shared/permissions.ts so the browser session code stays zod-free). */
export const zCompanyRole = z.enum(COMPANY_ROLES, {
  error: () => `Role must be one of: ${COMPANY_ROLES.join(", ")}`,
});
