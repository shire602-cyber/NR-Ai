import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Copy, Download, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PublicShell } from "@/components/PublicShell";
import { apiUrl } from "@/lib/api";
import { copyText } from "@/lib/browser-file";
import { buildOperations, groupByTag, matchesFilter, type FieldRow, type OperationView, type ParamRow } from "@/lib/openapi-view";
import { messages as pageMessages } from "./ApiDocs.i18n";

const SPEC_PATH = "/api/v1/openapi.json";

const METHOD_STYLE: Record<string, string> = {
  get: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  post: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  patch: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  put: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  delete: "bg-red-500/15 text-red-700 dark:text-red-300",
};

async function fetchSpec(): Promise<Record<string, any>> {
  const res = await fetch(apiUrl(SPEC_PATH), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function FieldTable({ rows, caption, kind }: { rows: Array<FieldRow | ParamRow>; caption: string; kind: "field" | "param" }) {
  const tr = pageMessages.useT();
  if (rows.length === 0) return null;
  return (
    <div className="mt-4 overflow-x-auto" dir="ltr">
      <table className="w-full min-w-[32rem] text-start text-sm">
        <caption className="pb-1 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{caption}</caption>
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th scope="col" className="py-1 pe-3 font-medium">{tr("name")}</th>
            {kind === "param" && <th scope="col" className="py-1 pe-3 font-medium">{tr("location")}</th>}
            <th scope="col" className="py-1 pe-3 font-medium">{tr("type")}</th>
            <th scope="col" className="py-1 pe-3 font-medium">{tr("required")}</th>
            <th scope="col" className="py-1 font-medium">{tr("description")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = "path" in row ? row.path : row.name;
            return (
              <tr key={`${name}-${"in" in row ? row.in : ""}`} className="border-b border-border/50 align-top">
                <td dir="ltr" className="py-1.5 pe-3 font-mono text-xs">{name}</td>
                {kind === "param" && <td className="py-1.5 pe-3 text-xs">{(row as ParamRow).in}</td>}
                <td dir="ltr" className="py-1.5 pe-3 font-mono text-xs text-muted-foreground">{row.type}</td>
                <td className="py-1.5 pe-3 text-xs">{row.required ? tr("yes") : tr("no")}</td>
                <td className="py-1.5 text-xs text-muted-foreground">{row.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function OperationCard({ op }: { op: OperationView }) {
  const tr = pageMessages.useT();
  const [copied, setCopied] = useState(false);
  return (
    <details className="group rounded-lg border bg-card" data-testid={`op-${op.id}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3" dir="ltr">
        <span dir="ltr" className={`rounded px-2 py-0.5 font-mono text-xs font-semibold uppercase ${METHOD_STYLE[op.method] ?? ""}`}>{op.method}</span>
        <code className="break-all text-sm">{op.path}</code>
        <span className="text-sm text-muted-foreground">{op.summary}</span>
        {op.scope && (
          <Badge variant="outline" className="ms-auto font-mono text-[11px]">
            {op.scope}
          </Badge>
        )}
      </summary>
      <div className="border-t px-4 pb-4">
        <p className="mt-3 text-xs text-muted-foreground">
          {tr("scope")}: <span dir="ltr" className="font-mono">{op.scope ?? tr("noScope")}</span>
          {op.needsIdempotencyKey ? ` · ${tr("idempotencyNeeded")}` : ""}
          {op.isList ? ` · ${tr("listNote")}` : ""}
        </p>
        <FieldTable rows={op.params} caption={tr("parameters")} kind="param" />
        <FieldTable rows={op.bodyFields} caption={tr("requestBody")} kind="field" />
        <FieldTable rows={op.responseFields} caption={tr("response")} kind="field" />
        <div className="mt-4" dir="ltr">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr("example")}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                setCopied(await copyText(op.curl));
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {copied ? tr("copied") : tr("copy")}
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5">{op.curl}</pre>
        </div>
      </div>
    </details>
  );
}

export default function ApiDocs() {
  const tr = pageMessages.useT();
  const [filter, setFilter] = useState("");
  const { data: spec, isLoading, isError } = useQuery({ queryKey: [SPEC_PATH], queryFn: fetchSpec, staleTime: 5 * 60_000 });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const operations = useMemo(() => (spec ? buildOperations(spec, origin) : []), [spec, origin]);
  const groups = useMemo(() => (spec ? groupByTag(spec, operations.filter((o) => matchesFilter(o, filter))) : []), [spec, operations, filter]);
  const shown = groups.reduce((n, g) => n + g.operations.length, 0);

  return (
    <PublicShell>
      <section className="border-b bg-muted/30">
        <div className="container mx-auto max-w-5xl px-4 py-10 md:py-14">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{tr("title")}</h1>
          <p className="mt-4 max-w-3xl text-muted-foreground">{tr("intro")}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/developer-settings">
                <KeyRound className="me-2 h-4 w-4" aria-hidden="true" />
                {tr("getAKey")}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a href={apiUrl(SPEC_PATH)} download="muhasib-openapi.json">
                <Download className="me-2 h-4 w-4" aria-hidden="true" />
                {tr("downloadSpec")}
              </a>
            </Button>
          </div>
        </div>
      </section>

      <div className="container mx-auto max-w-5xl space-y-10 px-4 py-10">
        <section className="grid gap-4 md:grid-cols-2" aria-label={tr("authTitle")}>
          {(
            [
              ["authTitle", "authBody"],
              ["idemTitle", "idemBody"],
              ["limitsTitle", "limitsBody"],
              ["moneyTitle", "moneyBody"],
            ] as const
          ).map(([title, body]) => (
            <div key={title} className="rounded-lg border p-4">
              <h2 className="text-base font-semibold">{tr(title)}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{tr(body)}</p>
            </div>
          ))}
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <label className="sr-only" htmlFor="api-filter">
              {tr("filter")}
            </label>
            <Input id="api-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tr("filter")} className="max-w-md" data-testid="input-api-filter" />
            {spec && (
              <p className="text-sm text-muted-foreground" role="status">
                {tr.plural("endpoints", shown)}
              </p>
            )}
          </div>
          {isLoading && <p className="text-sm text-muted-foreground">{tr("loading")}</p>}
          {isError && <p role="alert" className="text-sm text-destructive">{tr("loadFailed")}</p>}
          {spec && shown === 0 && <p className="text-sm text-muted-foreground">{tr("noMatches")}</p>}
          <div className="space-y-8">
            {groups.map((group) => (
              <div key={group.tag}>
                <h2 className="mb-3 text-xl font-semibold" dir="ltr">
                  {group.tag}
                </h2>
                <div className="space-y-2">
                  {group.operations.map((op) => (
                    <OperationCard key={op.id} op={op} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
