import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type MutableRefObject,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ProcessedReceipt } from "@/lib/receipt-draft-types";

type QueueAction = SetStateAction<ProcessedReceipt[]>;
type QueueState = {
  session: number;
  byCompany: Record<string, ProcessedReceipt[]>;
  saving: ReadonlySet<string>;
};
type QueueContextValue = readonly [
  QueueState,
  Dispatch<SetStateAction<QueueState>>,
  MutableRefObject<Set<string>>,
];

const QueueContext = createContext<QueueContextValue | null>(null);
const emptyQueue: ProcessedReceipt[] = [];

export function ReceiptQueueProvider({ children }: { children: ReactNode }) {
  const state = useState<QueueState>({ session: 0, byCompany: {}, saving: new Set() });
  const [queues, setQueues] = state;
  const locks = useRef(new Set<string>());
  const hasUnsaved = Object.values(queues.byCompany).some((queue) =>
    queue.some((receipt) => receipt.status !== "saved")
  );

  useEffect(() => {
    const clear = () => {
      locks.current.clear();
      setQueues((current) => ({ session: current.session + 1, byCompany: {}, saving: new Set() }));
    };
    window.addEventListener("auth:logout", clear);
    return () => window.removeEventListener("auth:logout", clear);
  }, [setQueues]);

  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  return (
    <QueueContext.Provider value={[queues, setQueues, locks]}>{children}</QueueContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Kept with its provider so the queue context stays private.
export function useReceiptQueue(companyId: string) {
  const context = useContext(QueueContext);
  if (!context) throw new Error("ReceiptQueueProvider is missing");
  const [{ session, byCompany, saving }, setQueues, locks] = context;
  const update = useCallback(
    (action: QueueAction) => {
      if (!companyId) return;
      setQueues((current) => {
        if (current.session !== session) return current;
        const previous = current.byCompany[companyId] ?? emptyQueue;
        const next = typeof action === "function" ? action(previous) : action;
        return { ...current, byCompany: { ...current.byCompany, [companyId]: next } };
      });
    },
    [companyId, session, setQueues]
  );
  const token = `${session}:${companyId}`;
  const start = () => {
    if (locks.current.has(token)) return false;
    locks.current.add(token);
    setQueues((current) =>
      current.session === session
        ? { ...current, saving: new Set([...current.saving, companyId]) }
        : current
    );
    return true;
  };
  const finish = () => {
    locks.current.delete(token);
    setQueues((current) => {
      if (current.session !== session) return current;
      const next = new Set(current.saving);
      next.delete(companyId);
      return { ...current, saving: next };
    });
  };
  return [
    byCompany[companyId] ?? emptyQueue,
    update,
    { saving: saving.has(companyId), start, finish },
  ] as const;
}
