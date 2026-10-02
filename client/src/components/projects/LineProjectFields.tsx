import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveProjects } from "@/hooks/useActiveProjects";
import { messages } from "./LineProjectFields.i18n";

interface Props {
  companyId: string | undefined;
  projectId: string | null | undefined;
  isBillable: boolean | undefined;
  onChange: (next: { projectId: string | null; isBillable: boolean }) => void;
  testIdSuffix?: string;
  /** Sales lines carry a project but are not "billable" (that switch is for cost lines). */
  hideBillable?: boolean;
}

const NONE = "none";

/** Project and "billable" on a cost line (bill line, claim item). Renders nothing when the company has no active projects. */
export function LineProjectFields({ companyId, projectId, isBillable, onChange, testIdSuffix = "", hideBillable }: Props) {
  const tr = messages.useT();
  const { data: projects = [] } = useActiveProjects(companyId);
  // A line that already carries a project keeps its picker even if that project has since been closed.
  if (projects.length === 0 && !projectId) return null;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 min-w-[240px]">
        <Label className="text-xs text-muted-foreground shrink-0">{tr("project")}</Label>
        <Select value={projectId || NONE} onValueChange={(v) => onChange({ projectId: v === NONE ? null : v, isBillable: v === NONE ? false : !!isBillable })}>
          <SelectTrigger className="h-8" data-testid={`select-line-project${testIdSuffix}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{tr("noProject")}</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.code} - {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {projectId && !hideBillable && (
        <div className="flex items-center gap-2">
          <Switch checked={!!isBillable} onCheckedChange={(checked) => onChange({ projectId: projectId ?? null, isBillable: checked })} data-testid={`switch-line-billable${testIdSuffix}`} />
          <Label className="text-xs">{tr("billable")}</Label>
        </div>
      )}
    </div>
  );
}
