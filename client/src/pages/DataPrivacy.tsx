import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/page-header";
import { DeleteCompanyCard } from "@/components/data/DeleteCompanyCard";
import { DELETIONS_KEY, DeletedCompaniesNotice } from "@/components/data/DeletedCompaniesNotice";
import { ExportCard } from "@/components/data/ExportCard";
import { useCompanyRole } from "@/hooks/useCompanyRole";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { deletionFor, type DeletionRow } from "@/lib/data-lifecycle";
import { messages as pageMessages } from "./DataPrivacy.i18n";

export default function DataPrivacy() {
  const tr = pageMessages.useT();
  const { company, companyId } = useDefaultCompany();
  const { isOwner } = useCompanyRole();
  const { data: deletions } = useQuery<DeletionRow[]>({ queryKey: DELETIONS_KEY, retry: false });

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} />
      <DeletedCompaniesNotice />
      {/* A company waiting for deletion is not the active one, so its owner gets an export scoped to IT, here. */}
      {(deletions ?? []).filter((d) => d.status === "pending" && d.companyId !== companyId).map((d) => (
        <ExportCard key={d.id} companyId={d.companyId} companyName={d.companyName ?? ""} canExport />
      ))}
      {!companyId || !company ? (
        <p className="text-sm text-muted-foreground">{tr("noCompany")}</p>
      ) : (
        <>
          <p className="text-sm font-medium" data-testid="text-acting-on">{tr("actingOn", { name: company.name })}</p>
          <ExportCard companyId={companyId} companyName={company.name} canExport={isOwner} />
          <DeleteCompanyCard companyId={companyId} companyName={company.name} isOwner={isOwner} alreadyRequested={!!deletionFor(deletions, companyId)} />
        </>
      )}
    </div>
  );
}
