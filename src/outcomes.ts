/**
 * Unified Outcomes Module - Single source of truth for subtask outcomes
 *
 * Merges learning.ts OutcomeSignalsSchema and eval-capture.ts SubtaskOutcomeSchema
 * into a unified UnifiedOutcome schema with 80% field overlap elimination.
 *
 * OutcomeAdapter writes to BOTH systems with zero-config:
 * - eval-capture: JSONL for evalite metrics
 * - learning: LanceDB for confidence scoring
 *
 * Key design:
 * - UnifiedOutcome: Combined schema (14 fields vs 11+9 separate)
 * - OutcomeAdapter: Writes to both storage systems atomically
 * - Zero-config: Called automatically by hive_complete
 *
 * @see src/learning.ts - OutcomeSignalsSchema (11 fields)
 * @see src/eval-capture.ts - SubtaskOutcomeSchema (9 fields)
 * @see docs/analysis/feature-overlap-audit.md - Overlap analysis
 */

import { z } from "zod";
import {
  type OutcomeSignals,
  type ScoredOutcome,
  DecompositionStrategySchema,
  FailureModeSchema,
  scoreImplicitFeedback,
  DEFAULT_LEARNING_CONFIG,
  type LearningConfig,
} from "./learning";
import { captureSubtaskOutcome, type SubtaskOutcome } from "./eval-capture";
import { getStorage } from "./storage";

// ============================================================================
// Unified Schema
// ============================================================================

/**
 * Unified outcome schema - merges learning and eval-capture fields
 *
 * Core fields (both systems):
 * - bead_id, duration_ms, error_count, retry_count, success, files_touched
 *
 * Timestamps (from eval-capture):
 * - started_at, completed_at (epoch ms)
 *
 * Strategy info (from learning):
 * - strategy, failure_mode, criteria
 *
 * Metadata (from eval-capture):
 * - title, agent_name
 *
 * Error info (from eval-capture):
 * - error_message
 */
export const UnifiedOutcomeSchema = z.object({
  // === Core fields (both systems) ===
  /** Subtask bead ID */
  bead_id: z.string(),
  /** Epic bead ID (extracted from bead_id or provided) */
  epic_id: z.string(),
  /** Duration in milliseconds */
  duration_ms: z.number().int().min(0),
  /** Number of errors encountered */
  error_count: z.number().int().min(0).default(0),
  /** Number of retry attempts */
  retry_count: z.number().int().min(0).default(0),
  /** Whether the subtask ultimately succeeded */
  success: z.boolean(),
  /** Files that were modified */
  files_touched: z.array(z.string()).default([]),

  // === Timestamps (from eval-capture) ===
  /** When subtask started (epoch ms) */
  started_at: z.number().int().min(0),
  /** When subtask completed (epoch ms) */
  completed_at: z.number().int().min(0),

  // === Strategy info (from learning) ===
  /** Decomposition strategy used for this task */
  strategy: DecompositionStrategySchema.optional(),
  /** Failure classification (only when success=false) */
  failure_mode: FailureModeSchema.optional(),
  /** Evaluation criteria used */
  criteria: z.array(z.string()).optional(),

  // === Metadata (from eval-capture) ===
  /** Subtask title */
  title: z.string().optional(),
  /** Agent name that executed the subtask */
  agent_name: z.string().optional(),

  // === Error info (from eval-capture) ===
  /** Error message if failed */
  error_message: z.string().optional(),
});

export type UnifiedOutcome = z.infer<typeof UnifiedOutcomeSchema>;

// ============================================================================
// Outcome Adapter
// ============================================================================

/**
 * Adapter for writing outcomes to both learning and eval-capture systems
 *
 * Zero-config design:
 * - Automatically converts UnifiedOutcome to both system formats
 * - Scores implicit feedback via learning.scoreImplicitFeedback()
 * - Writes to eval-capture JSONL (metrics)
 * - Stores scored feedback in learning LanceDB (confidence)
 *
 * Usage:
 * ```typescript
 * const adapter = getOutcomeAdapter();
 * await adapter.recordOutcome({
 *   bead_id: "proj-abc.1",
 *   epic_id: "proj-abc",
 *   duration_ms: 45000,
 *   error_count: 0,
 *   retry_count: 0,
 *   success: true,
 *   files_touched: ["src/foo.ts"],
 *   started_at: Date.now() - 45000,
 *   completed_at: Date.now(),
 * });
 * ```
 */
export class OutcomeAdapter {
  constructor(private config: LearningConfig = DEFAULT_LEARNING_CONFIG) {}

  /**
   * Record outcome to BOTH systems with zero-config
   *
   * Flow:
   * 1. Validate unified outcome
   * 2. Convert to eval-capture format → append to JSONL
   * 3. Convert to learning format → score → store feedback
   *
   * @param outcome - Unified outcome data
   * @throws Error if storage operations fail
   */
  async recordOutcome(outcome: UnifiedOutcome): Promise<void> {
    // Validate
    const validated = UnifiedOutcomeSchema.parse(outcome);

    // 1. Record to eval-capture (JSONL for evalite metrics)
    try {
      await this.recordToEvalCapture(validated);
    } catch (error) {
      console.warn(
        `[outcomes] Failed to record to eval-capture: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Non-fatal: continue to learning storage
    }

    // 2. Score and record to learning system (LanceDB for confidence)
    try {
      await this.recordToLearning(validated);
    } catch (error) {
      console.warn(
        `[outcomes] Failed to record to learning: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Non-fatal: continue
    }
  }

  /**
   * Record to eval-capture system (JSONL)
   */
  private async recordToEvalCapture(outcome: UnifiedOutcome): Promise<void> {
    const evalOutcome: SubtaskOutcome = {
      bead_id: outcome.bead_id,
      title: outcome.title || outcome.bead_id,
      agent_name: outcome.agent_name,
      duration_ms: outcome.duration_ms,
      files_touched: outcome.files_touched,
      success: outcome.success,
      error_count: outcome.error_count,
      retry_count: outcome.retry_count,
      timestamp: new Date(outcome.completed_at).toISOString(),
    };

    await captureSubtaskOutcome(outcome.epic_id, evalOutcome);
  }

  /**
   * Record to learning system (LanceDB)
   *
   * Flow:
   * 1. Convert to OutcomeSignals format
   * 2. Score via scoreImplicitFeedback()
   * 3. Store scored feedback event
   */
  private async recordToLearning(outcome: UnifiedOutcome): Promise<void> {
    // Convert to learning format
    const signals: OutcomeSignals = {
      bead_id: outcome.bead_id,
      duration_ms: outcome.duration_ms,
      error_count: outcome.error_count,
      retry_count: outcome.retry_count,
      success: outcome.success,
      files_touched: outcome.files_touched,
      timestamp: new Date(outcome.completed_at).toISOString(),
      strategy: outcome.strategy,
      failure_mode: outcome.failure_mode,
      failure_details: outcome.error_message,
    };

    // Score implicit feedback
    const scored: ScoredOutcome = scoreImplicitFeedback(signals, this.config);

    // Store feedback event
    const storage = getStorage();
    await storage.storeFeedback({
      id: `feedback-${outcome.bead_id}-${outcome.completed_at}`,
      criterion: outcome.strategy || "unknown",
      type: scored.type,
      timestamp: signals.timestamp,
      context: scored.reasoning,
      bead_id: outcome.bead_id,
      raw_value: scored.decayed_value, // Already decayed by scoreImplicitFeedback
    });
  }
}

// ============================================================================
// Singleton Factory
// ============================================================================

/**
 * Global singleton instance for zero-config usage
 */
let outcomeAdapter: OutcomeAdapter | null = null;

/**
 * Get or create the global OutcomeAdapter instance
 *
 * Zero-config singleton pattern - no initialization needed.
 * Uses DEFAULT_LEARNING_CONFIG automatically.
 *
 * @returns Global OutcomeAdapter instance
 */
export function getOutcomeAdapter(): OutcomeAdapter {
  if (!outcomeAdapter) {
    outcomeAdapter = new OutcomeAdapter();
  }
  return outcomeAdapter;
}

/**
 * Reset the global adapter (for testing)
 */
export function resetOutcomeAdapter(): void {
  outcomeAdapter = null;
}
