import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import {
  Gift,
  Users,
  Link2,
  Copy,
  Share2,
  Trophy,
  CheckCircle,
  Clock,
  DollarSign,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import type { ReferralCode, Referral } from "@shared/schema";
import { formatCurrency } from "@/lib/format";
import { messages as pageMessages } from "./Referrals.i18n";

interface ReferralStats {
  code: string | null;
  totalReferrals: number;
  successfulReferrals: number;
  pendingReferrals: number;
  totalRewardsEarned: number;
  recentReferrals: Referral[];
}

export default function Referrals() {
  const tr = pageMessages.useT();

  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: referralCode, isLoading: codeLoading } = useQuery<ReferralCode>({
    queryKey: ["/api/referral/my-code"],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<ReferralStats>({
    queryKey: ["/api/referral/stats"],
  });

  const copyToClipboard = async () => {
    const referralLink = `${window.location.origin}/register?ref=${referralCode?.code}`;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast({ title: tr("linkCopiedToClipboard") });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({ title: tr("failedToCopy"), variant: "destructive" });
    }
  };

  const shareReferral = async () => {
    const referralLink = `${window.location.origin}/register?ref=${referralCode?.code}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: tr("joinMuhasibAi"),
          text: tr("get20OffYourFirstMonth"),
          url: referralLink,
        });
      } catch (err) {
        copyToClipboard();
      }
    } else {
      copyToClipboard();
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "rewarded":
        return (
          <Badge className="bg-success">
            <Trophy className="w-3 h-3 me-1" />
            {tr("rewarded")}
          </Badge>
        );
      case "qualified":
        return (
          <Badge className="bg-info">
            <CheckCircle className="w-3 h-3 me-1" />
            {tr("qualified")}
          </Badge>
        );
      case "signed_up":
        return (
          <Badge className="bg-warning">
            <Users className="w-3 h-3 me-1" />
            {tr("signedUp")}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 me-1" />
            {tr("pending")}
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const isLoading = codeLoading || statsLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={tr("workspace")}
        title={tr("referralProgram")}
        description={tr("inviteFriendsAndEarnRewardsWhen")}
      />

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("totalReferrals")}</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-total-referrals">
                  {stats?.totalReferrals || 0}
                </div>
                <p className="text-xs text-muted-foreground">{tr("peopleYouVeInvited")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("successful")}</CardTitle>
                <CheckCircle className="h-4 w-4 text-success" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-successful">
                  {stats?.successfulReferrals || 0}
                </div>
                <p className="text-xs text-muted-foreground">{tr("qualifiedReferrals")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("pending")}</CardTitle>
                <Clock className="h-4 w-4 text-warning" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-pending">
                  {stats?.pendingReferrals || 0}
                </div>
                <p className="text-xs text-muted-foreground">{tr("awaitingQualification")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{tr("rewardsEarned")}</CardTitle>
                <DollarSign className="h-4 w-4 text-success" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="stat-rewards">
                  {formatCurrency(stats?.totalRewardsEarned || 0)}
                </div>
                <p className="text-xs text-muted-foreground">{tr("totalCreditsEarned")}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <CardTitle>{tr("yourReferralLink")}</CardTitle>
              </div>
              <CardDescription>
                {tr("shareThisLinkWithFriendsThey")} {referralCode?.refereeRewardValue || 20}
                {tr("offYouGetAed")} {referralCode?.referrerRewardValue || 50} {tr("credit")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <Input
                    value={`${window.location.origin}/register?ref=${referralCode?.code || ""}`}
                    readOnly
                    className="pe-10 bg-background"
                    data-testid="input-referral-link"
                  />
                  <Link2 className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={copyToClipboard}
                    variant="outline"
                    data-testid="button-copy-link"
                  >
                    <Copy className="w-4 h-4 me-2" />
                    {copied ? tr("copied") : tr("copy")}
                  </Button>
                  <Button onClick={shareReferral} data-testid="button-share-link">
                    <Share2 className="w-4 h-4 me-2" />
                    {tr("share")}
                  </Button>
                </div>
              </div>

              <div className="mt-6 p-4 rounded-lg bg-background border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{tr("yourReferralCode")}</span>
                  <Badge variant="outline" className="font-mono text-lg px-3">
                    {referralCode?.code || tr("loading")}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Gift className="w-5 h-5" />
                  {tr("howItWorks")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">1</span>
                    </div>
                    <div>
                      <h4 className="font-medium">{tr("shareYourLink")}</h4>
                      <p className="text-sm text-muted-foreground">
                        {tr("sendYourUniqueReferralLinkTo")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">2</span>
                    </div>
                    <div>
                      <h4 className="font-medium">{tr("theySignUp")}</h4>
                      <p className="text-sm text-muted-foreground">
                        {tr("yourFriendCreatesAnAccountUsing")}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">3</span>
                    </div>
                    <div>
                      <h4 className="font-medium">{tr("bothGetRewarded")}</h4>
                      <p className="text-sm text-muted-foreground">
                        {tr("theyGet")} {referralCode?.refereeRewardValue || 20}
                        {tr("offYouGetAed")}
                        {referralCode?.referrerRewardValue || 50} {tr("credit2")}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5" />
                  {tr("recentReferrals")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!stats?.recentReferrals?.length ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>{tr("noReferralsYet")}</p>
                    <p className="text-sm">{tr("shareYourLinkToGetStarted")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {stats.recentReferrals.map((referral) => (
                      <div
                        key={referral.id}
                        className="flex items-center justify-between p-3 rounded-lg border"
                        data-testid={`referral-${referral.id}`}
                      >
                        <div>
                          <div className="font-medium">
                            {referral.refereeEmail || tr("anonymous")}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(referral.createdAt), { addSuffix: true })}
                          </div>
                        </div>
                        {getStatusBadge(referral.status)}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{tr("referralMilestones")}</CardTitle>
              <CardDescription>{tr("unlockBonusRewardsAsYouRefer")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">{tr("n5ReferralsBronze")}</span>
                    <span className="text-sm text-muted-foreground">
                      {Math.min(stats?.successfulReferrals || 0, 5)}/5
                    </span>
                  </div>
                  <Progress value={Math.min(((stats?.successfulReferrals || 0) / 5) * 100, 100)} />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">{tr("n10ReferralsSilver")}</span>
                    <span className="text-sm text-muted-foreground">
                      {Math.min(stats?.successfulReferrals || 0, 10)}/10
                    </span>
                  </div>
                  <Progress value={Math.min(((stats?.successfulReferrals || 0) / 10) * 100, 100)} />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium">{tr("n25ReferralsGold")}</span>
                    <span className="text-sm text-muted-foreground">
                      {Math.min(stats?.successfulReferrals || 0, 25)}/25
                    </span>
                  </div>
                  <Progress value={Math.min(((stats?.successfulReferrals || 0) / 25) * 100, 100)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
