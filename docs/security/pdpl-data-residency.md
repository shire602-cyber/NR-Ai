# UAE PDPL and data residency statement (DRAFT, W5-E / R17-25)

Status: **draft for legal review — not published, not a compliance claim.**

## Scope

Federal Decree-Law No. 45 of 2021 on the Protection of Personal Data (PDPL) and, for
financial records, the FTA record-keeping rules (five-year retention).

## What the product does today

- Personal data categories and processors: see `data-map.md`.
- Access control: company-scoped roles (`shared/permissions.ts`), optional TOTP MFA with
  company policy, step-up for sensitive actions.
- Security of processing: TLS in production, AES-256-GCM for stored secrets and backups,
  bcrypt passwords, hash-chained append-only audit log (`audit-log.md`).
- Retention: financial records are retained for five years (FTA); companies are soft
  deleted.
- Breach handling: `incident-response.md`.

## Open items before this statement can be published (EXTERNAL)

1. Confirm the hosting, database and object-storage regions per environment and whether
   data leaves the UAE; record the transfer basis for each processor outside the UAE.
2. Data processing agreements with each processor in `data-map.md`.
3. Data-subject request procedure (access, correction, erasure where FTA retention allows)
   with an owner and response times.
4. Records of processing activities and a DPO / privacy contact.
5. Counsel review of this draft.
