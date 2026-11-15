import { T } from "@/components/layout/T";
import { PageHeader } from "@/components/ui/page-header";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
});

type PreferencesFormData = z.infer<typeof preferencesSchema>;

interface NotificationPrefs {
  pushEnabled: boolean;
  emailEnabled: boolean;
  invoiceReminders: boolean;
  vatDeadlines: boolean;
  paymentReceived: boolean;
  weeklyDigest: boolean;
}

export default function NotificationPreferences() {
  const { toast } = useToast();
  const [pushActive, setPushActive] = useState(false);

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
      });
    }
  }, [preferences, form]);

  const updateMutation = useMutation({
    mutationFn: (data: PreferencesFormData) =>
      apiRequest("PUT", "/api/notification-preferences", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-preferences"] });
      toast({
        title: "Preferences saved",
        description: "Your notification preferences have been updated.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Failed to save preferences",
        description: error?.message || "Please try again.",
      });
    },
  });

  const onSubmit = (data: PreferencesFormData) => {
    updateMutation.mutate(data);
  };

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
          title: "Push notifications blocked",
          description: "Please allow notifications in your browser settings.",
        });
      }
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Settings"
          title="Notification Preferences"
          description="Manage how and when you receive notifications"
        />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Notification Preferences"
        description="Manage how and when you receive notifications"
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
                      {!pushActive && (
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

          <div className="flex justify-end">
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Preferences"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
