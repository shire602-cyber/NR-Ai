import { readFile } from "node:fs/promises";
import { z } from "zod";
import { decryptSecret, encryptSecret, isEncryptedSecret } from "../../secret-vault";

const companyIdSchema = z.uuid();
const providerSchema = z.enum(["acube", "complyance"]);
const environmentSchema = z.enum(["sandbox", "production"]);
const credentialSchema = z
  .string()
  .min(1)
  .max(8192)
  .refine((s) => s.trim().length > 0);
const headerSchema = credentialSchema.refine((s) => !/[\r\n]/.test(s));
const acubeSchema = z
  .object({
    email: z.email().max(254),
    password: credentialSchema,
    webhookToken: headerSchema.optional(),
  })
  .strict();
const complyanceSchema = z
  .object({ apiKey: headerSchema, webhookSecret: credentialSchema.optional() })
  .strict();
const contextSchema = z.object({
  companyId: companyIdSchema,
  provider: providerSchema,
  environment: environmentSchema,
});
const envelopeSchema = z.discriminatedUnion("provider", [
  contextSchema.extend({
    provider: z.literal("acube"),
    credentials: acubeSchema,
  }),
  contextSchema.extend({
    provider: z.literal("complyance"),
    credentials: complyanceSchema,
  }),
]);

export type CompanyCredentialContext = z.infer<typeof contextSchema>;
export type CompanyCredentialEnvelope = z.infer<typeof envelopeSchema>;

/** Env variables and mounted secret files use the same tenant/provider/environment binding. */
export function companyCredentialVariable(opts: CompanyCredentialContext): string {
  const context = contextSchema.parse(opts);
  const id = context.companyId.replace(/-/g, "").toUpperCase();
  return `EINVOICE_${context.provider.toUpperCase()}_${context.environment.toUpperCase()}_${id}_CREDENTIALS`;
}

/** Used by offline provisioning. The expected binding is encrypted with the credential data. */
export function sealCompanyCredentials(
  context: CompanyCredentialContext,
  credentials: unknown
): string {
  const value = envelopeSchema.safeParse({
    ...context,
    companyId: context.companyId.toLowerCase(),
    credentials,
  });
  if (!value.success) throw new Error("Invalid e-invoice credential input.");
  return encryptSecret(JSON.stringify(value.data))!;
}

export async function readCompanyCredentials(
  context: CompanyCredentialContext,
  env: NodeJS.ProcessEnv = process.env
): Promise<CompanyCredentialEnvelope | null> {
  try {
    const name = companyCredentialVariable(context);
    const file = env[`${name}_FILE`];
    const stored = env[name] || (file ? (await readFile(file, "utf8")).trim() : null);
    if (!isEncryptedSecret(stored)) return null;
    const value = envelopeSchema.safeParse(JSON.parse(decryptSecret(stored)!));
    if (
      !value.success ||
      value.data.companyId !== context.companyId.toLowerCase() ||
      value.data.provider !== context.provider ||
      value.data.environment !== context.environment
    ) {
      return null;
    }
    return value.data;
  } catch {
    // Missing, unreadable, malformed or encrypted under a different key are all unavailable.
    // These failures can contain a secret or its path. Keep them out of logs and HTTP responses.
    return null;
  }
}
