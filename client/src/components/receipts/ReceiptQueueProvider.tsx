import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ProcessedReceipt } from "@/pages/Receipts";

type QueueAction = SetStateAction<ProcessedReceipt[]>;
type QueueState = { session: number; byCompany: Record<string, ProcessedReceipt[]> };
type QueueContextValue = readonly [QueueState, Dispatch<SetStateAction<QueueState>>];

const QueueContext = createContext<QueueContextValue | null>(null);
const emptyQueue: ProcessedReceipt[] = [];

export function ReceiptQueueProvider({ children }: { children: ReactNode }) {
  const state = useState<QueueState>({ session: 0, byCompany: {} });
  const [queues, setQueues] = state;
  const hasUnsaved = Object.values(queues.byCompany).some((queue) =>
    queue.some((receipt) => receipt.status !== "saved")
  );

  useEffect(() => {
    const clear = () => setQueues((current) => ({ session: current.session + 1, byCompany: {} }));
    window.addEventListener("auth:logout", clear);
    return () => window.removeEventListener("auth:logout", clear);
  }, [setQueues]);

  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  return <QueueContext.Provider value={state}>{children}</QueueContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- Kept with its provider so the queue context stays private.
export function useReceiptQueue(companyId: string) {
  const context = useContext(QueueContext);
  if (!context) throw new Error("ReceiptQueueProvider is missing");
  const [{ session, byCompany }, setQueues] = context;
  const update = useCallback(
    (action: QueueAction) => {
      if (!companyId) return;
      setQueues((current) => {
        if (current.session !== session) return current;
        const previous = current.byCompany[companyId] ?? emptyQueue;
        const next = typeof action === "function" ? action(previous) : action;
        return { session, byCompany: { ...current.byCompany, [companyId]: next } };
      });
    },
    [companyId, session, setQueues]
  );
  return [byCompany[companyId] ?? emptyQueue, update] as const;
}
