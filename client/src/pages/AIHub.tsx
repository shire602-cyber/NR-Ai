import { TabbedHub } from "@/components/layout/TabbedHub";
import { lazyWithReload } from "@/lib/lazyWithReload";
import { useTranslation } from "@/lib/i18n";

const AICFO = lazyWithReload(() => import("@/pages/AICFO"));
const AIFeatures = lazyWithReload(() => import("@/pages/AIFeatures"));
const SmartAssistant = lazyWithReload(() => import("@/pages/SmartAssistant"));
const AIChat = lazyWithReload(() => import("@/pages/AIChat"));
const AIInbox = lazyWithReload(() => import("@/pages/AIInbox"));

/**
 * R18-09: one AI entry point. /ai-cfo, /ai-features, /smart-assistant, /ai-chat
 * and /ai-inbox all redirect to /ai?tab=<id> and render the original pages
 * unchanged inside these tabs.
 */
export default function AIHub() {
  const { t } = useTranslation();
  return (
    <TabbedHub
      title={t["ai.hubTitle"]}
      defaultTab="cfo"
      data-testid="page-ai-hub"
      tabs={[
        { id: "cfo", label: t["ai.tabCfo"], content: <AICFO /> },
        { id: "features", label: t["ai.tabFeatures"], content: <AIFeatures /> },
        { id: "assistant", label: t["ai.tabAssistant"], content: <SmartAssistant /> },
        { id: "chat", label: t["ai.tabChat"], content: <AIChat /> },
        { id: "inbox", label: t["ai.tabInbox"], content: <AIInbox /> },
      ]}
    />
  );
}
