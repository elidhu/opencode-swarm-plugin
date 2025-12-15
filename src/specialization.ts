/**
 * Specialization Module - Agent competence tracking for emergent organization
 *
 * Tracks which agents excel at which types of tasks based on historical outcomes.
 * Used by the emergent self-organization system to assign specialists to subtasks.
 *
 * Key features:
 * - **Task Dimensions**: Track competence across file_type, strategy, complexity, domain
 * - **Competence Scoring**: Weighted combination of success rate, speed, and error rate
 * - **Confidence Tracking**: Low confidence until enough samples (asymptotes at 20 tasks)
 * - **Specialist Queries**: findSpecialist() finds best agent for task dimensions
 *
 * Storage:
 * - LanceDB tables: specialization-scores, agent-specializations
 * - Zero-config: Uses getStorage() singleton
 *
 * @see src/schemas/specialization.ts - Schema definitions
 * @see src/storage.ts - LanceDB storage interface
 * @see docs/analysis/emergent-organization-design.md - Design rationale
 * @module specialization
 */

import {
  type SpecializationScore,
  type AgentSpecialization,
  type TaskDimension,
  type TaskDimensions,
  type SpecialistQuery,
  SpecializationScoreSchema,
  AgentSpecializationSchema,
} from "./schemas/specialization";
import { getStorage, type LearningStorage } from "./storage";
import type { UnifiedOutcome } from "./outcomes";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for specialization tracking
 */
interface SpecializationConfig {
  /** Median task duration for speed scoring (ms) */
  medianDurationMs: number;
  /** Minimum tasks for confidence = 1.0 */
  confidenceThreshold: number;
  /** Minimum confidence to include in top specializations */
  minConfidenceForTop: number;
  /** Number of top specializations to track per agent */
  topSpecializationsCount: number;
}

const DEFAULT_CONFIG: SpecializationConfig = {
  medianDurationMs: 10 * 60 * 1000, // 10 minutes
  confidenceThreshold: 20, // 20 tasks for full confidence
  minConfidenceForTop: 0.3, // Need 30% confidence to be considered "top"
  topSpecializationsCount: 3,
};

// ============================================================================
// Competence Calculation
// ============================================================================

/**
 * Calculate competence score for a specialization
 *
 * Weighted combination of:
 * - Success rate (40%): successful_tasks / total_tasks
 * - Speed score (30%): faster than median = higher score
 * - Error score (30%): fewer errors = higher score
 *
 * @param score - Current specialization score
 * @param config - Specialization configuration
 * @returns Competence value between 0 and 1
 */
export function calculateCompetence(
  score: SpecializationScore,
  config: SpecializationConfig = DEFAULT_CONFIG,
): number {
  const totalTasks = score.success_count + score.failure_count;
  if (totalTasks === 0) {
    return 0.5; // Default neutral competence
  }

  // Success rate component (40%)
  const successRate = score.success_count / totalTasks;

  // Speed component (30%): normalize against median
  // avg_duration_ms = 0 → 1.0 (instant)
  // avg_duration_ms = median → 0.5
  // avg_duration_ms = 2×median → 0.25
  const speedScore =
    score.avg_duration_ms > 0
      ? Math.min(1.0, config.medianDurationMs / score.avg_duration_ms)
      : 1.0;

  // Error component (30%): fewer errors = better
  // 0 errors → 1.0
  // 1 error → 0.7
  // 2 errors → 0.5
  // 3+ errors → 0.3
  const errorScore = Math.max(0.3, 1.0 - score.avg_error_count * 0.15);

  // Weighted combination
  const competence = successRate * 0.4 + speedScore * 0.3 + errorScore * 0.3;

  return Math.max(0, Math.min(1, competence));
}

/**
 * Calculate confidence in a specialization score
 *
 * Based on sample size: confidence = min(1, total_tasks / threshold)
 * - 0 tasks → 0.0 confidence
 * - 10 tasks → 0.5 confidence (if threshold=20)
 * - 20+ tasks → 1.0 confidence
 *
 * @param score - Current specialization score
 * @param config - Specialization configuration
 * @returns Confidence value between 0 and 1
 */
export function calculateConfidence(
  score: SpecializationScore,
  config: SpecializationConfig = DEFAULT_CONFIG,
): number {
  const totalTasks = score.success_count + score.failure_count;
  return Math.min(1.0, totalTasks / config.confidenceThreshold);
}

// ============================================================================
// Outcome Recording
// ============================================================================

/**
 * Extract task dimensions from a unified outcome
 *
 * Dimensions are extracted from:
 * - file_type: Inferred from files_touched extensions
 * - strategy: Directly from outcome.strategy
 * - complexity: "3" (default medium complexity)
 * - domain: Could be inferred from file paths (future enhancement)
 *
 * @param outcome - Unified outcome from completed subtask
 * @returns Map of dimension → value pairs
 */
export function extractDimensions(outcome: UnifiedOutcome): TaskDimensions {
  const dimensions = new Map<TaskDimension, string>();

  // Extract file_type from first file extension
  if (outcome.files_touched.length > 0) {
    const firstFile = outcome.files_touched[0];
    const ext = firstFile.split(".").pop();
    if (ext) {
      dimensions.set("file_type", ext);
    }
  }

  // Extract strategy
  if (outcome.strategy) {
    dimensions.set("strategy", outcome.strategy);
  }

  // Default complexity (could be enhanced with actual complexity estimation)
  dimensions.set("complexity", "3");

  return dimensions;
}

/**
 * Record outcome and update agent specializations
 *
 * Flow:
 * 1. Extract task dimensions from outcome
 * 2. Update specialization scores for each dimension
 * 3. Recalculate agent's top specializations
 *
 * @param agentId - Agent identifier
 * @param outcome - Unified outcome from completed subtask
 * @param storage - Learning storage (defaults to getStorage())
 * @param config - Specialization configuration
 */
export async function recordOutcomeForAgent(
  agentId: string,
  outcome: UnifiedOutcome,
  storage: LearningStorage = getStorage(),
  config: SpecializationConfig = DEFAULT_CONFIG,
): Promise<void> {
  const dimensions = extractDimensions(outcome);

  // Update each dimension's specialization score
  for (const [dimension, value] of dimensions) {
    await updateSpecializationScore(
      agentId,
      dimension,
      value,
      outcome,
      storage,
      config,
    );
  }

  // Recalculate top specializations for this agent
  await updateAgentSpecialization(agentId, storage, config);
}

/**
 * Update a single specialization score for an agent
 *
 * Creates or updates the score entry, recalculating competence and confidence.
 *
 * @param agentId - Agent identifier
 * @param dimension - Task dimension being tracked
 * @param value - Dimension value (e.g., "typescript", "file-based")
 * @param outcome - Outcome data for this task
 * @param storage - Learning storage
 * @param config - Specialization configuration
 */
async function updateSpecializationScore(
  agentId: string,
  dimension: TaskDimension,
  value: string,
  outcome: UnifiedOutcome,
  storage: LearningStorage,
  config: SpecializationConfig,
): Promise<void> {
  // Fetch existing score or create new one
  const existingScores = await storage.getSpecializationScores(
    agentId,
    dimension,
    value,
  );
  const existing = existingScores.length > 0 ? existingScores[0] : null;

  // Calculate new stats
  const successCount = existing
    ? existing.success_count + (outcome.success ? 1 : 0)
    : outcome.success
      ? 1
      : 0;
  const failureCount = existing
    ? existing.failure_count + (outcome.success ? 0 : 1)
    : outcome.success
      ? 0
      : 1;

  // Update average duration (weighted average)
  const totalTasks = successCount + failureCount;
  const prevTotalTasks = existing
    ? existing.success_count + existing.failure_count
    : 0;
  const avgDuration =
    prevTotalTasks > 0 && existing
      ? (existing.avg_duration_ms * prevTotalTasks + outcome.duration_ms) /
        totalTasks
      : outcome.duration_ms;

  // Update average error count (weighted average)
  const avgErrorCount =
    prevTotalTasks > 0 && existing
      ? (existing.avg_error_count * prevTotalTasks + outcome.error_count) /
        totalTasks
      : outcome.error_count;

  // Build updated score
  const updatedScore: SpecializationScore = {
    agent_id: agentId,
    dimension,
    value,
    success_count: successCount,
    failure_count: failureCount,
    avg_duration_ms: avgDuration,
    avg_error_count: avgErrorCount,
    competence: 0, // Will be calculated below
    confidence: 0, // Will be calculated below
    last_updated: new Date().toISOString(),
  };

  // Calculate competence and confidence
  updatedScore.competence = calculateCompetence(updatedScore, config);
  updatedScore.confidence = calculateConfidence(updatedScore, config);

  // Validate and store
  const validated = SpecializationScoreSchema.parse(updatedScore);
  await storage.storeSpecializationScore(validated);
}

/**
 * Update agent's aggregate specialization profile
 *
 * Recalculates top specializations based on weighted competence (competence × confidence).
 *
 * @param agentId - Agent identifier
 * @param storage - Learning storage
 * @param config - Specialization configuration
 */
async function updateAgentSpecialization(
  agentId: string,
  storage: LearningStorage,
  config: SpecializationConfig,
): Promise<void> {
  // Fetch all scores for this agent
  const allScores = await storage.getAllSpecializationScores(agentId);

  if (allScores.length === 0) {
    return; // No data yet
  }

  // Calculate aggregate stats
  let totalTasks = 0;
  let totalSuccess = 0;

  for (const score of allScores) {
    const tasks = score.success_count + score.failure_count;
    totalTasks += tasks;
    totalSuccess += score.success_count;
  }

  const successRate = totalTasks > 0 ? totalSuccess / totalTasks : 0;

  // Find top specializations (by weighted competence)
  const scored = allScores
    .map((score) => ({
      score,
      weighted: score.competence * score.confidence,
      key: `${score.dimension}:${score.value}`,
    }))
    .filter((s) => s.score.confidence >= config.minConfidenceForTop)
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, config.topSpecializationsCount);

  const topSpecializations = scored.map((s) => s.key);

  // Get or create agent specialization
  const existing = await storage.getAgentSpecialization(agentId);

  const updated: AgentSpecialization = {
    agent_id: agentId,
    total_tasks: totalTasks,
    success_rate: successRate,
    scores: allScores,
    top_specializations: topSpecializations,
    first_seen: existing?.first_seen || new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  // Validate and store
  const validated = AgentSpecializationSchema.parse(updated);
  await storage.storeAgentSpecialization(validated);
}

// ============================================================================
// Specialist Queries
// ============================================================================

/**
 * Find the best specialist agent for given task dimensions
 *
 * Ranks agents by weighted competence (competence × confidence) across
 * the requested dimensions. Returns the top match.
 *
 * Example:
 * ```typescript
 * const dimensions = new Map<TaskDimension, string>([
 *   ["file_type", "typescript"],
 *   ["domain", "frontend"],
 *   ["complexity", "3"],
 * ]);
 * const specialist = await findSpecialist(dimensions);
 * if (specialist) {
 *   console.log(`Best agent: ${specialist.agentId} (confidence: ${specialist.confidence})`);
 * }
 * ```
 *
 * @param dimensions - Task characteristics to match
 * @param storage - Learning storage (defaults to getStorage())
 * @returns Best specialist match, or null if no qualified agents
 */
export async function findSpecialist(
  dimensions: TaskDimensions,
  storage: LearningStorage = getStorage(),
): Promise<SpecialistQuery | null> {
  if (dimensions.size === 0) {
    return null;
  }

  // Collect all relevant specialization scores
  const agentScores = new Map<string, SpecializationScore[]>();

  for (const [dimension, value] of dimensions) {
    const scores = await storage.findSpecializationScores(dimension, value);

    for (const score of scores) {
      if (!agentScores.has(score.agent_id)) {
        agentScores.set(score.agent_id, []);
      }
      agentScores.get(score.agent_id)!.push(score);
    }
  }

  if (agentScores.size === 0) {
    return null; // No agents have experience with these dimensions
  }

  // Rank agents by average weighted competence
  const ranked = Array.from(agentScores.entries())
    .map(([agentId, scores]) => {
      const weightedSum = scores.reduce(
        (sum, s) => sum + s.competence * s.confidence,
        0,
      );
      const avgWeighted = weightedSum / scores.length;
      const avgConfidence =
        scores.reduce((sum, s) => sum + s.confidence, 0) / scores.length;

      return {
        agentId,
        matchedScores: scores,
        weightedCompetence: avgWeighted,
        confidence: avgConfidence,
      };
    })
    .sort((a, b) => b.weightedCompetence - a.weightedCompetence);

  const best = ranked[0];
  if (!best) {
    return null;
  }

  return {
    agentId: best.agentId,
    confidence: best.confidence,
    matchedScores: best.matchedScores,
  };
}

/**
 * Get all agents ranked by their specialization in a single dimension
 *
 * Example:
 * ```typescript
 * // Find all TypeScript specialists
 * const tsExperts = await findSpecialistsByDimension("file_type", "typescript");
 * console.log(`Top TypeScript agent: ${tsExperts[0].agentId}`);
 * ```
 *
 * @param dimension - Task dimension to query
 * @param value - Dimension value to match
 * @param storage - Learning storage (defaults to getStorage())
 * @returns Array of specialists ranked by weighted competence
 */
export async function findSpecialistsByDimension(
  dimension: TaskDimension,
  value: string,
  storage: LearningStorage = getStorage(),
): Promise<SpecialistQuery[]> {
  const scores = await storage.findSpecializationScores(dimension, value);

  return scores
    .map((score) => ({
      agentId: score.agent_id,
      confidence: score.confidence,
      matchedScores: [score],
    }))
    .sort((a, b) => {
      const aWeighted =
        a.matchedScores[0].competence * a.matchedScores[0].confidence;
      const bWeighted =
        b.matchedScores[0].competence * b.matchedScores[0].confidence;
      return bWeighted - aWeighted;
    });
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Get agent specialization profile
 *
 * Returns the full specialization profile for an agent, including
 * all tracked dimensions and top specializations.
 *
 * @param agentId - Agent identifier
 * @param storage - Learning storage (defaults to getStorage())
 * @returns Agent specialization profile, or null if agent not found
 */
export async function getAgentProfile(
  agentId: string,
  storage: LearningStorage = getStorage(),
): Promise<AgentSpecialization | null> {
  return storage.getAgentSpecialization(agentId);
}

/**
 * Get all agents with their specialization profiles
 *
 * Useful for displaying a roster of available specialists.
 *
 * @param storage - Learning storage (defaults to getStorage())
 * @returns Array of all agent specialization profiles
 */
export async function getAllAgentProfiles(
  storage: LearningStorage = getStorage(),
): Promise<AgentSpecialization[]> {
  return storage.getAllAgentSpecializations();
}

// ============================================================================
// Exports
// ============================================================================

export {
  type SpecializationScore,
  type AgentSpecialization,
  type TaskDimension,
  type TaskDimensions,
  type SpecialistQuery,
};
