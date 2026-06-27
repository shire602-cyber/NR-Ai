import { describe, it, expect } from "vitest";
import {
  evaluateClassificationFeedback,
  evaluateAutoPostGate,
  type AutoPostGateInput,
} from "../../server/services/classification-feedback.util";

const eligible: AutoPostGateInput = {
  autopilotEnabled: true,
  userKeptSuggestion: true,
  confidence: 0.95,
  autopostThreshold: 0.9,
  ruleTimesAccepted: 7,
  hasExpenseAccount: true,
  hasPaymentAccount: true,
  netAmount: 100,
  currency: "AED",
};

describe("evaluateClassificationFeedback", () => {
  it("marks accepted when the user keeps the suggested category", () => {
    const r = evaluateClassificationFeedback("Meals", "Meals", "keyword");
    expect(r.wasAccepted).toBe(true);
    expect(r.method).toBe("keyword");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(evaluateClassificationFeedback("Travel", "  travel ", "rule").wasAccepted).toBe(true);
  });

  it("marks rejected when the user changes the category", () => {
    const r = evaluateClassificationFeedback("Meals", "Office Supplies", "statistical");
    expect(r.wasAccepted).toBe(false);
    expect(r.method).toBe("statistical");
  });

  it("treats a null/undefined final category as not accepted", () => {
    expect(evaluateClassificationFeedback("Meals", null, "openai").wasAccepted).toBe(false);
    expect(evaluateClassificationFeedback("Meals", undefined, "openai").wasAccepted).toBe(false);
  });

  it("falls back to 'openai' for an unknown or missing method", () => {
    expect(evaluateClassificationFeedback("Meals", "Meals", "bogus").method).toBe("openai");
    expect(evaluateClassificationFeedback("Meals", "Meals", undefined).method).toBe("openai");
    expect(evaluateClassificationFeedback("Meals", "Meals", null).method).toBe("openai");
  });

  it("preserves each valid classifier method", () => {
    for (const m of ["rule", "keyword", "statistical", "openai"] as const) {
      expect(evaluateClassificationFeedback("X", "X", m).method).toBe(m);
    }
  });
});

describe("evaluateAutoPostGate", () => {
  it("passes when every condition is met", () => {
    const r = evaluateAutoPostGate(eligible);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("eligible");
  });

  it("is OFF by default — autopilot disabled blocks posting", () => {
    const r = evaluateAutoPostGate({ ...eligible, autopilotEnabled: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("autopilot_disabled");
  });

  it("never posts when the user overrode the AI category", () => {
    const r = evaluateAutoPostGate({ ...eligible, userKeptSuggestion: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("user_overrode_category");
  });

  it("requires confidence at/above the threshold", () => {
    expect(evaluateAutoPostGate({ ...eligible, confidence: 0.89 }).reason).toBe("low_confidence");
    expect(evaluateAutoPostGate({ ...eligible, confidence: 0.9 }).ok).toBe(true);
  });

  it("requires a trusted rule (accepted >= 5 times)", () => {
    expect(evaluateAutoPostGate({ ...eligible, ruleTimesAccepted: 4 }).reason).toBe(
      "rule_not_trusted"
    );
    expect(evaluateAutoPostGate({ ...eligible, ruleTimesAccepted: null }).reason).toBe(
      "rule_not_trusted"
    );
    expect(evaluateAutoPostGate({ ...eligible, ruleTimesAccepted: 5 }).ok).toBe(true);
  });

  it("only posts AED and positive amounts", () => {
    expect(evaluateAutoPostGate({ ...eligible, currency: "USD" }).reason).toBe("non_aed");
    expect(evaluateAutoPostGate({ ...eligible, netAmount: 0 }).reason).toBe("non_positive_amount");
    expect(evaluateAutoPostGate({ ...eligible, netAmount: -5 }).reason).toBe("non_positive_amount");
  });

  it("requires both an expense and a payment account", () => {
    expect(evaluateAutoPostGate({ ...eligible, hasExpenseAccount: false }).reason).toBe(
      "no_expense_account"
    );
    expect(evaluateAutoPostGate({ ...eligible, hasPaymentAccount: false }).reason).toBe(
      "no_payment_account"
    );
  });
});
