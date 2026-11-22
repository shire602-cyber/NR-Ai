import {
  companyCredentialVariable,
  sealCompanyCredentials,
  type CompanyCredentialContext,
} from "../../server/services/einvoice/providers/company-credentials";

async function main(): Promise<void> {
  const [companyId, provider, environment, ...extra] = process.argv.slice(2);
  if (!companyId || !provider || !environment || extra.length || process.stdin.isTTY) {
    throw new Error("Provide company UUID, provider and environment, and pipe provisioned JSON.");
  }
  const context = { companyId, provider, environment } as CompanyCredentialContext;
  companyCredentialVariable(context);

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 32_768) throw new Error("Credential input is too large.");
    chunks.push(chunk);
  }
  const credentials: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  process.stdout.write(`${sealCompanyCredentials(context, credentials)}\n`);
}

main().catch(() => {
  process.stderr.write(
    "Could not seal e-invoicing credentials. Check arguments and vault setup.\n"
  );
  process.exitCode = 1;
});
