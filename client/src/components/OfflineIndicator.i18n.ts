import { defineMessages } from "@/lib/i18n-messages";

export const messages = defineMessages(
  "OfflineIndicator",
  {
    offline: "Offline",
    backOnline: "Back online",
    youReOfflineChangesWillBe:
      "You're offline. Changes will be queued and synced when you reconnect.",
  },
  {
    offline: "غير متصل",
    backOnline: "عاد الاتصال",
    youReOfflineChangesWillBe:
      "أنت غير متصل. ستُوضع التغييرات في الطابور وتُزامَن عند إعادة الاتصال.",
  }
);
