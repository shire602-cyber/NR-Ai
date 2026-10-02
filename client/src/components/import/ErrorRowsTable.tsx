import { useQuery } from "@tanstack/react-query";
import { importRows } from "@/lib/import-api";
import { messages as pageMessages } from "./Stepper.i18n";

const PAGE = 50;

/** Rows the dry run rejected, with the problem named in the user's language and the server's detail beside it. */
export function ErrorRowsTable({ companyId, jobId, total }: { companyId: string; jobId: string; total: number }) {
  const tr = pageMessages.useT();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/companies", companyId, "import-jobs", jobId, "error-rows"],
    queryFn: () => importRows(companyId, jobId, "error", PAGE),
  });
  const problemLabel = (code: string, fallback: string) => {
    const key = `err_${code}` as "err_NAME_REQUIRED";
    const text = tr(key);
    return text === key ? fallback : text;
  };
  if (isLoading) return <p className="text-sm text-muted-foreground">{tr("loading")}</p>;
  if (!data || data.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="table-error-rows">
      <h3 className="text-base font-semibold">{tr("errorRowsTitle")}</h3>
      <p className="text-sm text-muted-foreground">{tr("errorRowsNote")}</p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-start font-medium">{tr("colRow")}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{tr("colField")}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{tr("colProblem")}</th>
              <th scope="col" className="px-3 py-2 text-start font-medium">{tr("colDetail")}</th>
            </tr>
          </thead>
          <tbody>
            {data.flatMap((row) =>
              row.errors.map((e, i) => (
                <tr key={`${row.rowNumber}-${i}`} className="border-t align-top">
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{row.rowNumber}</td>
                  <td className="px-3 py-2">{e.field ? tr(`field_${e.field}` as "field_name") : ""}</td>
                  <td className="px-3 py-2">{problemLabel(e.code, e.message)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground" dir="ltr">{e.message}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {total > PAGE && <p className="text-xs text-muted-foreground">{tr("showingFirst", { count: PAGE })}</p>}
    </div>
  );
}
