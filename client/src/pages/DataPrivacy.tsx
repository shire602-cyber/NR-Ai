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
  const { role, isOwner } = useCompanyRole();
  const { data: deletions } = useQuery<DeletionRow[]>({ queryKey: DELETIONS_KEY, retry: false });

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-8">
      <PageHeader eyebrow={tr("eyebrow")} title={tr("title")} description={tr("description")} />
      <DeletedCompaniesNotice />
      {!companyId || !company ? (
        <p className="text-sm text-muted-foreground">{tr("noCompany")}</p>
      ) : (
        <>
          <ExportCard companyId={companyId} canExport={role === "owner" || role === "accountant"} />
          <DeleteCompanyCard companyId={companyId} companyName={company.name} isOwner={isOwner} alreadyRequested={!!deletionFor(deletions, companyId)} />
        </>
      )}
    </div>
  );
}
