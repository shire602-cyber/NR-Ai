import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as any[][],
}));

function makeSelectChain() {
  const result = mocks.selectResults.shift() ?? [];
  const chain: any = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(result)),
    orderBy: vi.fn(() => chain),
    groupBy: vi.fn(() => Promise.resolve(result)),
    limit: vi.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

vi.mock("../../server/db", () => ({
  db: {
    select: vi.fn(() => makeSelectChain()),
  },
}));

import {
  fetchStaffWorkload,
  resolveAccessibleClientIds,
} from "../../server/services/firm-command-center.service";

describe("firm command-center access resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults = [];
  });

  it("resolves firm-admin clients from both firm assignments and company membership", async () => {
    mocks.selectResults = [
      [{ id: "assignment-client" }],
      [{ id: "membership-client" }, { id: "assignment-client" }],
    ];

    const ids = await resolveAccessibleClientIds("admin-1", "firm_admin");

    expect(ids.sort()).toEqual(["assignment-client", "membership-client"]);
  });

  it("resolves firm-owner clients through the active client query", async () => {
    mocks.selectResults = [[{ id: "active-client" }]];

    await expect(resolveAccessibleClientIds("owner-1", "firm_owner")).resolves.toEqual([
      "active-client",
    ]);
  });

  it("builds workload from both assignment stores without double-counting", async () => {
    mocks.selectResults = [
      [{ userId: "admin-1", userName: "Admin", userEmail: "admin@nra.test" }],
      [
        {
          userId: "admin-1",
          companyId: "shared-client",
          role: "reviewer",
        },
      ],
      [
        {
          userId: "admin-1",
          companyId: "shared-client",
          role: "accountant",
        },
        {
          userId: "admin-1",
          companyId: "membership-only-client",
          role: "accountant",
        },
      ],
    ];

    const rows = await fetchStaffWorkload();

    expect(rows).toEqual([
      {
        userId: "admin-1",
        userName: "Admin",
        userEmail: "admin@nra.test",
        clientCount: 2,
        rolesByName: { reviewer: 1, accountant: 1 },
      },
    ]);
  });
});
