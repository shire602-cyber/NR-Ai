// The emirate of a supply (VAT 201 box 1): the companies.emirate value set, on contacts and invoices (migration 0129).

export const UAE_EMIRATES = ["abu_dhabi", "dubai", "sharjah", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"] as const;
export type UaeEmirate = (typeof UAE_EMIRATES)[number];

export type EmirateInput = { ok: true; value: UaeEmirate | null | undefined } | { ok: false; message: string; code: "INVALID_EMIRATE" };

/** undefined = not sent (leave as is); null / "" = cleared (fall back to the company's emirate); otherwise one of the seven. */
export function parseEmirateInput(raw: unknown): EmirateInput {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || (typeof raw === "string" && raw.trim() === "")) return { ok: true, value: null };
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if ((UAE_EMIRATES as readonly string[]).includes(v)) return { ok: true, value: v as UaeEmirate };
  return { ok: false, code: "INVALID_EMIRATE", message: `emirate must be one of: ${UAE_EMIRATES.join(", ")}.` };
}
