/**
 * Pattern Maturity Module
 *
 * Tracks decomposition pattern maturity states through lifecycle:
 * candidate → established → proven (or deprecated)
 *
 * Patterns start as candidates until they accumulate enough feedback.
 * Strong positive feedback promotes to proven, strong negative deprecates.
 *
 * Also includes anti-pattern learning - tracks failed decomposition patterns
 * and auto-inverts them to anti-patterns. When a pattern consistently fails,
 * it gets flagged as something to avoid.
 *
 * Pattern-to-Skill Promotion: When patterns reach "proven" state, they can
 * be automatically promoted to reusable skills for future task decomposition.
 *
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/scoring.ts#L73-L98
 * @see https://github.com/Dicklesworthstone/cass_memory_system/blob/main/src/curate.ts#L95-L117
 */
import { z } from "zod";
import { calculateDecayedValue } from "./learning";

// ============================================================================
// Constants
// ============================================================================

/**
 * Tolerance for floating-point comparisons.
 * Used when comparing success rates to avoid floating-point precision issues.
 */
const FLOAT_EPSILON = 0.01;

/** Maximum number of example beads to keep per pattern */
const MAX_EXAMPLE_BEADS = 10;

// ============================================================================
// Schemas
// ============================================================================

/**
 * Pattern kind - whether this is a positive pattern or an anti-pattern
 */
export const PatternKindSchema = z.enum(["pattern", "anti_pattern"]);
export type PatternKind = z.infer<typeof PatternKindSchema>;

/**
 * Decomposition pattern with success/failure tracking.
 *
 * Field relationships:
 * - `kind`: Tracks pattern lifecycle ("pattern" → "anti_pattern" when failure rate exceeds threshold)
 * - `is_negative`: Derived boolean flag for quick filtering (true when kind === "anti_pattern")
 *
 * Both fields exist because:
 * - `kind` is the source of truth for pattern status
 * - `is_negative` enables efficient filtering without string comparison
 */
export const DecompositionPatternSchema = z.object({
  /** Unique ID for this pattern */
  id: z.string(),
  /** Human-readable description of the pattern */
  content: z.string(),
  /** Whether this is a positive pattern or anti-pattern */
  kind: PatternKindSchema,
  /** Whether this pattern should be avoided (true for anti-patterns) */
  is_negative: z.boolean(),
  /** Number of times this pattern succeeded */
  success_count: z.number().int().min(0).default(0),
  /** Number of times this pattern failed */
  failure_count: z.number().int().min(0).default(0),
  /** When this pattern was first observed */
  created_at: z.string(), // ISO-8601
  /** When this pattern was last updated */
  updated_at: z.string(), // ISO-8601
  /** Context about why this pattern was created/inverted */
  reason: z.string().optional(),
  /** Tags for categorization (e.g., "file-splitting", "dependency-ordering") */
  tags: z.array(z.string()).default([]),
  /** Example bead IDs where this pattern was observed */
  example_beads: z.array(z.string()).default([]),
});
export type DecompositionPattern = z.infer<typeof DecompositionPatternSchema>;

/**
 * Result of pattern inversion
 */
export const PatternInversionResultSchema = z.object({
  /** The original pattern */
  original: DecompositionPatternSchema,
  /** The inverted anti-pattern */
  inverted: DecompositionPatternSchema,
  /** Why the inversion happened */
  reason: z.string(),
});
export type PatternInversionResult = z.infer<
  typeof PatternInversionResultSchema
>;

/**
 * Maturity state for a decomposition pattern
 *
 * - candidate: Not enough feedback to judge (< minFeedback events)
 * - established: Enough feedback, neither proven nor deprecated
 * - proven: Strong positive signal (high helpful, low harmful ratio)
 * - deprecated: Strong negative signal (high harmful ratio)
 */
export const MaturityStateSchema = z.enum([
  "candidate",
  "established",
  "proven",
  "deprecated",
]);
export type MaturityState = z.infer<typeof MaturityStateSchema>;

/**
 * Pattern maturity tracking
 *
 * Tracks feedback counts and state transitions for a decomposition pattern.
 */
export const PatternMaturitySchema = z.object({
  /** Unique identifier for the pattern */
  pattern_id: z.string(),
  /** Current maturity state */
  state: MaturityStateSchema,
  /** Number of helpful feedback events */
  helpful_count: z.number().int().min(0),
  /** Number of harmful feedback events */
  harmful_count: z.number().int().min(0),
  /** When the pattern was last validated (ISO-8601) */
  last_validated: z.string(),
  /** When the pattern was promoted to proven (ISO-8601) */
  promoted_at: z.string().optional(),
  /** When the pattern was deprecated (ISO-8601) */
  deprecated_at: z.string().optional(),
  /** Name of the skill this pattern was promoted to (if any) */
  promoted_to_skill: z.string().optional(),
});
export type PatternMaturity = z.infer<typeof PatternMaturitySchema>;

/**
 * Feedback event for maturity tracking
 */
export const MaturityFeedbackSchema = z.object({
  /** Pattern this feedback applies to */
  pattern_id: z.string(),
  /** Whether the pattern was helpful or harmful */
  type: z.enum(["helpful", "harmful"]),
  /** When this feedback was recorded (ISO-8601) */
  timestamp: z.string(),
  /** Raw weight before decay (0-1) */
  weight: z.number().min(0).max(1).default(1),
});
export type MaturityFeedback = z.infer<typeof MaturityFeedbackSchema>;

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for anti-pattern detection
 */
export interface AntiPatternConfig {
  /** Minimum observations before considering inversion */
  minObservations: number;
  /** Failure ratio threshold for inversion (0-1) */
  failureRatioThreshold: number;
  /** Prefix for anti-pattern content */
  antiPatternPrefix: string;
}

export const DEFAULT_ANTI_PATTERN_CONFIG: AntiPatternConfig = {
  minObservations: 3,
  failureRatioThreshold: 0.6, // 60% failure rate triggers inversion
  antiPatternPrefix: "AVOID: ",
};

/**
 * Configuration for maturity calculations
 */
export interface MaturityConfig {
  /** Minimum feedback events before leaving candidate state */
  minFeedback: number;
  /** Minimum decayed helpful score to reach proven state */
  minHelpful: number;
  /** Maximum harmful ratio to reach/maintain proven state */
  maxHarmful: number;
  /** Harmful ratio threshold for deprecation */
  deprecationThreshold: number;
  /** Half-life for decay in days */
  halfLifeDays: number;
}

export const DEFAULT_MATURITY_CONFIG: MaturityConfig = {
  minFeedback: 3,
  minHelpful: 5,
  maxHarmful: 0.15, // 15% harmful is acceptable for proven
  deprecationThreshold: 0.3, // 30% harmful triggers deprecation
  halfLifeDays: 90,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate decayed feedback counts
 *
 * Applies half-life decay to each feedback event based on age.
 *
 * @param feedbackEvents - Raw feedback events
 * @param config - Maturity configuration
 * @param now - Current timestamp for decay calculation
 * @returns Decayed helpful and harmful totals
 */
export function calculateDecayedCounts(
  feedbackEvents: MaturityFeedback[],
  config: MaturityConfig = DEFAULT_MATURITY_CONFIG,
  now: Date = new Date(),
): { decayedHelpful: number; decayedHarmful: number } {
  let decayedHelpful = 0;
  let decayedHarmful = 0;

  for (const event of feedbackEvents) {
    const decay = calculateDecayedValue(
      event.timestamp,
      now,
      config.halfLifeDays,
    );
    const value = event.weight * decay;

    if (event.type === "helpful") {
      decayedHelpful += value;
    } else {
      decayedHarmful += value;
    }
  }

  return { decayedHelpful, decayedHarmful };
}

/**
 * Calculate maturity state from feedback events
 *
 * State determination logic:
 * 1. "deprecated" if harmful ratio > 0.3 AND total >= minFeedback
 * 2. "candidate" if total < minFeedback (not enough data)
 * 3. "proven" if decayedHelpful >= minHelpful AND harmfulRatio < maxHarmful
 * 4. "established" otherwise (enough data but not yet proven)
 *
 * @param feedbackEvents - Feedback events for this pattern
 * @param config - Maturity configuration
 * @param now - Current timestamp for decay calculation
 * @returns Calculated maturity state
 */
export function calculateMaturityState(
  feedbackEvents: MaturityFeedback[],
  config: MaturityConfig = DEFAULT_MATURITY_CONFIG,
  now: Date = new Date(),
): MaturityState {
  const { decayedHelpful, decayedHarmful } = calculateDecayedCounts(
    feedbackEvents,
    config,
    now,
  );

  const total = decayedHelpful + decayedHarmful;
  // Use FLOAT_EPSILON constant (defined at module level)
  const safeTotal = total > FLOAT_EPSILON ? total : 0;
  const harmfulRatio = safeTotal > 0 ? decayedHarmful / safeTotal : 0;

  // Deprecated: high harmful ratio with enough feedback
  if (
    harmfulRatio > config.deprecationThreshold &&
    safeTotal >= config.minFeedback - FLOAT_EPSILON
  ) {
    return "deprecated";
  }

  // Candidate: not enough feedback yet
  if (safeTotal < config.minFeedback - FLOAT_EPSILON) {
    return "candidate";
  }

  // Proven: strong positive signal
  if (
    decayedHelpful >= config.minHelpful - FLOAT_EPSILON &&
    harmfulRatio < config.maxHarmful
  ) {
    return "proven";
  }

  // Established: enough data but not proven
  return "established";
}

/**
 * Create initial pattern maturity record
 *
 * @param patternId - Unique pattern identifier
 * @returns New PatternMaturity in candidate state
 */
export function createPatternMaturity(patternId: string): PatternMaturity {
  return {
    pattern_id: patternId,
    state: "candidate",
    helpful_count: 0,
    harmful_count: 0,
    last_validated: new Date().toISOString(),
  };
}

/**
 * Update pattern maturity with new feedback.
 *
 * Side Effects:
 * - Sets `promoted_at` timestamp on first entry into 'proven' status
 * - Sets `deprecated_at` timestamp on first entry into 'deprecated' status
 * - Updates `helpful_count` and `harmful_count` based on feedback events
 * - Recalculates `state` based on decayed feedback counts
 *
 * State Transitions:
 * - candidate → established: After minFeedback observations (default 3)
 * - established → proven: When decayedHelpful >= minHelpful (5) AND harmfulRatio < maxHarmful (15%)
 * - any → deprecated: When harmfulRatio > deprecationThreshold (30%) AND total >= minFeedback
 *
 * @param maturity - Current maturity record
 * @param feedbackEvents - All feedback events for this pattern
 * @param config - Maturity configuration
 * @returns Updated maturity record with new state
 */
export function updatePatternMaturity(
  maturity: PatternMaturity,
  feedbackEvents: MaturityFeedback[],
  config: MaturityConfig = DEFAULT_MATURITY_CONFIG,
): PatternMaturity {
  const now = new Date();
  const newState = calculateMaturityState(feedbackEvents, config, now);

  // Count raw feedback (not decayed)
  const helpfulCount = feedbackEvents.filter(
    (e) => e.type === "helpful",
  ).length;
  const harmfulCount = feedbackEvents.filter(
    (e) => e.type === "harmful",
  ).length;

  const updated: PatternMaturity = {
    ...maturity,
    state: newState,
    helpful_count: helpfulCount,
    harmful_count: harmfulCount,
    last_validated: now.toISOString(),
  };

  // Track state transitions
  if (newState === "proven" && maturity.state !== "proven") {
    updated.promoted_at = now.toISOString();
  }
  if (newState === "deprecated" && maturity.state !== "deprecated") {
    updated.deprecated_at = now.toISOString();
  }

  return updated;
}

/**
 * Promote a pattern to proven state
 *
 * Manually promotes a pattern regardless of feedback counts.
 * Use when external validation confirms pattern effectiveness.
 *
 * @param maturity - Current maturity record
 * @returns Updated maturity record with proven state
 */
export function promotePattern(maturity: PatternMaturity): PatternMaturity {
  if (maturity.state === "deprecated") {
    throw new Error("Cannot promote a deprecated pattern");
  }

  if (maturity.state === "proven") {
    console.warn(
      `[PatternMaturity] Pattern already proven: ${maturity.pattern_id}`,
    );
    return maturity; // No-op but warn
  }

  if (maturity.state === "candidate" && maturity.helpful_count < 3) {
    console.warn(
      `[PatternMaturity] Promoting candidate with insufficient data: ${maturity.pattern_id} (${maturity.helpful_count} helpful observations)`,
    );
  }

  const now = new Date().toISOString();
  return {
    ...maturity,
    state: "proven",
    promoted_at: now,
    last_validated: now,
  };
}

/**
 * Deprecate a pattern
 *
 * Manually deprecates a pattern regardless of feedback counts.
 * Use when external validation shows pattern is harmful.
 *
 * @param maturity - Current maturity record
 * @param reason - Optional reason for deprecation
 * @returns Updated maturity record with deprecated state
 */
export function deprecatePattern(
  maturity: PatternMaturity,
  _reason?: string,
): PatternMaturity {
  if (maturity.state === "deprecated") {
    return maturity; // Already deprecated
  }

  const now = new Date().toISOString();
  return {
    ...maturity,
    state: "deprecated",
    deprecated_at: now,
    last_validated: now,
  };
}

/**
 * Get weight multiplier based on pattern maturity status.
 *
 * Multipliers chosen to:
 * - Heavily penalize deprecated patterns (0x) - never recommend
 * - Slightly boost proven patterns (1.5x) - reward validated success
 * - Penalize unvalidated candidates (0.5x) - reduce impact until proven
 * - Neutral for established (1.0x) - baseline weight
 *
 * @param state - Pattern maturity status
 * @returns Multiplier to apply to pattern weight
 */
export function getMaturityMultiplier(state: MaturityState): number {
  const multipliers: Record<MaturityState, number> = {
    candidate: 0.5,
    established: 1.0,
    proven: 1.5,
    deprecated: 0,
  };
  return multipliers[state];
}

/**
 * Format maturity state for inclusion in prompts
 *
 * Shows pattern reliability to help agents make informed decisions.
 *
 * @param maturity - Pattern maturity record
 * @returns Formatted string describing pattern reliability
 */
export function formatMaturityForPrompt(maturity: PatternMaturity): string {
  const total = maturity.helpful_count + maturity.harmful_count;

  // Don't show percentages for insufficient data
  if (total < 3) {
    return `[LIMITED DATA - ${total} observation${total !== 1 ? "s" : ""}]`;
  }

  const harmfulRatio =
    total > 0 ? Math.round((maturity.harmful_count / total) * 100) : 0;
  const helpfulRatio =
    total > 0 ? Math.round((maturity.helpful_count / total) * 100) : 0;

  switch (maturity.state) {
    case "candidate":
      return `[CANDIDATE - ${total} observations, needs more data]`;
    case "established":
      return `[ESTABLISHED - ${helpfulRatio}% helpful, ${harmfulRatio}% harmful from ${total} observations]`;
    case "proven":
      return `[PROVEN - ${helpfulRatio}% helpful from ${total} observations]`;
    case "deprecated":
      return `[DEPRECATED - ${harmfulRatio}% harmful, avoid using]`;
  }
}

/**
 * Format multiple patterns with maturity for prompt inclusion
 *
 * Groups patterns by maturity state for clear presentation.
 *
 * @param patterns - Map of pattern content to maturity record
 * @returns Formatted string for prompt inclusion
 */
export function formatPatternsWithMaturityForPrompt(
  patterns: Map<string, PatternMaturity>,
): string {
  const proven: string[] = [];
  const established: string[] = [];
  const candidates: string[] = [];
  const deprecated: string[] = [];

  for (const [content, maturity] of patterns) {
    const formatted = `- ${content} ${formatMaturityForPrompt(maturity)}`;
    switch (maturity.state) {
      case "proven":
        proven.push(formatted);
        break;
      case "established":
        established.push(formatted);
        break;
      case "candidate":
        candidates.push(formatted);
        break;
      case "deprecated":
        deprecated.push(formatted);
        break;
    }
  }

  const sections: string[] = [];

  if (proven.length > 0) {
    sections.push(
      "## Proven Patterns\n\nThese patterns consistently work well:\n\n" +
        proven.join("\n"),
    );
  }

  if (established.length > 0) {
    sections.push(
      "## Established Patterns\n\nThese patterns have track records:\n\n" +
        established.join("\n"),
    );
  }

  if (candidates.length > 0) {
    sections.push(
      "## Candidate Patterns\n\nThese patterns need more validation:\n\n" +
        candidates.join("\n"),
    );
  }

  if (deprecated.length > 0) {
    sections.push(
      "## Deprecated Patterns\n\nAVOID these patterns - they have poor track records:\n\n" +
        deprecated.join("\n"),
    );
  }

  return sections.join("\n\n");
}

// ============================================================================
// Anti-Pattern Functions (from anti-patterns.ts)
// ============================================================================

/**
 * Check if a pattern should be inverted to an anti-pattern
 *
 * A pattern is inverted when:
 * 1. It has enough observations (minObservations)
 * 2. Its failure ratio exceeds the threshold
 *
 * @param pattern - The pattern to check
 * @param config - Anti-pattern configuration
 * @returns Whether the pattern should be inverted
 */
export function shouldInvertPattern(
  pattern: DecompositionPattern,
  config: AntiPatternConfig = DEFAULT_ANTI_PATTERN_CONFIG,
): boolean {
  // Already an anti-pattern
  if (pattern.kind === "anti_pattern") {
    return false;
  }

  const total = pattern.success_count + pattern.failure_count;

  // Not enough observations
  if (total < config.minObservations) {
    return false;
  }

  const failureRatio = pattern.failure_count / total;
  return failureRatio >= config.failureRatioThreshold;
}

/**
 * Invert a pattern to an anti-pattern
 *
 * Creates a new anti-pattern from a failing pattern.
 * The content is prefixed with "AVOID: " and the kind is changed.
 *
 * @param pattern - The pattern to invert
 * @param reason - Why the inversion is happening
 * @param config - Anti-pattern configuration
 * @returns The inverted anti-pattern
 */
export function invertToAntiPattern(
  pattern: DecompositionPattern,
  reason: string,
  config: AntiPatternConfig = DEFAULT_ANTI_PATTERN_CONFIG,
): PatternInversionResult {
  // Clean the content (remove any existing prefix)
  const cleaned = pattern.content
    .replace(/^AVOID:\s*/i, "")
    .replace(/^DO NOT:\s*/i, "")
    .replace(/^NEVER:\s*/i, "");

  const inverted: DecompositionPattern = {
    ...pattern,
    id: `anti-${pattern.id}`,
    content: `${config.antiPatternPrefix}${cleaned}. ${reason}`,
    kind: "anti_pattern",
    is_negative: true,
    reason,
    updated_at: new Date().toISOString(),
  };

  return {
    original: pattern,
    inverted,
    reason,
  };
}

/**
 * Record a pattern observation (success or failure)
 *
 * Updates the pattern's success/failure counts and checks if
 * it should be inverted to an anti-pattern.
 *
 * @param pattern - The pattern to update
 * @param success - Whether this observation was successful
 * @param beadId - Optional bead ID to record as example
 * @param config - Anti-pattern configuration
 * @returns Updated pattern and optional inversion result
 */
export function recordPatternObservation(
  pattern: DecompositionPattern,
  success: boolean,
  beadId?: string,
  config: AntiPatternConfig = DEFAULT_ANTI_PATTERN_CONFIG,
): { pattern: DecompositionPattern; inversion?: PatternInversionResult } {
  // Update counts
  const updated: DecompositionPattern = {
    ...pattern,
    success_count: success ? pattern.success_count + 1 : pattern.success_count,
    failure_count: success ? pattern.failure_count : pattern.failure_count + 1,
    updated_at: new Date().toISOString(),
    example_beads: beadId
      ? [...pattern.example_beads.slice(-(MAX_EXAMPLE_BEADS - 1)), beadId]
      : pattern.example_beads,
  };

  // Check if should invert
  if (shouldInvertPattern(updated, config)) {
    const total = updated.success_count + updated.failure_count;
    const failureRatio = updated.failure_count / total;
    const reason = `Failed ${updated.failure_count}/${total} times (${Math.round(failureRatio * 100)}% failure rate)`;

    return {
      pattern: updated,
      inversion: invertToAntiPattern(updated, reason, config),
    };
  }

  return { pattern: updated };
}

/**
 * Extract patterns from a decomposition description
 *
 * Looks for common decomposition strategies in the text.
 *
 * @param description - Decomposition description or reasoning
 * @returns Extracted pattern descriptions
 */
export function extractPatternsFromDescription(description: string): string[] {
  const patterns: string[] = [];

  /**
   * Regex patterns for detecting common decomposition strategies.
   *
   * Detection is keyword-based and not exhaustive - patterns can be
   * manually created for novel strategies not covered here.
   *
   * Each pattern maps a regex to a strategy name that will be extracted
   * from task descriptions during pattern observation.
   */
  const strategyPatterns: Array<{ regex: RegExp; pattern: string }> = [
    {
      regex: /split(?:ting)?\s+by\s+file\s+type/i,
      pattern: "Split by file type",
    },
    {
      regex: /split(?:ting)?\s+by\s+component/i,
      pattern: "Split by component",
    },
    {
      regex: /split(?:ting)?\s+by\s+layer/i,
      pattern: "Split by layer (UI/logic/data)",
    },
    { regex: /split(?:ting)?\s+by\s+feature/i, pattern: "Split by feature" },
    {
      regex: /one\s+file\s+per\s+(?:sub)?task/i,
      pattern: "One file per subtask",
    },
    { regex: /shared\s+types?\s+first/i, pattern: "Handle shared types first" },
    { regex: /api\s+(?:routes?)?\s+separate/i, pattern: "Separate API routes" },
    {
      regex: /tests?\s+(?:with|alongside)\s+(?:code|implementation)/i,
      pattern: "Tests alongside implementation",
    },
    {
      regex: /tests?\s+(?:in\s+)?separate\s+(?:sub)?task/i,
      pattern: "Tests in separate subtask",
    },
    {
      regex: /parallel(?:ize)?\s+(?:all|everything)/i,
      pattern: "Maximize parallelization",
    },
    {
      regex: /sequential\s+(?:order|execution)/i,
      pattern: "Sequential execution order",
    },
    {
      regex: /dependency\s+(?:chain|order)/i,
      pattern: "Respect dependency chain",
    },
  ];

  for (const { regex, pattern } of strategyPatterns) {
    if (regex.test(description)) {
      patterns.push(pattern);
    }
  }

  return patterns;
}

/**
 * Create a new pattern from a description
 *
 * @param content - Pattern description
 * @param tags - Optional tags for categorization
 * @returns New pattern
 */
export function createPattern(
  content: string,
  tags: string[] = [],
): DecompositionPattern {
  const now = new Date().toISOString();
  return {
    id: `pattern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content,
    kind: "pattern",
    is_negative: false,
    success_count: 0,
    failure_count: 0,
    created_at: now,
    updated_at: now,
    tags,
    example_beads: [],
  };
}

/**
 * Format anti-patterns for inclusion in decomposition prompts
 *
 * @param patterns - Anti-patterns to format
 * @returns Formatted string for prompt inclusion
 */
export function formatAntiPatternsForPrompt(
  patterns: DecompositionPattern[],
): string {
  const antiPatterns = patterns.filter((p) => p.kind === "anti_pattern");

  if (antiPatterns.length === 0) {
    return "";
  }

  const lines = [
    "## Anti-Patterns to Avoid",
    "",
    "Based on past failures, avoid these decomposition strategies:",
    "",
    ...antiPatterns.map((p) => `- ${p.content}`),
    "",
  ];

  return lines.join("\n");
}

/**
 * Format successful patterns for inclusion in prompts.
 *
 * @param patterns - Array of decomposition patterns to filter and format
 * @param minSuccessRate - Minimum success rate to include (default 0.7 = 70%).
 *   Chosen to filter out patterns with marginal track records - only patterns
 *   that succeed at least 70% of the time are recommended.
 * @returns Formatted string of successful patterns for prompt injection
 */
export function formatSuccessfulPatternsForPrompt(
  patterns: DecompositionPattern[],
  minSuccessRate = 0.7,
): string {
  const successful = patterns.filter((p) => {
    if (p.kind === "anti_pattern") return false;
    const total = p.success_count + p.failure_count;
    if (total < 2) return false;
    return p.success_count / total >= minSuccessRate;
  });

  if (successful.length === 0) {
    return "";
  }

  const lines = [
    "## Successful Patterns",
    "",
    "These decomposition strategies have worked well in the past:",
    "",
    ...successful.map((p) => {
      const total = p.success_count + p.failure_count;
      const rate = Math.round((p.success_count / total) * 100);
      return `- ${p.content} (${rate}% success rate)`;
    }),
    "",
  ];

  return lines.join("\n");
}

// ============================================================================
// Pattern-to-Skill Promotion
// ============================================================================

/**
 * Configuration for pattern-to-skill promotion
 */
export interface PromotionConfig {
  /** Minimum helpful count to consider for promotion */
  minHelpfulCount: number;
  /** Maximum harmful ratio (0-1) for promotion eligibility */
  maxHarmfulRatio: number;
  /** Require "proven" state for promotion */
  requireProven: boolean;
}

export const DEFAULT_PROMOTION_CONFIG: PromotionConfig = {
  minHelpfulCount: 5, // Same as proven threshold
  maxHarmfulRatio: 0.15, // Same as proven threshold (15%)
  requireProven: true,
};

/**
 * Result of pattern-to-skill promotion
 */
export interface PromotionResult {
  /** Whether promotion was successful */
  success: boolean;
  /** Name of the created skill */
  skillName?: string;
  /** Reason if promotion failed */
  reason?: string;
  /** Skill body content that was generated */
  skillBody?: string;
}

/**
 * Check if a pattern should be promoted to a skill
 *
 * A pattern is eligible for promotion when:
 * 1. It has reached "proven" state (or meets thresholds if requireProven=false)
 * 2. It hasn't already been promoted to a skill
 * 3. It's not an anti-pattern
 *
 * @param pattern - The decomposition pattern to check
 * @param maturity - The pattern's maturity record
 * @param config - Promotion configuration
 * @returns Whether the pattern should be promoted
 */
export function shouldPromoteToSkill(
  pattern: DecompositionPattern,
  maturity: PatternMaturity,
  config: PromotionConfig = DEFAULT_PROMOTION_CONFIG,
): boolean {
  // Already promoted
  if (maturity.promoted_to_skill) {
    return false;
  }

  // Anti-patterns should not be promoted
  if (pattern.kind === "anti_pattern") {
    return false;
  }

  // Deprecated patterns should not be promoted
  if (maturity.state === "deprecated") {
    return false;
  }

  // Check if proven state is required
  if (config.requireProven && maturity.state !== "proven") {
    return false;
  }

  // Check helpful count threshold
  if (maturity.helpful_count < config.minHelpfulCount) {
    return false;
  }

  // Check harmful ratio
  const total = maturity.helpful_count + maturity.harmful_count;
  const harmfulRatio = total > 0 ? maturity.harmful_count / total : 0;
  if (harmfulRatio > config.maxHarmfulRatio) {
    return false;
  }

  return true;
}

/**
 * Generate a skill name from a pattern
 *
 * Converts pattern content to a valid skill name:
 * - Lowercase
 * - Hyphens for spaces
 * - Removes special characters
 * - Truncates to 64 chars
 *
 * @param pattern - The pattern to generate a name for
 * @returns Valid skill name
 */
export function generateSkillName(pattern: DecompositionPattern): string {
  let name = pattern.content
    .toLowerCase()
    .replace(/avoid:\s*/gi, "") // Remove AVOID prefix if present
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, "") // Remove special chars
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens

  // Truncate to 64 chars (skill name limit)
  if (name.length > 64) {
    name = name.substring(0, 64).replace(/-$/, "");
  }

  // Ensure name is not empty
  if (!name) {
    name = `pattern-${pattern.id.slice(-8)}`;
  }

  return name;
}

/**
 * Generate skill content from a mature pattern
 *
 * Creates a complete skill definition including:
 * - Description explaining when to use the pattern
 * - Body with instructions, success stats, and examples
 *
 * @param pattern - The decomposition pattern
 * @param maturity - The pattern's maturity record
 * @returns Skill metadata and body
 */
export function generateSkillFromPattern(
  pattern: DecompositionPattern,
  maturity: PatternMaturity,
): { description: string; body: string; tags: string[] } {
  const total = maturity.helpful_count + maturity.harmful_count;
  const successRate = total > 0 ? Math.round((maturity.helpful_count / total) * 100) : 0;

  // Generate description focusing on WHEN to use
  const description = `Use when decomposing tasks that follow the pattern: ${pattern.content}. This pattern has a ${successRate}% success rate based on ${total} observations.`;

  // Generate body with instructions and context
  const bodyParts: string[] = [];

  bodyParts.push("# Proven Decomposition Pattern\n");
  bodyParts.push(`This skill codifies a proven decomposition strategy that has succeeded in ${maturity.helpful_count} of ${total} cases.\n`);
  
  bodyParts.push("## Pattern\n");
  bodyParts.push(`${pattern.content}\n`);

  bodyParts.push("## When to Apply\n");
  bodyParts.push("Apply this pattern when decomposing tasks that:\n");
  bodyParts.push(`- Match the strategy described above\n`);
  bodyParts.push(`- Benefit from this decomposition approach\n`);
  bodyParts.push(`- Align with the pattern's success criteria\n`);

  bodyParts.push("## Track Record\n");
  bodyParts.push(`- **Success Rate**: ${successRate}%\n`);
  bodyParts.push(`- **Successful Applications**: ${maturity.helpful_count}\n`);
  bodyParts.push(`- **Total Observations**: ${total}\n`);
  if (maturity.promoted_at) {
    bodyParts.push(`- **Promoted**: ${new Date(maturity.promoted_at).toLocaleDateString()}\n`);
  }

  if (pattern.example_beads.length > 0) {
    bodyParts.push("\n## Example Applications\n");
    bodyParts.push("This pattern was successfully used in the following tasks:\n");
    for (const beadId of pattern.example_beads.slice(0, 5)) {
      bodyParts.push(`- ${beadId}\n`);
    }
  }

  bodyParts.push("\n## Guidelines\n");
  bodyParts.push("When applying this pattern:\n");
  bodyParts.push("1. Verify the task characteristics match the pattern's success conditions\n");
  bodyParts.push("2. Follow the decomposition strategy described above\n");
  bodyParts.push("3. Record feedback to continue improving this pattern\n");

  const body = bodyParts.join("");

  // Include original pattern tags
  const tags = [...pattern.tags, "decomposition", "proven-pattern"];

  return { description, body, tags };
}

/**
 * Promote a mature pattern to a skill
 *
 * This function:
 * 1. Checks if pattern is eligible for promotion
 * 2. Generates skill name and content
 * 3. Creates the skill using the skills system
 * 4. Updates maturity record with promotion info
 *
 * Note: This function expects the skills system to be available.
 * It's designed to be called from higher-level orchestration code
 * that has access to skill creation tools.
 *
 * @param pattern - The decomposition pattern to promote
 * @param maturity - The pattern's maturity record
 * @param skillCreator - Function to create skills (typically from skills module)
 * @param config - Promotion configuration
 * @returns Promotion result with success status and details
 */
export async function promotePatternToSkill(
  pattern: DecompositionPattern,
  maturity: PatternMaturity,
  skillCreator: (args: {
    name: string;
    description: string;
    body: string;
    tags?: string[];
  }) => Promise<{ success: boolean; error?: string }>,
  config: PromotionConfig = DEFAULT_PROMOTION_CONFIG,
): Promise<PromotionResult> {
  // Check eligibility
  if (!shouldPromoteToSkill(pattern, maturity, config)) {
    return {
      success: false,
      reason: "Pattern not eligible for promotion. Must be proven with sufficient success rate.",
    };
  }

  // Generate skill content
  const skillName = generateSkillName(pattern);
  const { description, body, tags } = generateSkillFromPattern(pattern, maturity);

  // Create the skill
  try {
    const result = await skillCreator({
      name: skillName,
      description,
      body,
      tags,
    });

    if (!result.success) {
      return {
        success: false,
        reason: result.error || "Skill creation failed",
      };
    }

    return {
      success: true,
      skillName,
      skillBody: body,
    };
  } catch (error) {
    return {
      success: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Mark a pattern as promoted to a skill
 *
 * Updates the maturity record to track that this pattern
 * has been promoted, preventing duplicate promotions.
 *
 * @param maturity - The pattern's maturity record
 * @param skillName - Name of the created skill
 * @returns Updated maturity record
 */
export function markPatternPromoted(
  maturity: PatternMaturity,
  skillName: string,
): PatternMaturity {
  return {
    ...maturity,
    promoted_to_skill: skillName,
    last_validated: new Date().toISOString(),
  };
}

// ============================================================================
// Storage
// ============================================================================
// Exports
// ============================================================================

export const antiPatternSchemas = {
  PatternKindSchema,
  DecompositionPatternSchema,
  PatternInversionResultSchema,
};

export const maturitySchemas = {
  MaturityStateSchema,
  PatternMaturitySchema,
  MaturityFeedbackSchema,
};
