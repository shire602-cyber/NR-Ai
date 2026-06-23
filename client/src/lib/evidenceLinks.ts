export type EvidenceSection =
  | "proof-drilldown"
  | "refund-pack-export"
  | "missing-evidence"
  | "risk-scan"
  | "request-draft"
  | "evidence-audit-trail";

export function evidenceSectionHref(section: EvidenceSection, params?: Record<string, string>) {
  const search = new URLSearchParams(params);
  const query = search.toString();
  return `/evidence-center${query ? `?${query}` : ""}#${section}`;
}

export function evidenceSourceHref(
  sourceType: string,
  sourceId: string | null | undefined,
  section: EvidenceSection = "proof-drilldown"
) {
  return evidenceSectionHref(section, {
    sourceType,
    ...(sourceId ? { sourceId } : {}),
  });
}
