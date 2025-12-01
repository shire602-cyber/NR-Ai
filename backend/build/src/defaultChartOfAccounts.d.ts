import type { InsertAccount } from "../shared/schema.js";
export interface DefaultAccountTemplate {
    code: string;
    nameEn: string;
    nameAr: string;
    description: string;
    type: "asset" | "liability" | "equity" | "income" | "expense";
    subType: string | null;
    isVatAccount: boolean;
    vatType: "input" | "output" | "zero_rated" | "exempt" | null;
    isSystemAccount: boolean;
}
export declare const defaultChartOfAccounts: DefaultAccountTemplate[];
export declare function createDefaultAccountsForCompany(companyId: string): Omit<InsertAccount, "id" | "createdAt">[];
