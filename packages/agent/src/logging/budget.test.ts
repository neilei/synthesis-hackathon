/**
 * Unit tests for Venice budget tracking: tier detection and model recommendations.
 *
 * @module @veil/agent/logging/budget.test
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  updateBudget,
  getBudgetState,
  getBudgetTier,
  getRecommendedModel,
  resetBudgetState,
} from "./budget.js";

describe("budget tracker", () => {
  beforeEach(() => {
    resetBudgetState();
  });

  describe("updateBudget", () => {
    it("sets balance from valid header", () => {
      updateBudget({ "x-venice-balance-usd": "5.25" });
      expect(getBudgetState().remainingUsd).toBe(5.25);
    });

    it("increments totalCalls on valid header", () => {
      updateBudget({ "x-venice-balance-usd": "5.0" });
      updateBudget({ "x-venice-balance-usd": "4.8" });
      expect(getBudgetState().totalCalls).toBe(2);
    });

    it("does not update balance when header is missing", () => {
      updateBudget({ "x-venice-balance-usd": "5.0" });
      updateBudget({ "some-other-header": "value" });
      expect(getBudgetState().remainingUsd).toBe(5.0);
      expect(getBudgetState().totalCalls).toBe(1);
    });

    it("does not update balance when header is NaN", () => {
      updateBudget({ "x-venice-balance-usd": "5.0" });
      updateBudget({ "x-venice-balance-usd": "invalid" });
      expect(getBudgetState().remainingUsd).toBe(5.0);
      expect(getBudgetState().totalCalls).toBe(1);
    });

    it("does not update balance when header is empty string", () => {
      updateBudget({ "x-venice-balance-usd": "" });
      expect(getBudgetState().remainingUsd).toBeNull();
      expect(getBudgetState().totalCalls).toBe(0);
    });
  });

  describe("getBudgetTier", () => {
    it("returns normal when no data", () => {
      expect(getBudgetTier()).toBe("normal");
    });

    it("returns critical when balance < 0.5", () => {
      updateBudget({ "x-venice-balance-usd": "0.3" });
      expect(getBudgetTier()).toBe("critical");
    });

    it("returns conservation when balance < 2", () => {
      updateBudget({ "x-venice-balance-usd": "1.5" });
      expect(getBudgetTier()).toBe("conservation");
    });

    it("returns normal when balance >= 2", () => {
      updateBudget({ "x-venice-balance-usd": "2.0" });
      expect(getBudgetTier()).toBe("normal");
    });

    it("returns critical at exact 0 balance", () => {
      updateBudget({ "x-venice-balance-usd": "0" });
      expect(getBudgetTier()).toBe("critical");
    });

    it("returns conservation at exact 0.5 boundary", () => {
      updateBudget({ "x-venice-balance-usd": "0.5" });
      expect(getBudgetTier()).toBe("conservation");
    });
  });

  describe("getRecommendedModel", () => {
    it("returns auto for normal tier", () => {
      updateBudget({ "x-venice-balance-usd": "10.0" });
      expect(getRecommendedModel()).toBe("auto");
    });

    it("returns qwen3-4b for conservation tier", () => {
      updateBudget({ "x-venice-balance-usd": "1.5" });
      expect(getRecommendedModel()).toBe("qwen3-4b");
    });

    it("returns qwen3-4b for critical tier", () => {
      updateBudget({ "x-venice-balance-usd": "0.1" });
      expect(getRecommendedModel()).toBe("qwen3-4b");
    });

    it("returns auto when no data (defaults to normal)", () => {
      expect(getRecommendedModel()).toBe("auto");
    });
  });

  describe("resetBudgetState", () => {
    it("resets balance and call count", () => {
      updateBudget({ "x-venice-balance-usd": "5.0" });
      updateBudget({ "x-venice-balance-usd": "4.0" });
      resetBudgetState();
      expect(getBudgetState().remainingUsd).toBeNull();
      expect(getBudgetState().totalCalls).toBe(0);
      expect(getBudgetTier()).toBe("normal");
    });
  });
});
