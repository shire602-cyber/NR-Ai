/**
 * WQ3 (9.3): create / edit one account of the chart of accounts in a side drawer.
 *
 * The parent remounts it (a new `key`) each time it opens, so the form starts from the account.
 *
 * Fields: type and sub-type, parent, code (required; suggested from the parent), name in English
 * and Arabic, description. The server is the authority (POST /api/companies/:id/accounts,
 * PUT /api/accounts/:id); the drawer mirrors its rules so the user is not surprised:
 *   - a system / VAT / control account keeps its code, type and sub-type (D2: 422
 *     CONTROL_ACCOUNT_LOCKED), and a control sub-account keeps its parent;
 *   - a parent is never a control account (C1: 422 CONTROL_ACCOUNT_NOT_ALLOWED);
 *   - a code is used once per company (409 ACCOUNT_CODE_TAKEN, shown on the code field).
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/form-layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, apiRequest, refreshAfterWrite } from "@/lib/queryClient";
import { formatMessage, useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { accountDisplayName } from "@/lib/account-name";
import {
  drawerParentCandidates,
  parentLocked,
  roleLocked,
  suggestAccountCode,
} from "@/lib/account-hierarchy";
import { ACCOUNT_SUB_TYPES_BY_TYPE } from "@shared/validators/accounts";
import type { Account } from "@shared/schema";

const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
type AccountTypeName = (typeof ACCOUNT_TYPES)[number];

const NONE = "__none__";
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;

/** "current_asset" -> "journal.subType.currentAsset" */
function subTypeKey(subType: string): string {
  return `journal.subType.${subType.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`;
}

export interface AccountDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** Every account of the company (for parents, code suggestions and the lock rules). */
  accounts: Account[];
  /** The account to edit; null creates a new one. */
  account?: Account | null;
  /** Type preselected for a new account. */
  defaultType?: AccountTypeName;
}

interface DraftState {
  type: AccountTypeName;
  subType: string;
  parentId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  description: string;
}

function initialState(account: Account | null | undefined, defaultType: AccountTypeName) {
  return {
    type: ((account?.type as AccountTypeName) ?? defaultType) as AccountTypeName,
    subType: account?.subType ?? NONE,
    parentId: account?.parentId ?? NONE,
    code: account?.code ?? "",
    nameEn: account?.nameEn ?? "",
    nameAr: account?.nameAr ?? "",
    description: account?.description ?? "",
  } satisfies DraftState;
}

export function AccountDrawer({
  open,
  onOpenChange,
  companyId,
  accounts,
  account,
  defaultType = "expense",
}: AccountDrawerProps) {
  const { t, locale } = useTranslation();
  const tr = t as Record<string, string>;
  const { toast } = useToast();
  const editing = !!account;
  const [draft, setDraft] = useState<DraftState>(() => initialState(account, defaultType));
  const [errors, setErrors] = useState<Partial<Record<keyof DraftState, string>>>({});
  const [codeTouched, setCodeTouched] = useState(editing);

  const locked = account ? roleLocked(account, accounts) : false;
  const keepsParent = account ? parentLocked(account, accounts) : false;
  const parents = useMemo(
    () => drawerParentCandidates(accounts, draft.type, account?.id ?? null),
    [accounts, draft.type, account?.id]
  );
  const suggested = useMemo(
    () =>
      suggestAccountCode(
        accounts.filter((a) => a.id !== account?.id),
        { type: draft.type, parentId: draft.parentId === NONE ? null : draft.parentId }
      ),
    [accounts, account?.id, draft.type, draft.parentId]
  );

  // A new account's code follows the suggestion until the user types their own.
  const code = !editing && !codeTouched ? suggested : draft.code;

  const set = <K extends keyof DraftState>(key: K, value: DraftState[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        nameEn: draft.nameEn.trim(),
        nameAr: draft.nameAr.trim() || null,
        description: draft.description.trim() || null,
      };
      if (!keepsParent) body.parentId = draft.parentId === NONE ? null : draft.parentId;
      if (!locked) {
        body.code = code.trim();
        body.type = draft.type;
        body.subType = draft.subType === NONE ? null : draft.subType;
      }
      return editing
        ? apiRequest("PUT", `/api/accounts/${account!.id}`, body)
        : apiRequest("POST", `/api/companies/${companyId}/accounts`, body);
    },
    onSuccess: () => {
      for (const key of ["accounts-with-balances", "accounts"]) {
        refreshAfterWrite(["/api/companies", companyId, key]);
      }
      toast({
        title: editing ? t["journal.accountDrawer.saved"] : t["journal.accountDrawer.created"],
      });
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      const body = e instanceof ApiError ? e.body : undefined;
      const code = body?.code;
      const details = (body?.details ?? {}) as { fields?: unknown };
      if (code === "ACCOUNT_CODE_TAKEN" || code === "DUPLICATE_VALUE") {
        setErrors({ code: (e as Error).message });
        return;
      }
      if (code === "CONTROL_ACCOUNT_NOT_ALLOWED" || code?.toString().startsWith("ACCOUNT_PARENT")) {
        setErrors({ parentId: (e as Error).message });
        return;
      }
      if (code === "CONTROL_ACCOUNT_ROLE_RESERVED" && details.fields) {
        setErrors({ code: (e as Error).message });
        return;
      }
      toast({
        title: t["journal.accountDrawer.failed"],
        description: (e as Error)?.message,
        variant: "destructive",
      });
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Partial<Record<keyof DraftState, string>> = {};
    if (!draft.nameEn.trim()) next.nameEn = t["journal.accountDrawer.required"];
    if (!locked) {
      if (!code.trim()) next.code = t["journal.accountDrawer.required"];
      else if (!CODE_RE.test(code.trim())) next.code = t["journal.accountDrawer.codeFormat"];
      else {
        const clash = accounts.find(
          (a) => a.id !== account?.id && a.code.toLowerCase() === code.trim().toLowerCase()
        );
        if (clash) {
          next.code = formatMessage(t["journal.accountDrawer.codeTaken"], {
            name: accountDisplayName(clash, locale),
          });
        }
      }
    }
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  const subTypes = ACCOUNT_SUB_TYPES_BY_TYPE[draft.type] as readonly string[];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={locale === "ar" ? "left" : "right"}
        className="flex w-full flex-col overflow-y-auto sm:max-w-md"
        data-testid="drawer-account"
      >
        <SheetHeader>
          <SheetTitle>
            {editing ? t["journal.accountDrawer.editTitle"] : t["journal.accountDrawer.newTitle"]}
          </SheetTitle>
          <SheetDescription>
            {editing ? t["journal.accountDrawer.editDesc"] : t["journal.accountDrawer.newDesc"]}
          </SheetDescription>
        </SheetHeader>

        <form
          id="account-drawer-form"
          onSubmit={submit}
          noValidate
          className="mt-4 flex flex-1 flex-col gap-4"
        >
          {locked && (
            <p
              className="flex items-start gap-2 rounded-md bg-surface-sunken p-3 text-small text-muted-foreground"
              data-testid="account-locked-note"
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t["journal.accountDrawer.lockedNote"]}
            </p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="account-type" label={t["journal.accountDrawer.type"]} required>
              <Select
                value={draft.type}
                disabled={locked}
                onValueChange={(v) => {
                  setDraft((d) => ({
                    ...d,
                    type: v as AccountTypeName,
                    subType: NONE,
                    parentId: NONE,
                  }));
                }}
              >
                <SelectTrigger data-testid="select-account-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {tr[`journal.accountType.${type}`]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="account-sub-type" label={t["journal.accountDrawer.subType"]}>
              <Select
                value={draft.subType}
                disabled={locked}
                onValueChange={(v) => set("subType", v)}
              >
                <SelectTrigger data-testid="select-account-sub-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t["journal.accountDrawer.noSubType"]}</SelectItem>
                  {subTypes.map((s) => (
                    <SelectItem key={s} value={s}>
                      {tr[subTypeKey(s)] ?? s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field
            id="account-parent"
            label={t["journal.accountDrawer.parent"]}
            help={
              keepsParent
                ? t["journal.accountDrawer.parentLockedNote"]
                : t["journal.accountDrawer.parentHelp"]
            }
            error={errors.parentId}
          >
            <Select
              value={draft.parentId}
              disabled={keepsParent}
              onValueChange={(v) => set("parentId", v)}
            >
              <SelectTrigger data-testid="select-account-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t["journal.coaNoParent"]}</SelectItem>
                {keepsParent && account?.parentId && !parents.some((p) => p.id === account.parentId)
                  ? (() => {
                      const p = accounts.find((a) => a.id === account.parentId);
                      return p ? (
                        <SelectItem value={p.id}>
                          {p.code} · {accountDisplayName(p, locale)}
                        </SelectItem>
                      ) : null;
                    })()
                  : null}
                {parents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.code} · {accountDisplayName(a, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id="account-code"
            label={t["journal.accountDrawer.code"]}
            required
            help={locked ? undefined : t["journal.accountDrawer.codeHelp"]}
            error={errors.code}
          >
            <Input
              value={code}
              disabled={locked}
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              className="tabular-nums"
              onChange={(e) => {
                setCodeTouched(true);
                set("code", e.target.value);
              }}
              data-testid="input-account-code"
            />
          </Field>
          {!locked && codeTouched && suggested && suggested !== code && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="-mt-3 h-auto self-start p-0"
              onClick={() => {
                setCodeTouched(false);
                set("code", suggested);
              }}
              data-testid="button-use-suggested-code"
            >
              {formatMessage(t["journal.accountDrawer.useSuggested"], { code: suggested })}
            </Button>
          )}

          <Field
            id="account-name-en"
            label={t["journal.accountDrawer.nameEn"]}
            required
            error={errors.nameEn}
          >
            <Input
              value={draft.nameEn}
              dir="ltr"
              onChange={(e) => set("nameEn", e.target.value)}
              data-testid="input-account-name-en"
            />
          </Field>
          <Field id="account-name-ar" label={t["journal.accountDrawer.nameAr"]}>
            <Input
              value={draft.nameAr}
              dir="rtl"
              lang="ar"
              onChange={(e) => set("nameAr", e.target.value)}
              data-testid="input-account-name-ar"
            />
          </Field>
          <Field id="account-description" label={t["journal.accountDrawer.description"]}>
            <Textarea
              value={draft.description}
              dir="auto"
              rows={3}
              onChange={(e) => set("description", e.target.value)}
              data-testid="input-account-description"
            />
          </Field>
        </form>

        <SheetFooter className="mt-6 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.cancel}
          </Button>
          <Button
            type="submit"
            form="account-drawer-form"
            disabled={save.isPending}
            data-testid="button-save-account"
          >
            {editing ? t["journal.accountDrawer.save"] : t["journal.accountDrawer.create"]}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
