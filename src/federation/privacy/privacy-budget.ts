/**
 * Privacy Budget Tracker
 *
 * Tracks epsilon (ε) usage per agent for differential privacy.
 */

import { PrivacyBudget } from "./differential-privacy.js";

export class PrivacyBudgetTracker {
  private budgets: Map<string, PrivacyBudget> = new Map();

  /**
   * Initialize or update budget for an agent
   */
  setBudget(agentId: string, budget: PrivacyBudget): void {
    this.budgets.set(agentId, budget);
  }

  /**
   * Get budget for an agent
   */
  getBudget(agentId: string): PrivacyBudget | null {
    return this.budgets.get(agentId) ?? null;
  }

  /**
   * Check if agent has sufficient budget
   */
  hasBudget(agentId: string, requiredEpsilon: number): boolean {
    const budget = this.budgets.get(agentId);
    return budget ? budget.remaining >= requiredEpsilon : false;
  }

  /**
   * Use budget (decrease remaining epsilon)
   */
  useBudget(agentId: string, epsilon: number): boolean {
    const budget = this.budgets.get(agentId);
    if (!budget || budget.remaining < epsilon) {
      return false;
    }

    budget.used += epsilon;
    budget.remaining -= epsilon;
    return true;
  }

  /**
   * Reset budget for an agent
   */
  resetBudget(agentId: string, newEpsilon: number): void {
    this.budgets.set(agentId, {
      epsilon: newEpsilon,
      delta: 1e-5,
      used: 0,
      remaining: newEpsilon,
    });
  }
}
