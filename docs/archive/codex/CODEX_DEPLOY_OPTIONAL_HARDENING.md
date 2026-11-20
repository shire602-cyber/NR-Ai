# Codex Task — storage durability check + classifier "why" on review screen

> Two small, low-risk polish items. Apply on top of current `main`.
>
> 1. **Volume-aware storage durability check** — at boot, log whether receipt
>    storage will survive a redeploy. Object storage OR a Railway volume-backed
>    uploads dir counts as durable; only a genuinely ephemeral disk is flagged.
>    **Does NOT hard-fail by default** (so it can't break the current Railway
>    volume setup); set `STORAGE_STRICT=true` to make it exit instead of warn.
> 2. **Classifier "why" on the receipt review card** — show how each category was
>    suggested (method + confidence) using the `classifier` field the OCR
>    endpoint already returns.
>
> Verified locally: `npm run check` clean, `npm test` green (887 unit tests incl.
> 6 new durability tests), `tsc` 0, vite + esbuild bundles build. No migration.

---

## Edit 1 — `server/services/fileStorage.ts`

Immediately AFTER the `objectStorageBackend()` function, add:

```ts
export interface StorageDurability {
  backend: "vercel-blob" | "s3" | "local-disk";
  /** True when receipt images will survive a redeploy. */
  durable: boolean;
  /** Human-readable explanation for logs. */
  detail: string;
}

/**
 * Assess whether receipt-image storage will SURVIVE a redeploy.
 *
 *  - Object storage (Vercel Blob / S3) is always durable.
 *  - local-disk is durable ONLY when the uploads dir sits on a persistent
 *    volume. On Railway, an attached Volume is exposed via the
 *    `RAILWAY_VOLUME_MOUNT_PATH` env var; if the uploads dir lives under it, the
 *    disk is durable. A generic `UPLOADS_PERSISTENT=true` escape hatch covers
 *    non-Railway persistent mounts. Otherwise the container disk is ephemeral
 *    and images are lost on every redeploy.
 *
 * This deliberately does NOT treat "no object storage" as ephemeral — a
 * volume-backed disk (the current Railway setup) is perfectly durable.
 */
export function assessStorageDurability(uploadsDir: string): StorageDurability {
  const backend = objectStorageBackend();
  if (backend !== "local-disk") {
    return { backend, durable: true, detail: `${backend} object storage` };
  }

  const resolvedUploads = path.resolve(uploadsDir);
  const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (volumeMount) {
    const resolvedMount = path.resolve(volumeMount);
    const onVolume =
      resolvedUploads === resolvedMount ||
      resolvedUploads.startsWith(resolvedMount + path.sep);
    return onVolume
      ? { backend, durable: true, detail: `local disk on Railway volume (${resolvedMount})` }
      : {
          backend,
          durable: false,
          detail: `uploads dir ${resolvedUploads} is NOT under the Railway volume (${resolvedMount})`,
        };
  }

  if (process.env.UPLOADS_PERSISTENT === "true") {
    return { backend, durable: true, detail: "local disk marked persistent (UPLOADS_PERSISTENT=true)" };
  }

  return {
    backend,
    durable: false,
    detail: `local disk at ${resolvedUploads} with no detected persistent volume — images are lost on redeploy`,
  };
}
```

## Edit 2 — `server/index.ts`

**2a.** Add the import next to the other service imports (e.g. after the
`monitoring` import):

```ts
import { assessStorageDurability } from "./services/fileStorage";
```

**2b.** Immediately BEFORE the `// ─── Module-level refs for graceful shutdown ───`
line (i.e. after the uploads-dir / privilege-drop block), insert:

```ts
// ─── Storage durability check ────────────────────────────────
// Receipt images must survive redeploys. Object storage OR a persistent volume
// satisfies this; an ephemeral container disk does not. We surface the result
// at boot so an accidentally-ephemeral production deploy is loud, not silent.
// Set STORAGE_STRICT=true to hard-fail the boot instead of warning.
{
  const durability = assessStorageDurability(uploadsDir);
  if (durability.durable) {
    log.info(
      { backend: durability.backend, detail: durability.detail },
      "Receipt image storage is durable"
    );
  } else if (env.NODE_ENV === "production") {
    const msg =
      `Receipt image storage is EPHEMERAL (${durability.detail}). ` +
      "Images will be lost on redeploy. Configure object storage " +
      "(S3_BUCKET or BLOB_READ_WRITE_TOKEN) or attach a persistent volume.";
    if (process.env.STORAGE_STRICT === "true") {
      log.error({ backend: durability.backend }, `${msg} STORAGE_STRICT is set — refusing to boot.`);
      process.exit(1);
    }
    log.error({ backend: durability.backend }, msg);
  } else {
    log.warn(
      { backend: durability.backend, detail: durability.detail },
      "Receipt image storage is ephemeral (acceptable for local dev)"
    );
  }
}
```

## New file — `tests/unit/storage-durability.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assessStorageDurability } from "../../server/services/fileStorage";

// These env vars steer the backend + volume detection. Save/restore so the
// suite never leaks state into other tests.
const KEYS = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "RAILWAY_VOLUME_MOUNT_PATH",
  "UPLOADS_PERSISTENT",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("assessStorageDurability — local disk", () => {
  it("is durable when the uploads dir IS the Railway volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/app/uploads";
    const r = assessStorageDurability("/app/uploads");
    expect(r.backend).toBe("local-disk");
    expect(r.durable).toBe(true);
  });

  it("is durable for an uploads subdir under the volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
    expect(assessStorageDurability("/data/uploads").durable).toBe(true);
  });

  it("is NOT durable when the uploads dir is outside the volume mount", () => {
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/data";
    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });

  it("is NOT durable with no volume and no persistence flag (ephemeral)", () => {
    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });

  it("respects the UPLOADS_PERSISTENT escape hatch for non-Railway mounts", () => {
    process.env.UPLOADS_PERSISTENT = "true";
    expect(assessStorageDurability("/srv/data/uploads").durable).toBe(true);
  });

  it("does not mistake a same-prefix sibling path for being on the volume", () => {
    // "/app/uploads" must NOT count as under "/app/up".
    process.env.RAILWAY_VOLUME_MOUNT_PATH = "/app/up";
    expect(assessStorageDurability("/app/uploads").durable).toBe(false);
  });
});
```

## Edit 3 — `client/src/pages/Receipts.tsx`

**3a.** After the `isInternalClassifierMethod` helper (near the
`INTERNAL_CLASSIFIER_METHODS` const), add a label map:

```ts
// Human-readable labels for how a category suggestion was derived, shown on the
// review card so users understand WHY a category was pre-filled.
const CLASSIFIER_METHOD_LABELS: Record<string, string> = {
  rule: "your company rules",
  keyword: "UAE keyword match",
  statistical: "your past classifications",
  openai: "AI vision",
};
```

**3b.** In the receipt review card, immediately AFTER the existing
`{receipt.data.confidence && ( ... AI Confidence ... )}` block, add:

```tsx
                        {receipt.data.classifier?.method && (
                          <div className="col-span-2">
                            <p
                              className="text-xs text-muted-foreground"
                              data-testid={`text-classifier-why-${index}`}
                              title={receipt.data.classifier.reason || undefined}
                            >
                              Category suggested by{" "}
                              <span className="font-medium text-foreground">
                                {CLASSIFIER_METHOD_LABELS[receipt.data.classifier.method] ??
                                  receipt.data.classifier.method}
                              </span>
                              {typeof receipt.data.classifier.confidence === "number" && (
                                <> · {Math.round(receipt.data.classifier.confidence * 100)}% confident</>
                              )}
                              . You can change it above — your correction trains the model.
                            </p>
                          </div>
                        )}
```

(The `classifier` field is already on `ExtractedData` and already populated from
the `/api/ocr/process` response in the prior deploy, so no other client change is
needed. `index` is the map index already in scope on that card.)

## Gates + deploy

```bash
npm run check   # tsc + bundle hygiene + route reg (72) + api contract (8)
npm test        # vitest — 887 unit tests incl. 6 new durability tests
npm run build
```

Commit, push to `main`, redeploy `NR-Ai`, report the SHA.

## Verify (live)

1. **Durability log:** in the NR-Ai deploy logs at boot you should now see
   `Receipt image storage is durable` with
   `detail: "local disk on Railway volume (/app/uploads)"` (because the volume is
   attached). If you ever detach the volume, the log flips to an `EPHEMERAL`
   error — exactly the visibility we want.
2. **Classifier why:** upload a receipt → on the review card, under "AI
   Confidence", you'll see e.g. *"Category suggested by UAE keyword match · 50%
   confident. You can change it above — your correction trains the model."*

## Done when

Gates pass; the boot log reports durable storage on the volume; and the review
card explains how each category was suggested. No behaviour change to posting.
