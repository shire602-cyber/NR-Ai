import { queryClient } from "@/lib/queryClient";

/** Mutation key shared by every Match / Unmatch write of one company's bank lines. */
export const bankRowWriteKey = (companyId: string | undefined) => [
  "bank-statements",
  "row-write",
  companyId,
];

/**
 * Event-time guard read from the shared mutation cache. TanStack dispatches "pending"
 * synchronously inside mutate(), before onMutate is awaited, so this sees a write started
 * earlier in the same tick (before React rerenders).
 */
export const hasBankRowWriteInFlight = (companyId: string | undefined, transactionId: string) =>
  queryClient.isMutating({
    mutationKey: bankRowWriteKey(companyId),
    exact: true,
    predicate: (m) => {
      const v = m.state.variables as string | { transactionId: string } | undefined;
      return (typeof v === "string" ? v : v?.transactionId) === transactionId;
    },
  }) > 0;
