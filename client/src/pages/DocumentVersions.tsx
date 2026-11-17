import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTranslation } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { History, FileText, Search, ChevronDown, ChevronRight, Clock, User } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiUrl } from "@/lib/api";
import { format } from "date-fns";
import type { DocumentVersion } from "@shared/schema";
import { T } from "@/components/layout/T";

const DOCUMENT_TYPES = [
  { value: "invoice", labelKey: "invoices.publicInvoice" },
  { value: "quote", labelKey: "documentVersions.type.quote" },
  { value: "credit_note", labelKey: "documentVersions.creditNote" },
  { value: "purchase_order", labelKey: "adminDocuments.purchaseOrder" },
  { value: "receipt", labelKey: "pages.receipt" },
] as const;

/** List endpoint per document type: the picker searches documents by number (never an id). */
const LIST_SEGMENT: Record<string, string> = {
  invoice: "invoices",
  quote: "quotes",
  credit_note: "credit-notes",
  purchase_order: "purchase-orders",
  receipt: "receipts",
};

interface PickableDocument {
  id: string;
  number?: string | null;
  invoiceNumber?: string | null;
  receiptNumber?: string | null;
  customerName?: string | null;
  vendorName?: string | null;
  merchant?: string | null;
  date?: string | null;
}

function documentLabel(doc: PickableDocument): string {
  return doc.number || doc.invoiceNumber || doc.receiptNumber || doc.merchant || "—";
}

export default function DocumentVersions() {
  const { t } = useTranslation();
  const { companyId: selectedCompanyId } = useDefaultCompany();
  const initial = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const [documentType, setDocumentType] = useState<string>(initial.get("type") ?? "");
  const [documentId, setDocumentId] = useState(initial.get("id") ?? "");
  const [searchTriggered, setSearchTriggered] = useState(
    Boolean(initial.get("type") && initial.get("id"))
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const listSegment = LIST_SEGMENT[documentType];
  const { data: documentsRaw, isLoading: documentsLoading } = useQuery<
    PickableDocument[] | { items?: PickableDocument[]; data?: PickableDocument[] }
  >({
    queryKey: ["/api/companies", selectedCompanyId, listSegment],
    enabled: Boolean(selectedCompanyId && listSegment),
  });
  const documents: PickableDocument[] = Array.isArray(documentsRaw)
    ? documentsRaw
    : (documentsRaw?.items ?? documentsRaw?.data ?? []);
  const pickedDocument = documents.find((d) => d.id === documentId);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);

  const canSearch = !!selectedCompanyId && !!documentType && !!documentId.trim();

  const {
    data: versions = [],
    isLoading,
    isError,
  } = useQuery<DocumentVersion[]>({
    queryKey: ["/api/companies", selectedCompanyId, "document-versions", documentType, documentId],
    queryFn: async () => {
      if (!selectedCompanyId || !documentType || !documentId.trim()) return [];
      const res = await fetch(
        apiUrl(
          `/api/companies/${selectedCompanyId}/document-versions/${documentType}/${documentId.trim()}`
        ),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch document versions");
      return res.json();
    },
    enabled: canSearch && searchTriggered,
  });

  const handleSearch = () => {
    if (canSearch) {
      setSearchTriggered(true);
    }
  };

  const toggleExpand = (versionId: string) => {
    setExpandedVersionId((prev) => (prev === versionId ? null : versionId));
  };

  const formatSnapshotData = (data: string | null): string => {
    if (!data) return "No snapshot data";
    try {
      return JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      return data;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Accounting"
        title={t["pageLabels.documentVersions"]}
        description={t["pageLabels.viewTheFullVersionHistoryAndAuditTrailForAnyDocument"]}
      />

      {/* Search Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            <T k="pageLabels.findDocumentHistory" />
          </CardTitle>
          <CardDescription>{t["documentVersions.selectADocumentTypeAnd"]}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="documentType">
                <T k="pageLabels.documentType" />
              </Label>
              <Select
                value={documentType}
                onValueChange={(value) => {
                  setDocumentType(value);
                  setDocumentId("");
                  setSearchTriggered(false);
                }}
              >
                <SelectTrigger id="documentType">
                  <SelectValue placeholder={t["documentVersions.selectType"]} />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {t[type.labelKey]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 space-y-2">
              <Label htmlFor="documentId">{t["documentVersions.document"]}</Label>
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="documentId"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={pickerOpen}
                    disabled={!documentType}
                    className="w-full justify-between font-normal"
                    data-testid="button-pick-document"
                  >
                    <span className="truncate">
                      {pickedDocument
                        ? documentLabel(pickedDocument)
                        : t["documentVersions.searchByNumber"]}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t["documentVersions.searchByNumber"]} />
                    <CommandList>
                      <CommandEmpty>
                        {documentsLoading
                          ? t["documentVersions.loadingDocuments"]
                          : t["documentVersions.noDocumentsFound"]}
                      </CommandEmpty>
                      <CommandGroup>
                        {documents.slice(0, 200).map((doc) => (
                          <CommandItem
                            key={doc.id}
                            value={`${documentLabel(doc)} ${doc.customerName ?? doc.vendorName ?? ""}`}
                            onSelect={() => {
                              setDocumentId(doc.id);
                              setPickerOpen(false);
                              setSearchTriggered(true);
                            }}
                          >
                            <span className="font-medium tabular-nums">{documentLabel(doc)}</span>
                            <span className="ms-2 truncate text-muted-foreground">
                              {doc.customerName ?? doc.vendorName ?? ""}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <Button onClick={handleSearch} disabled={!canSearch}>
              <Search className="h-4 w-4 me-2" />
              <T k="shell.search" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {searchTriggered && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t["documentVersions.versionHistory"]}
              {versions.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {versions.length} version{versions.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {documentType && <span className="capitalize">{documentType.replace("_", " ")}</span>}{" "}
              &mdash; {documentId}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Clock className="h-5 w-5 mr-2 animate-spin" />
                <T k="pageLabels.loadingVersionHistory" />
              </div>
            ) : isError ? (
              <div className="text-center py-12 text-destructive">
                {t["documentVersions.failedToLoadVersionHistory"]}
              </div>
            ) : versions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-lg font-medium">
                  <T k="pageLabels.noVersionsFound" />
                </p>
                <p className="text-sm">
                  <T k="pageLabels.noVersionHistoryExistsForThisDocumentYet" />
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">
                      <T k="pageLabels.version" />
                    </TableHead>
                    <TableHead>
                      <T k="pageLabels.changeDescription" />
                    </TableHead>
                    <TableHead className="w-[160px]">
                      <T k="pageLabels.changedBy" />
                    </TableHead>
                    <TableHead className="w-[180px]">Date</TableHead>
                    <TableHead className="w-[100px]">
                      <T k="pageLabels.snapshot" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.map((version) => {
                    const isExpanded = expandedVersionId === version.id;
                    return (
                      <>
                        <TableRow key={version.id} className="hover:bg-muted/50">
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              v{version.version}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {version.changeDescription || (
                              <span className="text-muted-foreground italic">
                                <T k="pageLabels.noDescription" />
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-sm truncate max-w-[120px]">
                                {version.changedBy || "System"}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm">
                              {format(new Date(version.createdAt), "MMM d, yyyy HH:mm")}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleExpand(version.id)}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 mr-1" />
                              ) : (
                                <ChevronRight className="h-4 w-4 mr-1" />
                              )}
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow key={`${version.id}-snapshot`}>
                            <TableCell colSpan={5} className="p-0">
                              <div className="bg-muted/30 border-t px-6 py-4">
                                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
                                  <T k="pageLabels.snapshotData" />
                                </Label>
                                <pre className="text-xs font-mono bg-background rounded-md border p-4 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">
                                  {formatSnapshotData(version.snapshotData)}
                                </pre>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
