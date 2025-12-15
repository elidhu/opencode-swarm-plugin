/**
 * Metric Scorers for Eval Capture
 *
 * Evalite scorers that evaluate decomposition quality based on computed metrics:
 * - Scope Accuracy: actual_files / planned_files (goal: 0.8-1.2)
 * - Time Balance: max_duration / min_duration (goal: < 3.0)
 * - File Overlap: Count of files in multiple subtasks (goal: 0)
 *
 * These scorers consume EvalRecord data from eval-capture.ts
 */

import { createScorer } from "evalite";
import type { EvalRecord } from "../../src/eval-capture.js";

/**
 * Scope Accuracy Scorer
 *
 * Measures how accurately the decomposition estimated file scope.
 * Score: 1.0 if ratio is between 0.8-1.2, decreases outside this range.
 *
 * Good decompositions accurately predict which files will be touched.
 * - Under 0.8: Significant underestimate (missed files)
 * - 0.8-1.2: Accurate estimate
 * - Over 1.2: Over-scoped (planned unnecessary files)
 */
export const scopeAccuracyScorer = createScorer({
  name: "Scope Accuracy",
  description: "Measures accuracy of planned file scope vs actual files touched",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      if (!record.finalized || record.scope_accuracy === undefined) {
        return {
          score: 0,
          message: "Record not finalized or scope_accuracy not computed",
        };
      }

      const accuracy = record.scope_accuracy;

      // Perfect: 0.8-1.2 range
      if (accuracy >= 0.8 && accuracy <= 1.2) {
        return {
          score: 1.0,
          message: `Excellent scope accuracy: ${(accuracy * 100).toFixed(0)}% (within 0.8-1.2)`,
        };
      }

      // Under-scoped: < 0.8
      if (accuracy < 0.8) {
        // Score decreases linearly from 1.0 at 0.8 to 0 at 0.0
        const score = accuracy / 0.8;
        return {
          score,
          message: `Under-scoped: ${(accuracy * 100).toFixed(0)}% of planned files (${record.actual_files?.length || 0} actual vs ${record.planned_files.length} planned)`,
        };
      }

      // Over-scoped: > 1.2
      // Score decreases linearly from 1.0 at 1.2 to 0.5 at 2.0
      const score = Math.max(0.5, 1.0 - (accuracy - 1.2) / 0.8 * 0.5);
      return {
        score,
        message: `Over-scoped: ${(accuracy * 100).toFixed(0)}% of planned files (${record.actual_files?.length || 0} actual vs ${record.planned_files.length} planned)`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * Time Balance Scorer
 *
 * Measures how evenly subtask durations are distributed.
 * Score: 1.0 if ratio < 3.0, decreases as ratio increases.
 *
 * Good decompositions create subtasks that take similar amounts of time.
 * Imbalanced times indicate:
 * - Some agents finish early and idle
 * - Bottlenecks on slow subtasks
 * - Inefficient resource utilization
 *
 * Target: max_duration / min_duration < 3.0
 */
export const timeBalanceScorer = createScorer({
  name: "Time Balance",
  description: "Measures balance of subtask durations",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      if (!record.finalized || record.time_balance === undefined) {
        return {
          score: 0,
          message: "Record not finalized or time_balance not computed",
        };
      }

      const balance = record.time_balance;

      // Perfect: < 3.0
      if (balance < 3.0) {
        return {
          score: 1.0,
          message: `Good time balance: ${balance.toFixed(1)}x (longest/shortest < 3.0)`,
        };
      }

      // Poor balance: >= 3.0
      // Score decreases from 1.0 at 3.0 to 0 at 10.0
      const score = Math.max(0, 1.0 - (balance - 3.0) / 7.0);
      return {
        score,
        message: `Poor time balance: ${balance.toFixed(1)}x (longest/shortest, goal < 3.0)`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * File Overlap Scorer
 *
 * Counts files that appear in multiple subtasks.
 * Score: 1.0 if no overlap, decreases with count.
 *
 * File conflicts cause:
 * - Merge conflicts between agents
 * - Coordination overhead
 * - Wasted parallel execution
 *
 * Target: 0 overlapping files
 */
export const fileOverlapScorer = createScorer({
  name: "File Overlap",
  description: "Counts files assigned to multiple subtasks",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      if (!record.finalized || record.file_overlap_count === undefined) {
        return {
          score: 0,
          message: "Record not finalized or file_overlap_count not computed",
        };
      }

      const overlapCount = record.file_overlap_count;

      // Perfect: no overlap
      if (overlapCount === 0) {
        return {
          score: 1.0,
          message: "No file conflicts - perfect independence",
        };
      }

      // With overlap: score decreases
      // Score = 1 / (1 + overlap_count)
      // 1 overlap = 0.5, 2 = 0.33, 3 = 0.25, etc.
      const score = 1.0 / (1.0 + overlapCount);
      return {
        score,
        message: `File conflicts detected: ${overlapCount} file(s) in multiple subtasks`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * Success Rate Scorer
 *
 * Measures percentage of subtasks that succeeded.
 * Score: success_rate (0-1)
 *
 * Good decompositions have high success rates.
 * Failures indicate:
 * - Poor task breakdown
 * - Missing dependencies
 * - Unclear instructions
 */
export const successRateScorer = createScorer({
  name: "Success Rate",
  description: "Percentage of subtasks that completed successfully",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      if (!record.finalized || record.success_rate === undefined) {
        return {
          score: 0,
          message: "Record not finalized or success_rate not computed",
        };
      }

      const rate = record.success_rate;

      return {
        score: rate,
        message: `${(rate * 100).toFixed(0)}% subtasks succeeded (${record.outcomes.filter((o) => o.success).length}/${record.outcomes.length})`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});

/**
 * Overall Quality Scorer
 *
 * Composite scorer that combines all metrics.
 * Score: average of scope_accuracy, time_balance, file_overlap, success_rate scores.
 *
 * This provides a single quality score for comparing decompositions.
 */
export const overallQualityScorer = createScorer({
  name: "Overall Quality",
  description: "Composite quality score combining all metrics",
  scorer: ({ output }) => {
    try {
      const record = JSON.parse(String(output)) as EvalRecord;

      if (!record.finalized) {
        return {
          score: 0,
          message: "Record not finalized",
        };
      }

      // Use quality_passed as primary signal
      if (record.quality_passed) {
        return {
          score: 1.0,
          message: "All quality thresholds met",
        };
      }

      // Otherwise compute partial score based on issues
      const issueCount = record.quality_issues?.length || 0;
      // Score decreases with issue count: 0 issues = 1.0, 4+ issues = 0.0
      const score = Math.max(0, 1.0 - issueCount * 0.25);

      return {
        score,
        message: `Quality issues detected: ${record.quality_issues?.join("; ") || "none"}`,
      };
    } catch (error) {
      return {
        score: 0,
        message: `Failed to parse EvalRecord: ${error}`,
      };
    }
  },
});
