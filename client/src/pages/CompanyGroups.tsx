/**
 * Company groups (W5-C: R14-18, R12-12): members and ownership, intercompany account maps and
 * manual elimination journals for the management consolidation. The server enforces access
 * (every member must be accessible; managing needs company-settings rights on the parent).
 */
import { DatePicker } from "@/components/ui/date-picker";
import { accountDisplayName } from "@/lib/account-name";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useTranslation } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDefaultCompany } from "@/hooks/useDefaultCompany";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Plus, Trash2 } from "lucide-react";

type ApiCall = Promise<unknown>;

const CURRENCIES = ["AED", "USD", "EUR", "GBP", "SAR", "QAR", "KWD", "BHD", "OMR", "INR"];

interface GroupSummary {
  id: string;
  name: string;
  reportingCurrency: string;
  parentCompanyId: string;
  memberCount: number;
}
interface Member {
  id: string;
  companyId: string;
  name: string;
  functionalCurrency: string;
  ownershipPercent: number;
  method: "full" | "none";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isParent: boolean;
}
interface MapRow {
  id: string;
  kind: "receivable_payable" | "revenue_expense";
  label: string | null;
  companyAId: string;
  accountAId: string;
  companyBId: string;
  accountBId: string;
}
interface Journal {
  id: string;
  kind: "manual" | "rule";
  date: string;
  memo: string | null;
  status: string;
  lines: Array<{ companyId: string; accountId: string; debit: number; credit: number }>;
}
interface GroupDetail extends GroupSummary {
  members: Member[];
  intercompanyMaps: MapRow[];
  eliminationJournals: Journal[];
}
interface Account {
  id: string;
  code: string;
  nameEn: string;
  type: string;
}

function AccountPicker(props: {
  companyId: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const { locale } = useTranslation();
  const { data } = useQuery<Account[]>({
    queryKey: [`/api/companies/${props.companyId}/accounts`],
    enabled: !!props.companyId,
  });
  return (
    <Select value={props.value} onValueChange={props.onChange} disabled={!props.companyId}>
      <SelectTrigger>
        <SelectValue placeholder={props.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {(data ?? []).map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.code} {accountDisplayName(a, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function CompanyGroups() {
  const { t } = useTranslation();
  const tr = (k: string) => (t as Record<string, string>)[`consolidation.${k}`] ?? k;
  const { toast } = useToast();
  const { companyId, companies } = useDefaultCompany();
  const [picked, setSelected] = useState("");

  const { data: groups } = useQuery<GroupSummary[]>({ queryKey: ["/api/company-groups"] });
  const selected = picked || groups?.[0]?.id || "";
  const detailKey = `/api/company-groups/${selected}`;
  const { data: detail } = useQuery<GroupDetail>({ queryKey: [detailKey], enabled: !!selected });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/company-groups"] });
    queryClient.invalidateQueries({ queryKey: [detailKey] });
  };
  const mutation = (fn: () => ApiCall) =>
    fn()
      .then(() => {
        toast({ title: tr("saved") });
        refresh();
      })
      .catch((e: unknown) =>
        toast({
          title: tr("failed"),
          description: e instanceof Error ? e.message : undefined,
          variant: "destructive",
        })
      );

  // New group
  const [newName, setNewName] = useState("");
  const [newCurrency, setNewCurrency] = useState("AED");
  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/companies/${companyId}/company-groups`, {
        name: newName,
        reportingCurrency: newCurrency,
      }),
    onSuccess: (g: { id: string }) => {
      setNewName("");
      setSelected(g.id);
      refresh();
      toast({ title: tr("saved") });
    },
    onError: (e: unknown) =>
      toast({
        title: tr("failed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "destructive",
      }),
  });

  // Add member
  const [memberCompany, setMemberCompany] = useState("");
  const [memberPct, setMemberPct] = useState("100");
  const [memberMethod, setMemberMethod] = useState<"full" | "none">("full");

  // Intercompany map
  const [mapKind, setMapKind] = useState<MapRow["kind"]>("receivable_payable");
  const [mapLabel, setMapLabel] = useState("");
  const [mapA, setMapA] = useState({ companyId: "", accountId: "" });
  const [mapB, setMapB] = useState({ companyId: "", accountId: "" });

  // Manual elimination (two lines)
  const [elDate, setElDate] = useState(new Date().toISOString().slice(0, 10));
  const [elMemo, setElMemo] = useState("");
  const [elAmount, setElAmount] = useState("");
  const [elDr, setElDr] = useState({ companyId: "", accountId: "" });
  const [elCr, setElCr] = useState({ companyId: "", accountId: "" });

  const memberName = (id: string) => detail?.members.find((m) => m.companyId === id)?.name ?? id;
  const candidateCompanies = (companies ?? []).filter(
    (c: { id: string }) => !detail?.members.some((m) => m.companyId === c.id)
  );
  const memberSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={tr("company")} />
      </SelectTrigger>
      <SelectContent>
        {(detail?.members ?? []).map((m) => (
          <SelectItem key={m.companyId} value={m.companyId}>
            {m.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("eyebrow")}
        title={tr("groupsTitle")}
        description={tr("groupsDescription")}
        actions={
          selected ? (
            <Button variant="outline" asChild>
              <Link href={`/consolidation?group=${selected}`}>{tr("openConsolidation")}</Link>
            </Button>
          ) : undefined
        }
      />
      <p className="text-sm text-muted-foreground">{tr("managementLabel")}</p>

      <Card>
        <CardHeader>
          <CardTitle>{tr("newGroup")}</CardTitle>
          <CardDescription>{tr("parentCompany")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3 items-end">
          <div className="space-y-1">
            <Label htmlFor="group-name">{tr("groupName")}</Label>
            <Input id="group-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{tr("reportingCurrency")}</Label>
            <Select value={newCurrency} onValueChange={setNewCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => create.mutate()}
            disabled={!newName.trim() || !companyId || create.isPending}
            data-testid="button-create-group"
          >
            <Plus className="h-4 w-4 me-2" />
            {tr("create")}
          </Button>
        </CardContent>
      </Card>

      {groups && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{tr("noGroups")}</p>
      )}
      {groups && groups.length > 0 && (
        <div className="max-w-sm space-y-1">
          <Label>{tr("selectGroup")}</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger data-testid="select-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name} ({g.reportingCurrency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {detail && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tr("members")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("company")}</TableHead>
                    <TableHead>{tr("functionalCurrency")}</TableHead>
                    <TableHead>{tr("ownership")}</TableHead>
                    <TableHead>{tr("method")}</TableHead>
                    <TableHead>{tr("effectiveFrom")}</TableHead>
                    <TableHead>{tr("effectiveTo")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        {m.name}
                        {m.isParent && (
                          <Badge variant="secondary" className="ms-2">
                            {tr("parent")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{m.functionalCurrency}</TableCell>
                      <TableCell>{m.ownershipPercent}</TableCell>
                      <TableCell>
                        {m.method === "full" ? tr("methodFull") : tr("methodNone")}
                      </TableCell>
                      <TableCell>{m.effectiveFrom ?? ""}</TableCell>
                      <TableCell>{m.effectiveTo ?? ""}</TableCell>
                      <TableCell>
                        {!m.isParent && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={tr("remove")}
                            onClick={() =>
                              mutation(() =>
                                apiRequest(
                                  "DELETE",
                                  `/api/company-groups/${selected}/members/${m.id}`
                                )
                              )
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid gap-3 sm:grid-cols-4 items-end">
                <div className="space-y-1">
                  <Label>{tr("company")}</Label>
                  <Select value={memberCompany} onValueChange={setMemberCompany}>
                    <SelectTrigger>
                      <SelectValue placeholder={tr("company")} />
                    </SelectTrigger>
                    <SelectContent>
                      {candidateCompanies.map((c: { id: string; name: string }) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="member-pct">{tr("ownership")}</Label>
                  <Input
                    id="member-pct"
                    inputMode="decimal"
                    value={memberPct}
                    onChange={(e) => setMemberPct(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tr("method")}</Label>
                  <Select
                    value={memberMethod}
                    onValueChange={(v) => setMemberMethod(v as "full" | "none")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">{tr("methodFull")}</SelectItem>
                      <SelectItem value="none">{tr("methodNone")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!memberCompany}
                  onClick={() =>
                    mutation(() =>
                      apiRequest("POST", `/api/company-groups/${selected}/members`, {
                        memberCompanyId: memberCompany,
                        ownershipPercent: Number(memberPct),
                        method: memberMethod,
                      })
                    ).then(() => setMemberCompany(""))
                  }
                >
                  {tr("addMember")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tr("intercompanyMaps")}</CardTitle>
              <CardDescription>{tr("mapsHint")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("kind")}</TableHead>
                    <TableHead>{tr("label")}</TableHead>
                    <TableHead>{tr("sideA")}</TableHead>
                    <TableHead>{tr("sideB")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.intercompanyMaps.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        {m.kind === "receivable_payable"
                          ? tr("kindBalances")
                          : tr("kindTransactions")}
                      </TableCell>
                      <TableCell>{m.label ?? ""}</TableCell>
                      <TableCell>{memberName(m.companyAId)}</TableCell>
                      <TableCell>{memberName(m.companyBId)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={tr("remove")}
                          onClick={() =>
                            mutation(() =>
                              apiRequest(
                                "DELETE",
                                `/api/company-groups/${selected}/intercompany-maps/${m.id}`
                              )
                            )
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>{tr("kind")}</Label>
                  <Select value={mapKind} onValueChange={(v) => setMapKind(v as MapRow["kind"])}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="receivable_payable">{tr("kindBalances")}</SelectItem>
                      <SelectItem value="revenue_expense">{tr("kindTransactions")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label htmlFor="map-label">{tr("label")}</Label>
                  <Input
                    id="map-label"
                    value={mapLabel}
                    onChange={(e) => setMapLabel(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tr("sideA")}</Label>
                  {memberSelect(mapA.companyId, (v) => setMapA({ companyId: v, accountId: "" }))}
                  <AccountPicker
                    companyId={mapA.companyId}
                    value={mapA.accountId}
                    onChange={(v) => setMapA({ ...mapA, accountId: v })}
                    placeholder={tr("account")}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tr("sideB")}</Label>
                  {memberSelect(mapB.companyId, (v) => setMapB({ companyId: v, accountId: "" }))}
                  <AccountPicker
                    companyId={mapB.companyId}
                    value={mapB.accountId}
                    onChange={(v) => setMapB({ ...mapB, accountId: v })}
                    placeholder={tr("account")}
                  />
                </div>
              </div>
              <Button
                disabled={!mapA.accountId || !mapB.accountId}
                onClick={() =>
                  mutation(() =>
                    apiRequest("POST", `/api/company-groups/${selected}/intercompany-maps`, {
                      kind: mapKind,
                      label: mapLabel || null,
                      companyAId: mapA.companyId,
                      accountAId: mapA.accountId,
                      companyBId: mapB.companyId,
                      accountBId: mapB.accountId,
                    })
                  )
                }
              >
                {tr("addMap")}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tr("eliminations")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr("date")}</TableHead>
                    <TableHead>{tr("kind")}</TableHead>
                    <TableHead>{tr("memo")}</TableHead>
                    <TableHead data-numeric>{tr("debit")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.eliminationJournals.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>{j.date}</TableCell>
                      <TableCell>
                        {j.kind === "rule" ? tr("rule") : tr("manual")}
                        {j.status === "void" && (
                          <Badge variant="outline" className="ms-2">
                            {tr("voided")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{j.memo ?? ""}</TableCell>
                      <TableCell data-numeric className=" tabular-nums">
                        {j.lines.reduce((s, l) => s + l.debit, 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {j.kind === "manual" && j.status === "posted" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              mutation(() =>
                                apiRequest(
                                  "POST",
                                  `/api/company-groups/${selected}/eliminations/${j.id}/void`,
                                  {}
                                )
                              )
                            }
                          >
                            {tr("void")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm font-medium">{tr("manualElimination")}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="el-date">{tr("date")}</Label>
                  <DatePicker id="el-date" value={elDate} onChange={(value) => setElDate(value)} />
                  <Label htmlFor="el-memo">{tr("memo")}</Label>
                  <Input id="el-memo" value={elMemo} onChange={(e) => setElMemo(e.target.value)} />
                  <Label htmlFor="el-amount">{tr("debit")}</Label>
                  <Input
                    id="el-amount"
                    inputMode="decimal"
                    value={elAmount}
                    onChange={(e) => setElAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tr("debit")}</Label>
                  {memberSelect(elDr.companyId, (v) => setElDr({ companyId: v, accountId: "" }))}
                  <AccountPicker
                    companyId={elDr.companyId}
                    value={elDr.accountId}
                    onChange={(v) => setElDr({ ...elDr, accountId: v })}
                    placeholder={tr("account")}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tr("credit")}</Label>
                  {memberSelect(elCr.companyId, (v) => setElCr({ companyId: v, accountId: "" }))}
                  <AccountPicker
                    companyId={elCr.companyId}
                    value={elCr.accountId}
                    onChange={(v) => setElCr({ ...elCr, accountId: v })}
                    placeholder={tr("account")}
                  />
                </div>
              </div>
              <Button
                disabled={!elDr.accountId || !elCr.accountId || !(Number(elAmount) > 0)}
                onClick={() =>
                  mutation(() =>
                    apiRequest("POST", `/api/company-groups/${selected}/eliminations`, {
                      date: elDate,
                      memo: elMemo || null,
                      lines: [
                        {
                          memberCompanyId: elDr.companyId,
                          accountId: elDr.accountId,
                          debit: elAmount,
                        },
                        {
                          memberCompanyId: elCr.companyId,
                          accountId: elCr.accountId,
                          credit: elAmount,
                        },
                      ],
                    })
                  )
                }
              >
                {tr("post")}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
