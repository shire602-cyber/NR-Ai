import { T } from "@/components/layout/T";
import { useTranslation, translateNow } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import {
  MessageSquare,
  Bug,
  Lightbulb,
  ThumbsUp,
  Star,
  Send,
  History,
  CheckCircle,
  Clock,
  AlertCircle,
} from "lucide-react";
import type { UserFeedback } from "@shared/schema";

const FEEDBACK_TYPES = [
  {
    value: "bug",
    labelKey: "feedback.type.bug",
    icon: Bug,
    descriptionKey: "feedback.reportAProblemOrError",
  },
  {
    value: "feature_request",
    labelKey: "feedback.type.feature_request",
    icon: Lightbulb,
    descriptionKey: "feedback.typeHelp.feature_request",
  },
  {
    value: "improvement",
    labelKey: "feedback.type.improvement",
    icon: ThumbsUp,
    descriptionKey: "feedback.typeHelp.improvement",
  },
  {
    value: "praise",
    labelKey: "feedback.type.praise",
    icon: Star,
    descriptionKey: "feedback.shareWhatYouLove",
  },
];

const CATEGORIES = [
  { value: "ui", labelKey: "feedback.userInterface" },
  { value: "performance", labelKey: "dashboard.performanceHeading" },
  { value: "feature", labelKey: "pageLabels.feature" },
  { value: "billing", labelKey: "feedback.category.billing" },
  { value: "support", labelKey: "feedback.category.support" },
  { value: "other", labelKey: "forms.claim.cat.Other" },
];

export default function Feedback() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [location] = useLocation();
  const [activeTab, setActiveTab] = useState("submit");
  const [formData, setFormData] = useState({
    feedbackType: "",
    category: "",
    title: "",
    message: "",
    rating: 0,
    allowContact: true,
    contactEmail: "",
  });

  const { data: feedbackHistory, isLoading: historyLoading } = useQuery<UserFeedback[]>({
    queryKey: ["/api/feedback"],
  });

  const submitMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      apiRequest("POST", "/api/feedback", {
        ...data,
        pageContext: location,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feedback"] });
      toast({ title: translateNow("toasts.thankYouForYourFeedback") });
      setFormData({
        feedbackType: "",
        category: "",
        title: "",
        message: "",
        rating: 0,
        allowContact: true,
        contactEmail: "",
      });
      setActiveTab("history");
    },
    onError: (error: any) => {
      toast({
        title: translateNow("toasts.error"),
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "resolved":
        return (
          <Badge className="bg-success">
            <CheckCircle className="w-3 h-3 mr-1" />
            <T k="pageLabels.resolved" />
          </Badge>
        );
      case "in_progress":
        return (
          <Badge className="bg-info">
            <Clock className="w-3 h-3 mr-1" />
            <T k="pages.inProgress" />
          </Badge>
        );
      case "reviewed":
        return (
          <Badge className="bg-warning">
            <AlertCircle className="w-3 h-3 mr-1" />
            <T k="pages.reviewed" />
          </Badge>
        );
      case "new":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" />
            New
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getTypeIcon = (type: string) => {
    const typeInfo = FEEDBACK_TYPES.find((t) => t.value === type);
    if (typeInfo) {
      const Icon = typeInfo.icon;
      return <Icon className="w-4 h-4" />;
    }
    return <MessageSquare className="w-4 h-4" />;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title={t["feedback.feedback"]}
        description={t["feedback.helpUsImproveBySharing"]}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="submit" data-testid="tab-submit">
            <Send className="w-4 h-4 mr-2" />
            <T k="pages.submitFeedback" />
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="w-4 h-4 mr-2" />
            <T k="pageLabels.myFeedback" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="submit" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <T k="pageLabels.shareYourFeedback" />
              </CardTitle>
              <CardDescription>
                <T k="pageLabels.yourFeedbackHelpsUsBuildABetterProduct" />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>
                  <T k="pageLabels.feedbackType" />
                </Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {FEEDBACK_TYPES.map((type) => {
                    const Icon = type.icon;
                    const isSelected = formData.feedbackType === type.value;
                    return (
                      <button
                        key={type.value}
                        onClick={() => setFormData({ ...formData, feedbackType: type.value })}
                        className={`p-4 rounded-lg border-2 transition-colors text-left ${
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        }`}
                        data-testid={`button-type-${type.value}`}
                      >
                        <Icon
                          className={`w-6 h-6 mb-2 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                        />
                        <div className="font-medium">{t[type.labelKey]}</div>
                        <div className="text-xs text-muted-foreground">
                          {t[type.descriptionKey]}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>
                    <T k="pages.category" />
                  </Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value })}
                  >
                    <SelectTrigger data-testid="select-category">
                      <SelectValue placeholder={t["screens.selectCategory"]} />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {t[cat.labelKey]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t["feedback.ratingOptional"]}</Label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setFormData({ ...formData, rating: star })}
                        className="p-1 hover:scale-110 transition-transform"
                        data-testid={`button-star-${star}`}
                      >
                        <Star
                          className={`w-8 h-8 ${
                            star <= formData.rating
                              ? "fill-amber-400 text-warning"
                              : "text-muted-foreground"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>
                  <T k="pages.title" />
                </Label>
                <Input
                  placeholder={t["feedback.briefSummaryOfYourFeedback"]}
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  data-testid="input-title"
                />
              </div>

              <div className="space-y-2">
                <Label>
                  <T k="pages.description" />
                </Label>
                <Textarea
                  placeholder={t["feedback.pleaseProvideAsMuchDetail"]}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  rows={5}
                  data-testid="input-message"
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-lg border">
                <div>
                  <Label>
                    <T k="pageLabels.allowUsToContactYou" />
                  </Label>
                  <p className="text-sm text-muted-foreground">{t["feedback.weMayReachOutFor"]}</p>
                </div>
                <Switch
                  checked={formData.allowContact}
                  onCheckedChange={(checked) => setFormData({ ...formData, allowContact: checked })}
                  data-testid="switch-allow-contact"
                />
              </div>

              {formData.allowContact && (
                <div className="space-y-2">
                  <Label>{t["feedback.contactEmailOptional"]}</Label>
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                    data-testid="input-contact-email"
                  />
                </div>
              )}

              <Button
                onClick={() => submitMutation.mutate(formData)}
                disabled={!formData.feedbackType || !formData.message || submitMutation.isPending}
                className="w-full"
                data-testid="button-submit"
              >
                <Send className="w-4 h-4 mr-2" />
                <T k="pages.submitFeedback" />
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-6">
          {historyLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : !feedbackHistory?.length ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">
                  <T k="pageLabels.noFeedbackSubmitted" />
                </h3>
                <p className="text-muted-foreground text-center mb-4">
                  <T k="pageLabels.yourSubmittedFeedbackWillAppearHere" />
                </p>
                <Button onClick={() => setActiveTab("submit")}>
                  <T k="pageLabels.submitYourFirstFeedback" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {feedbackHistory.map((feedback) => (
                <Card key={feedback.id} data-testid={`card-feedback-${feedback.id}`}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {getTypeIcon(feedback.feedbackType)}
                        <div>
                          <CardTitle className="text-lg">
                            {feedback.title || feedback.feedbackType.replace("_", " ")}
                          </CardTitle>
                          <CardDescription>
                            {formatDistanceToNow(new Date(feedback.createdAt), { addSuffix: true })}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {feedback.rating && (
                          <div className="flex items-center">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-4 h-4 ${
                                  star <= feedback.rating!
                                    ? "fill-amber-400 text-warning"
                                    : "text-muted-foreground"
                                }`}
                              />
                            ))}
                          </div>
                        )}
                        {getStatusBadge(feedback.status)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">{feedback.message}</p>
                    {feedback.responseMessage && (
                      <div className="mt-4 p-4 rounded-lg bg-accent/50">
                        <div className="text-sm font-medium mb-1">Response from our team:</div>
                        <p className="text-sm text-muted-foreground">{feedback.responseMessage}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
