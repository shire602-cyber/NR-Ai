import { T } from "@/components/layout/T";
import { SettingsLayout } from "@/components/layout/SettingsLayout";
import { useTranslation, translateNow } from "@/lib/i18n";
import { PageHeader } from "@/components/ui/page-header";
import { useId, useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@/lib/zod-resolver";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
} from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from "@/lib/push";
import { Bell, Mail, FileText, Calendar, CreditCard, BarChart3 } from "lucide-react";

const preferencesSchema = z.object({
  pushEnabled: z.boolean().default(false),
  emailEnabled: z.boolean().default(true),
  invoiceReminders: z.boolean().default(true),
  vatDeadlines: z.boolean().default(true),
  paymentReceived: z.boolean().default(true),
  weeklyDigest: z.boolean().default(false),
  inAppEnabled: z.boolean().default(true),
  dailyDigest: z.boolean().default(false),
});

type PreferencesFormData = z.infer<typeof preferencesSchema>;

type ChannelPrefs = { inApp?: boolean; email?: boolean; push?: boolean };

interface NotificationPrefs {
  pushEnabled: boolean;
  emailEnabled: boolean;
  invoiceReminders: boolean;
  vatDeadlines: boolean;
  paymentReceived: boolean;
  weeklyDigest: boolean;
  // W4-D (R16-18)
  inAppEnabled?: boolean;
  digestFrequency?: "none" | "daily";
  typePreferences?: Record<string, ChannelPrefs>;
  eventTypes?: string[];
  channels?: {
    push: { status: string; externalAction: { en: string; ar: string } };
    email: { status: string; externalAction: { en: string; ar: string } };
  };
}

export default function NotificationPreferences() {
  const { t } = useTranslation();
  const channelLabels = useId();
  const { toast } = useToast();
  const [pushActive, setPushActive] = useState(false);
  const [typePrefsDraft, setTypePrefs] = useState<Record<string, ChannelPrefs> | null>(null);

  useEffect(() => {
    isPushSubscribed().then(setPushActive);
  }, []);

  const { data: preferences, isLoading } = useQuery<NotificationPrefs>({
    queryKey: ["/api/notification-preferences"],
    queryFn: () => apiRequest("GET", "/api/notification-preferences"),
  });

  const form = useForm<PreferencesFormData>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: {
      pushEnabled: false,
      emailEnabled: true,
      invoiceReminders: true,
      vatDeadlines: true,
      paymentReceived: true,
      weeklyDigest: false,
      inAppEnabled: true,
      dailyDigest: false,
    },
  });

  useEffect(() => {
    if (preferences) {
      form.reset({
        pushEnabled: preferences.pushEnabled ?? false,
        emailEnabled: preferences.emailEnabled ?? true,
        invoiceReminders: preferences.invoiceReminders ?? true,
        vatDeadlines: preferences.vatDeadlines ?? true,
        paymentReceived: preferences.paymentReceived ?? true,
        weeklyDigest: preferences.weeklyDigest ?? false,
        inAppEnabled: preferences.inAppEnabled ?? true,
        dailyDigest: preferences.digestFrequency === "daily",
      });
    }
  }, [preferences, form]);

  const typePrefs = typePrefsDraft ?? preferences?.typePreferences ?? {};

  const updateMutation = useMutation({
    mutationFn: ({ dailyDigest, ...data }: PreferencesFormData) =>
      apiRequest("PUT", "/api/notification-preferences", {
        ...data,
        digestFrequency: dailyDigest ? "daily" : "none",
        typePreferences: typePrefs,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({
        title: translateNow("toasts.preferencesSaved"),
        description: translateNow("toasts.yourNotificationPreferencesHaveBeenUpdated"),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: translateNow("toasts.failedToSavePreferences"),
        description: error?.message || translateNow("toasts.pleaseTryAgain"),
      });
    },
  });

  const onSubmit = (data: PreferencesFormData) => {
    updateMutation.mutate(data);
  };

  const pushStatus = preferences?.channels?.push.status ?? "disabled";
  const emailStatus = preferences?.channels?.email.status ?? "disabled";
  const pushUnavailable = pushStatus !== "live" && pushStatus !== "sandbox";
  const setTypePref = (type: string, channel: keyof ChannelPrefs, value: boolean) =>
    setTypePrefs({ ...typePrefs, [type]: { ...(typePrefs[type] ?? {}), [channel]: value } });

  const handleEnablePush = async () => {
    if (pushActive) {
      await unsubscribeFromPush();
      setPushActive(false);
      form.setValue("pushEnabled", false);
    } else {
      const success = await subscribeToPush();
      if (success) {
        setPushActive(true);
        form.setValue("pushEnabled", true);
      } else {
        toast({
          variant: "destructive",
          title: translateNow("toasts.pushNotificationsBlocked"),
          description: translateNow("toasts.pleaseAllowNotificationsInYourBrowserSettings"),
        });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Settings"
          title={t["pages.notificationPrefsTitle"]}
          description={t["pages.notificationPrefsDescription"]}
        />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <SettingsLayout>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Settings"
          title={t["pages.notificationPrefsTitle"]}
          description={t["pages.notificationPrefsDescription"]}
        />

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-2xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  <T k="pages.notificationChannels" />
                </CardTitle>
                <CardDescription>
                  <T k="pages.chooseHowYouWantToReceiveNotifications" />
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="pushEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          <T k="pages.pushNotifications" />
                        </FormLabel>
                        <FormDescription>
                          <T k="pages.receiveInstantBrowserPushNotifications" />
                        </FormDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {pushUnavailable && (
                          <span
                            className="text-xs text-muted-foreground"
                            data-testid="push-unavailable"
                          >
                            <T k="settingsPages.notAvailableYet" />
                          </span>
                        )}
                        {!pushActive && !pushUnavailable && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleEnablePush}
                          >
                            <T k="pages.enablePush" />
                          </Button>
                        )}
                        <FormControl>
                          <Switch
                            checked={field.value}
                            disabled={pushUnavailable}
                            onCheckedChange={(checked) => {
                              if (checked && !pushActive) {
                                handleEnablePush();
                              } else if (!checked && pushActive) {
                                handleEnablePush();
                              } else {
                                field.onChange(checked);
                              }
                            }}
                          />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emailEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <Mail className="w-4 h-4" />
                          <T k="pages.emailNotifications" />
                        </FormLabel>
                        <FormDescription>
                          <T k="pages.receiveNotificationsViaEmail" />
                        </FormDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {emailStatus === "disabled" && (
                          <span
                            className="text-xs text-muted-foreground"
                            data-testid="email-not-configured"
                          >
                            <T k="settingsPages.notAvailableYet" />
                          </span>
                        )}
                        <FormControl>
                          <Switch
                            checked={field.value}
                            disabled={emailStatus === "disabled"}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </div>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  <T k="pages.notificationTypes" />
                </CardTitle>
                <CardDescription>
                  <T k="pages.selectWhichTypesOfEventsTriggerNotifications" />
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <FormField
                  control={form.control}
                  name="invoiceReminders"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <FileText className="w-4 h-4" />
                          <T k="pages.invoiceReminders" />
                        </FormLabel>
                        <FormDescription>
                          <T k="pages.getNotifiedAboutOverdueInvoicesAndPaymentDueDate" />
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="vatDeadlines"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          <T k="pages.vatDeadlines" />
                        </FormLabel>
                        <FormDescription>
                          <T k="pages.getRemindedAboutUpcomingVatFilingAndPaymentDeadl" />
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="paymentReceived"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <CreditCard className="w-4 h-4" />
                          <T k="pages.paymentReceived" />
                        </FormLabel>
                        <FormDescription>
                          <T k="pages.getNotifiedWhenAPaymentIsReceivedForAnInvoice" />
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="weeklyDigest"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          <T k="pages.weeklyDigest" />
                        </FormLabel>
                        <FormDescription>
                          <T k="pages.receiveAWeeklySummaryOfYourFinancialActivity" />
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <T k="portal.notificationTypes" />
                </CardTitle>
                <CardDescription>
                  <T k="portal.notificationTypesHelp" />
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="inAppEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <FormLabel className="text-base">
                        <T k="portal.inAppNotifications" />
                      </FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dailyDigest"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <FormLabel className="text-base">
                          <T k="portal.dailyDigest" />
                        </FormLabel>
                        <FormDescription>
                          <T k="portal.dailyDigestHelp" />
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <div className="divide-y rounded-lg border">
                  <div className="grid grid-cols-3 gap-2 p-3 text-sm font-medium">
                    <span />
                    <span id={`${channelLabels}-in-app`}>
                      <T k="portal.channelInApp" />
                    </span>
                    <span id={`${channelLabels}-email`}>
                      <T k="portal.channelEmail" />
                    </span>
                  </div>
                  {(preferences?.eventTypes ?? []).map((type) => (
                    <div key={type} className="grid grid-cols-3 gap-2 p-3 items-center text-sm">
                      <span id={`${channelLabels}-${type}`}>
                        <T k={`portal.eventType.${type}`} />
                      </span>
                      <Switch
                        aria-labelledby={`${channelLabels}-${type} ${channelLabels}-in-app`}
                        checked={typePrefs[type]?.inApp !== false}
                        onCheckedChange={(v) => setTypePref(type, "inApp", v)}
                      />
                      <Switch
                        aria-labelledby={`${channelLabels}-${type} ${channelLabels}-email`}
                        checked={typePrefs[type]?.email ?? false}
                        onCheckedChange={(v) => setTypePref(type, "email", v)}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending
                  ? t["pages.notificationPrefsSaving"]
                  : t["pages.notificationPrefsSave"]}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </SettingsLayout>
  );
}
