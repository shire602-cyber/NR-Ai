import { pool } from "../db";

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const ENSURE_SCHEMA_SQL = `
  ALTER TABLE "invoices"
    ADD COLUMN IF NOT EXISTS "legacy_credit_note_id" uuid REFERENCES "credit_notes"("id") ON DELETE SET NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS "invoices_legacy_credit_note_unique"
    ON "invoices" ("legacy_credit_note_id")
    WHERE "legacy_credit_note_id" IS NOT NULL;
`;

const BACKFILL_INVOICES_SQL = `
  WITH migrated AS (
    INSERT INTO "invoices" (
      "company_id",
      "number",
      "customer_name",
      "customer_trn",
      "customer_address",
      "date",
      "currency",
      "exchange_rate",
      "base_currency_amount",
      "subtotal",
      "vat_amount",
      "total",
      "status",
      "invoice_type",
      "original_invoice_id",
      "contact_id",
      "legacy_credit_note_id",
      "created_at"
    )
    SELECT
      cn."company_id",
      CASE
        WHEN existing_number."id" IS NULL THEN cn."number"
        ELSE cn."number" || '-LEGACY-CN-' || left(cn."id"::text, 8)
      END AS "number",
      cn."customer_name",
      cn."customer_trn",
      original."customer_address",
      cn."date",
      cn."currency",
      COALESCE(NULLIF(original."exchange_rate", 0), 1) AS "exchange_rate",
      -ROUND((ABS(COALESCE(cn."total", 0)::numeric) * COALESCE(NULLIF(original."exchange_rate", 0), 1)::numeric), 2) AS "base_currency_amount",
      -ABS(COALESCE(cn."subtotal", 0)::numeric) AS "subtotal",
      -ABS(COALESCE(cn."vat_amount", 0)::numeric) AS "vat_amount",
      -ABS(COALESCE(cn."total", 0)::numeric) AS "total",
      CASE
        WHEN cn."status" = 'draft' THEN 'draft'
        WHEN cn."status" = 'void' THEN 'void'
        ELSE 'sent'
      END AS "status",
      'credit_note' AS "invoice_type",
      cn."invoice_id",
      original."contact_id",
      cn."id",
      COALESCE(cn."created_at", now())
    FROM "credit_notes" cn
    LEFT JOIN "invoices" original ON original."id" = cn."invoice_id"
    LEFT JOIN "invoices" existing_number
      ON existing_number."company_id" = cn."company_id"
     AND existing_number."number" = cn."number"
    LEFT JOIN "invoices" already_migrated
      ON already_migrated."legacy_credit_note_id" = cn."id"
    WHERE already_migrated."id" IS NULL
    RETURNING "id", "legacy_credit_note_id"
  )
  SELECT COUNT(*)::int AS "inserted_invoice_count" FROM migrated;
`;

const BACKFILL_LINES_SQL = `
  WITH migrated AS (
    SELECT i."id" AS "invoice_id", cn."id" AS "credit_note_id"
    FROM "invoices" i
    JOIN "credit_notes" cn ON cn."id" = i."legacy_credit_note_id"
  ),
  inserted AS (
    INSERT INTO "invoice_lines" (
      "invoice_id",
      "description",
      "quantity",
      "unit_price",
      "vat_rate",
      "vat_supply_type"
    )
    SELECT
      migrated."invoice_id",
      COALESCE(cl."description", 'Legacy credit note line'),
      -ABS(COALESCE(cl."quantity", 0)),
      ABS(COALESCE(cl."unit_price", 0)::numeric),
      COALESCE(cl."vat_rate", 0.05),
      COALESCE(cl."vat_supply_type", 'standard_rated')
    FROM migrated
    JOIN "credit_note_lines" cl ON cl."credit_note_id" = migrated."credit_note_id"
    WHERE NOT EXISTS (
      SELECT 1 FROM "invoice_lines" il WHERE il."invoice_id" = migrated."invoice_id"
    )
    RETURNING "id"
  )
  SELECT COUNT(*)::int AS "inserted_line_count" FROM inserted;
`;

const BACKFILL_FALLBACK_LINES_SQL = `
  WITH migrated_without_lines AS (
    SELECT
      i."id" AS "invoice_id",
      cn."subtotal",
      cn."vat_amount"
    FROM "invoices" i
    JOIN "credit_notes" cn ON cn."id" = i."legacy_credit_note_id"
    WHERE NOT EXISTS (
      SELECT 1 FROM "invoice_lines" il WHERE il."invoice_id" = i."id"
    )
      AND ABS(COALESCE(cn."subtotal", 0)::numeric) > 0
  ),
  inserted AS (
    INSERT INTO "invoice_lines" (
      "invoice_id",
      "description",
      "quantity",
      "unit_price",
      "vat_rate",
      "vat_supply_type"
    )
    SELECT
      "invoice_id",
      'Legacy credit note amount',
      -1,
      ABS(COALESCE("subtotal", 0)::numeric),
      CASE
        WHEN ABS(COALESCE("subtotal", 0)::numeric) = 0 THEN 0.05
        ELSE ROUND(ABS(COALESCE("vat_amount", 0)::numeric) / ABS(COALESCE("subtotal", 0)::numeric), 6)
      END,
      CASE WHEN ABS(COALESCE("vat_amount", 0)::numeric) = 0 THEN 'zero_rated' ELSE 'standard_rated' END
    FROM migrated_without_lines
    RETURNING "id"
  )
  SELECT COUNT(*)::int AS "inserted_fallback_line_count" FROM inserted;
`;

const REPOINT_JOURNALS_SQL = `
  WITH updated AS (
    UPDATE "journal_entries" je
    SET "source" = 'invoice',
        "source_id" = i."id"
    FROM "invoices" i
    WHERE i."legacy_credit_note_id" = je."source_id"
      AND je."source" = 'credit_note'
    RETURNING je."id"
  )
  SELECT COUNT(*)::int AS "repointed_journal_count" FROM updated;
`;

const POST_MISSING_JOURNALS_SQL = `
  WITH candidates AS (
    SELECT
      cn."id" AS "legacy_credit_note_id",
      i."id" AS "canonical_invoice_id",
      cn."company_id",
      cn."date",
      cn."number",
      cn."customer_name",
      ABS(COALESCE(cn."subtotal", 0)::numeric) * COALESCE(NULLIF(i."exchange_rate", 0), 1)::numeric AS "subtotal_aed",
      ABS(COALESCE(cn."vat_amount", 0)::numeric) * COALESCE(NULLIF(i."exchange_rate", 0), 1)::numeric AS "vat_aed",
      ABS(COALESCE(cn."total", 0)::numeric) * COALESCE(NULLIF(i."exchange_rate", 0), 1)::numeric AS "total_aed",
      owner."user_id" AS "created_by",
      ar."id" AS "ar_account_id",
      revenue."id" AS "revenue_account_id",
      vat."id" AS "vat_account_id"
    FROM "credit_notes" cn
    JOIN "invoices" i ON i."legacy_credit_note_id" = cn."id"
    LEFT JOIN LATERAL (
      SELECT cu."user_id"
      FROM "company_users" cu
      WHERE cu."company_id" = cn."company_id"
      ORDER BY cu."created_at", cu."id"
      LIMIT 1
    ) owner ON TRUE
    LEFT JOIN "accounts" ar
      ON ar."company_id" = cn."company_id" AND ar."code" = '1040'
    LEFT JOIN LATERAL (
      SELECT a."id"
      FROM "accounts" a
      WHERE a."company_id" = cn."company_id"
        AND a."code" IN ('4010', '4020')
      ORDER BY CASE WHEN a."code" = '4010' THEN 0 ELSE 1 END
      LIMIT 1
    ) revenue ON TRUE
    LEFT JOIN "accounts" vat
      ON vat."company_id" = cn."company_id" AND vat."code" = '2020'
    WHERE cn."status" = 'issued'
      AND owner."user_id" IS NOT NULL
      AND ar."id" IS NOT NULL
      AND revenue."id" IS NOT NULL
      AND (ABS(COALESCE(cn."vat_amount", 0)::numeric) = 0 OR vat."id" IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1
        FROM "journal_entries" je
        WHERE (je."source" = 'invoice' AND je."source_id" = i."id")
           OR (je."source" = 'credit_note' AND je."source_id" = cn."id")
      )
  ),
  inserted_entries AS (
    INSERT INTO "journal_entries" (
      "company_id",
      "entry_number",
      "date",
      "memo",
      "status",
      "source",
      "source_id",
      "created_by",
      "posted_by",
      "posted_at"
    )
    SELECT
      "company_id",
      'CN-MIG-' || "legacy_credit_note_id"::text,
      "date",
      'Migrated Credit Note ' || "number" || ' - ' || "customer_name",
      'posted',
      'invoice',
      "canonical_invoice_id",
      "created_by",
      "created_by",
      now()
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1
      FROM "journal_entries" je
      WHERE je."company_id" = c."company_id"
        AND je."entry_number" = 'CN-MIG-' || c."legacy_credit_note_id"::text
    )
    RETURNING "id", "source_id"
  ),
  entry_candidates AS (
    SELECT ie."id" AS "entry_id", c.*
    FROM inserted_entries ie
    JOIN candidates c ON c."canonical_invoice_id" = ie."source_id"
  ),
  inserted_lines AS (
    INSERT INTO "journal_lines" ("entry_id", "account_id", "debit", "credit", "description")
    SELECT
      "entry_id",
      "revenue_account_id",
      ROUND("subtotal_aed", 2),
      0,
      'Credit note ' || "number" || ' - reverse sales revenue'
    FROM entry_candidates
    UNION ALL
    SELECT
      "entry_id",
      "vat_account_id",
      ROUND("vat_aed", 2),
      0,
      'Credit note ' || "number" || ' - reverse VAT output'
    FROM entry_candidates
    WHERE ROUND("vat_aed", 2) > 0
    UNION ALL
    SELECT
      "entry_id",
      "ar_account_id",
      0,
      ROUND("total_aed", 2),
      'Credit note ' || "number" || ' - reduce A/R'
    FROM entry_candidates
    RETURNING "id"
  )
  SELECT
    (SELECT COUNT(*)::int FROM inserted_entries) AS "posted_journal_count",
    (SELECT COUNT(*)::int FROM inserted_lines) AS "posted_journal_line_count";
`;

const LINK_MISSING_JOURNALS_SQL = `
  WITH updated AS (
    UPDATE "credit_notes" cn
    SET "journal_entry_id" = je."id",
        "updated_at" = now()
    FROM "invoices" i
    JOIN "journal_entries" je
      ON je."source" = 'invoice'
     AND je."source_id" = i."id"
    WHERE i."legacy_credit_note_id" = cn."id"
      AND cn."journal_entry_id" IS NULL
    RETURNING cn."id"
  )
  SELECT COUNT(*)::int AS "linked_legacy_journal_count" FROM updated;
`;

function numberFromRow(row: Record<string, unknown> | undefined, key: string): number {
  return Number(row?.[key] ?? 0);
}

export interface CreditNoteConsolidationResult {
  insertedInvoiceCount: number;
  insertedLineCount: number;
  insertedFallbackLineCount: number;
  repointedJournalCount: number;
  postedJournalCount: number;
  postedJournalLineCount: number;
  linkedLegacyJournalCount: number;
}

export async function backfillStandaloneCreditNotes(
  queryable: Queryable = pool
): Promise<CreditNoteConsolidationResult> {
  await queryable.query(ENSURE_SCHEMA_SQL);
  const invoiceRes = await queryable.query(BACKFILL_INVOICES_SQL);
  const lineRes = await queryable.query(BACKFILL_LINES_SQL);
  const fallbackLineRes = await queryable.query(BACKFILL_FALLBACK_LINES_SQL);
  const repointRes = await queryable.query(REPOINT_JOURNALS_SQL);
  const postRes = await queryable.query(POST_MISSING_JOURNALS_SQL);
  const linkRes = await queryable.query(LINK_MISSING_JOURNALS_SQL);

  return {
    insertedInvoiceCount: numberFromRow(invoiceRes.rows[0], "inserted_invoice_count"),
    insertedLineCount: numberFromRow(lineRes.rows[0], "inserted_line_count"),
    insertedFallbackLineCount: numberFromRow(
      fallbackLineRes.rows[0],
      "inserted_fallback_line_count"
    ),
    repointedJournalCount: numberFromRow(repointRes.rows[0], "repointed_journal_count"),
    postedJournalCount: numberFromRow(postRes.rows[0], "posted_journal_count"),
    postedJournalLineCount: numberFromRow(postRes.rows[0], "posted_journal_line_count"),
    linkedLegacyJournalCount: numberFromRow(linkRes.rows[0], "linked_legacy_journal_count"),
  };
}
