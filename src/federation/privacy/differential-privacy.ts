/**
 * Differential Privacy for Template Aggregation
 *
 * Adds calibrated noise to aggregated statistics to preserve privacy.
 * Uses Laplace mechanism.
 */

export interface PrivacyBudget {
  epsilon: number; // Privacy parameter
  delta: number; // Failure probability
  used: number; // How much budget used
  remaining: number;
}

export class DifferentialPrivacy {
  private budgets: Map<string, PrivacyBudget> = new Map();
  private readonly defaultEpsilon = 1.0;
  private readonly defaultDelta = 1e-5;

  /**
   * Initialize budget for an agent
   */
  initBudget(agentId: string, epsilon = this.defaultEpsilon): void {
    this.budgets.set(agentId, {
      epsilon,
      delta: this.defaultDelta,
      used: 0,
      remaining: epsilon,
    });
  }

  /**
   * Get current budget
   */
  getBudget(agentId: string): PrivacyBudget | null {
    return this.budgets.get(agentId) ?? null;
  }

  /**
   * Add Laplace noise to a value
   */
  addNoise(
    agentId: string,
    value: number,
    sensitivity: number,
    queryEpsilon?: number,
  ): { noisyValue: number; epsilonUsed: number } | null {
    const budget = this.budgets.get(agentId);
    if (!budget) {
      throw new Error(`No budget for agent ${agentId}`);
    }

    const eps = queryEpsilon ?? 0.1; // Default per-query epsilon

    if (budget.remaining < eps) {
      return null; // Budget exhausted
    }

    const scale = sensitivity / eps;
    const noise = this.laplaceSample(scale);

    budget.used += eps;
    budget.remaining -= eps;

    return {
      noisyValue: value + noise,
      epsilonUsed: eps,
    };
  }

  /**
   * Sample from Laplace distribution
   */
  private laplaceSample(scale: number): number {
    const u = Math.random() - 0.5;
    return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  }

  /**
   * Add noise to count query
   */
  noisyCount(agentId: string, count: number): number | null {
    const result = this.addNoise(agentId, count, 1); // Sensitivity = 1 for counts
    return result?.noisyValue ?? null;
  }

  /**
   * Add noise to average query
   */
  noisyAverage(agentId: string, sum: number, count: number, maxValue: number): number | null {
    if (count === 0) return null;

    const sensitivity = maxValue / count;
    const result = this.addNoise(agentId, sum / count, sensitivity);
    return result?.noisyValue ?? null;
  }

  /**
   * Check if budget allows query
   */
  canQuery(agentId: string, requiredEpsilon = 0.1): boolean {
    const budget = this.budgets.get(agentId);
    return budget ? budget.remaining >= requiredEpsilon : false;
  }
}
