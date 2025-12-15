/**
 * Comprehensive tests for pattern-maturity.ts
 *
 * Tests behavior of maturity state transitions, decay calculations,
 * and storage operations. Also includes tests for anti-pattern learning
 * (merged from anti-patterns.test.ts).
 *
 * Focuses on observable behavior over internal state.
 */
import { describe, test, expect, beforeEach, it } from "vitest";
import {
  calculateDecayedCounts,
  calculateMaturityState,
  createPatternMaturity,
  updatePatternMaturity,
  promotePattern,
  deprecatePattern,
  getMaturityMultiplier,
  formatMaturityForPrompt,
  formatPatternsWithMaturityForPrompt,
  type MaturityFeedback,
  type PatternMaturity,
  DEFAULT_MATURITY_CONFIG,
  // Anti-pattern imports
  DEFAULT_ANTI_PATTERN_CONFIG,
  DecompositionPatternSchema,
  PatternInversionResultSchema,
  PatternKindSchema,
  createPattern,
  extractPatternsFromDescription,
  formatAntiPatternsForPrompt,
  formatSuccessfulPatternsForPrompt,
  invertToAntiPattern,
  recordPatternObservation,
  shouldInvertPattern,
  type AntiPatternConfig,
  type DecompositionPattern,
} from "./pattern-maturity";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a feedback event with defaults
 */
function createFeedback(
  overrides: Partial<MaturityFeedback> = {},
): MaturityFeedback {
  return {
    pattern_id: "test-pattern",
    type: "helpful",
    timestamp: new Date().toISOString(),
    weight: 1,
    ...overrides,
  };
}

/**
 * Create feedback events at specific days ago
 */
function createFeedbackAt(
  daysAgo: number,
  type: "helpful" | "harmful",
  weight = 1,
): MaturityFeedback {
  const timestamp = new Date();
  timestamp.setDate(timestamp.getDate() - daysAgo);
  return createFeedback({ type, timestamp: timestamp.toISOString(), weight });
}

// ============================================================================
// calculateDecayedCounts Tests
// ============================================================================

describe("calculateDecayedCounts", () => {
  test("returns zero counts for empty feedback", () => {
    const result = calculateDecayedCounts([]);
    expect(result).toEqual({ decayedHelpful: 0, decayedHarmful: 0 });
  });

  test("counts recent helpful feedback at full weight", () => {
    const events = [createFeedback({ type: "helpful" })];
    const result = calculateDecayedCounts(events);
    // Recent feedback should be ~1 (minor decay allowed)
    expect(result.decayedHelpful).toBeGreaterThan(0.99);
    expect(result.decayedHarmful).toBe(0);
  });

  test("counts recent harmful feedback at full weight", () => {
    const events = [createFeedback({ type: "harmful" })];
    const result = calculateDecayedCounts(events);
    expect(result.decayedHelpful).toBe(0);
    expect(result.decayedHarmful).toBeGreaterThan(0.99);
  });

  test("applies decay to old feedback", () => {
    const oldEvent = createFeedbackAt(90, "helpful"); // one half-life
    const recentEvent = createFeedbackAt(0, "helpful");

    const result = calculateDecayedCounts([oldEvent, recentEvent]);

    // 90-day old feedback should be ~0.5x (one half-life)
    // Recent feedback should be ~1.0x
    // Total should be ~1.5
    expect(result.decayedHelpful).toBeGreaterThan(1.4);
    expect(result.decayedHelpful).toBeLessThan(1.6);
  });

  test("handles mixed feedback types", () => {
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
    ];

    const result = calculateDecayedCounts(events);
    expect(result.decayedHelpful).toBeGreaterThan(1.9);
    expect(result.decayedHarmful).toBeGreaterThan(0.99);
  });

  test("respects weight parameter", () => {
    const fullWeight = createFeedback({ type: "helpful", weight: 1 });
    const halfWeight = createFeedback({ type: "helpful", weight: 0.5 });

    const result = calculateDecayedCounts([fullWeight, halfWeight]);

    // ~1.0 + ~0.5 = ~1.5
    expect(result.decayedHelpful).toBeGreaterThan(1.4);
    expect(result.decayedHelpful).toBeLessThan(1.6);
  });

  test("uses custom config half-life", () => {
    const event = createFeedbackAt(45, "helpful"); // half of 90-day half-life
    const config = { ...DEFAULT_MATURITY_CONFIG, halfLifeDays: 45 };

    const result = calculateDecayedCounts([event], config);

    // At custom half-life, should be ~0.5
    expect(result.decayedHelpful).toBeGreaterThan(0.4);
    expect(result.decayedHelpful).toBeLessThan(0.6);
  });

  test("uses custom now parameter for decay calculation", () => {
    const event = createFeedback({
      type: "helpful",
      timestamp: "2024-01-01T00:00:00Z",
    });
    const now = new Date("2024-04-01T00:00:00Z"); // 90 days later

    const result = calculateDecayedCounts(
      [event],
      DEFAULT_MATURITY_CONFIG,
      now,
    );

    // Should be decayed by one half-life
    expect(result.decayedHelpful).toBeGreaterThan(0.4);
    expect(result.decayedHelpful).toBeLessThan(0.6);
  });
});

// ============================================================================
// calculateMaturityState Tests
// ============================================================================

describe("calculateMaturityState", () => {
  test("returns candidate with no feedback", () => {
    const state = calculateMaturityState([]);
    expect(state).toBe("candidate");
  });

  test("returns candidate with insufficient feedback", () => {
    // minFeedback = 3, so 2 events should be candidate
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("candidate");
  });

  test("returns established with enough neutral feedback", () => {
    // 3 helpful, 0 harmful = established (not enough for proven)
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("established");
  });

  test("returns proven with strong positive feedback", () => {
    // minHelpful = 5, maxHarmful = 15%
    // 6 helpful, 1 harmful = 14% harmful, should be proven
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("proven");
  });

  test("returns deprecated with high harmful ratio", () => {
    // deprecationThreshold = 30%
    // 2 helpful, 3 harmful = 60% harmful
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("deprecated");
  });

  test("proven requires minimum helpful count", () => {
    // 4 helpful is below minHelpful (5), even with low harmful ratio
    const events = [
      ...Array(4)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("established"); // not proven
  });

  test("proven requires low harmful ratio", () => {
    // 5 helpful, 2 harmful = 28% harmful (above maxHarmful of 15%)
    const events = [
      ...Array(5)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("established"); // not proven due to harmful ratio
  });

  test("deprecation takes priority over proven", () => {
    // Even with high helpful count, high harmful ratio = deprecated
    const events = [
      ...Array(10)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      ...Array(8)
        .fill(null)
        .map(() => createFeedbackAt(0, "harmful")), // 44% harmful
    ];
    const state = calculateMaturityState(events);
    expect(state).toBe("deprecated");
  });

  test("uses custom config thresholds", () => {
    const config = {
      ...DEFAULT_MATURITY_CONFIG,
      minFeedback: 2,
      minHelpful: 3,
      maxHarmful: 0.2,
      deprecationThreshold: 0.4,
    };

    // 3 helpful, 0 harmful = proven with custom config
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const state = calculateMaturityState(events, config);
    expect(state).toBe("proven");
  });

  test("accounts for decay in state calculation", () => {
    // Old helpful feedback decays, shifting ratios
    // 3 events at 180 days = 2 half-lives = ~0.25x each = ~0.75 total helpful
    // 1 event at 0 days = ~1.0x harmful
    // Total = ~1.75, harmful ratio = 1.0/1.75 = ~57%
    // BUT total < minFeedback (3), so state should be candidate
    const events = [
      createFeedbackAt(180, "helpful"), // heavily decayed (~0.25x)
      createFeedbackAt(180, "helpful"), // heavily decayed (~0.25x)
      createFeedbackAt(180, "helpful"), // heavily decayed (~0.25x)
      createFeedbackAt(0, "harmful"), // recent, full weight (~1.0x)
    ];

    const state = calculateMaturityState(events);
    // Total decayed feedback < minFeedback threshold
    expect(state).toBe("candidate");
  });
});

// ============================================================================
// createPatternMaturity Tests
// ============================================================================

describe("createPatternMaturity", () => {
  test("creates initial maturity in candidate state", () => {
    const maturity = createPatternMaturity("test-pattern");
    expect(maturity.pattern_id).toBe("test-pattern");
    expect(maturity.state).toBe("candidate");
    expect(maturity.helpful_count).toBe(0);
    expect(maturity.harmful_count).toBe(0);
  });

  test("sets last_validated timestamp", () => {
    const before = new Date();
    const maturity = createPatternMaturity("test-pattern");
    const after = new Date();

    const validated = new Date(maturity.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("does not set promoted_at or deprecated_at initially", () => {
    const maturity = createPatternMaturity("test-pattern");
    expect(maturity.promoted_at).toBeUndefined();
    expect(maturity.deprecated_at).toBeUndefined();
  });
});

// ============================================================================
// updatePatternMaturity Tests
// ============================================================================

describe("updatePatternMaturity", () => {
  test("updates state based on feedback", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      createFeedbackAt(0, "harmful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.state).toBe("proven");
  });

  test("updates helpful and harmful counts", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.helpful_count).toBe(2);
    expect(updated.harmful_count).toBe(1);
  });

  test("sets promoted_at on first transition to proven", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.promoted_at).toBeDefined();
    expect(new Date(updated.promoted_at!).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
  });

  test("does not update promoted_at if already proven", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ];

    const first = updatePatternMaturity(maturity, events);
    const promotedAt = first.promoted_at;

    // Add more helpful feedback
    const moreEvents = [
      ...events,
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];
    const second = updatePatternMaturity(first, moreEvents);

    expect(second.promoted_at).toBe(promotedAt); // unchanged
  });

  test("sets deprecated_at on first transition to deprecated", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(updated.deprecated_at).toBeDefined();
  });

  test("does not update deprecated_at if already deprecated", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
      createFeedbackAt(0, "harmful"),
    ];

    const first = updatePatternMaturity(maturity, events);
    const deprecatedAt = first.deprecated_at;

    const moreEvents = [...events, createFeedbackAt(0, "harmful")];
    const second = updatePatternMaturity(first, moreEvents);

    expect(second.deprecated_at).toBe(deprecatedAt); // unchanged
  });

  test("updates last_validated timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [createFeedbackAt(0, "helpful")];

    const before = new Date();
    const updated = updatePatternMaturity(maturity, events);
    const after = new Date();

    const validated = new Date(updated.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("handles state transitions: candidate -> established", () => {
    const maturity = createPatternMaturity("test-pattern");
    const events = [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ];

    const updated = updatePatternMaturity(maturity, events);
    expect(maturity.state).toBe("candidate");
    expect(updated.state).toBe("established");
  });

  test("handles state transitions: established -> proven", () => {
    let maturity = createPatternMaturity("test-pattern");
    // First get to established
    maturity = updatePatternMaturity(maturity, [
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
      createFeedbackAt(0, "helpful"),
    ]);
    expect(maturity.state).toBe("established");

    // Then add enough for proven
    const provenEvents = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ];
    const updated = updatePatternMaturity(maturity, provenEvents);
    expect(updated.state).toBe("proven");
  });

  test("handles state transitions: proven -> deprecated", () => {
    let maturity = createPatternMaturity("test-pattern");
    // First get to proven
    maturity = updatePatternMaturity(maturity, [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
    ]);
    expect(maturity.state).toBe("proven");

    // Then add lots of harmful feedback
    const deprecatedEvents = [
      ...Array(6)
        .fill(null)
        .map(() => createFeedbackAt(0, "helpful")),
      ...Array(8)
        .fill(null)
        .map(() => createFeedbackAt(0, "harmful")),
    ];
    const updated = updatePatternMaturity(maturity, deprecatedEvents);
    expect(updated.state).toBe("deprecated");
  });

  test("handles empty feedback array", () => {
    const maturity = createPatternMaturity("test-pattern");
    const updated = updatePatternMaturity(maturity, []);
    expect(updated.state).toBe("candidate");
    expect(updated.helpful_count).toBe(0);
    expect(updated.harmful_count).toBe(0);
  });
});

// ============================================================================
// promotePattern Tests
// ============================================================================

describe("promotePattern", () => {
  test("promotes candidate to proven", () => {
    const maturity = createPatternMaturity("test-pattern");
    const promoted = promotePattern(maturity);
    expect(promoted.state).toBe("proven");
  });

  test("promotes established to proven", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "established",
      helpful_count: 3,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };
    const promoted = promotePattern(maturity);
    expect(promoted.state).toBe("proven");
  });

  test("sets promoted_at timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const promoted = promotePattern(maturity);
    const after = new Date();

    expect(promoted.promoted_at).toBeDefined();
    const promotedAt = new Date(promoted.promoted_at!);
    expect(promotedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(promotedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("updates last_validated timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const promoted = promotePattern(maturity);
    const after = new Date();

    const validated = new Date(promoted.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("throws error when promoting deprecated pattern", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "deprecated",
      helpful_count: 1,
      harmful_count: 3,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    };

    expect(() => promotePattern(maturity)).toThrow(
      "Cannot promote a deprecated pattern",
    );
  });

  test("returns unchanged maturity when already proven", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "proven",
      helpful_count: 10,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: "2024-01-01T00:00:00Z",
    };

    const promoted = promotePattern(maturity);
    expect(promoted).toBe(maturity); // same reference
    expect(promoted.state).toBe("proven");
  });
});

// ============================================================================
// deprecatePattern Tests
// ============================================================================

describe("deprecatePattern", () => {
  test("deprecates candidate pattern", () => {
    const maturity = createPatternMaturity("test-pattern");
    const deprecated = deprecatePattern(maturity);
    expect(deprecated.state).toBe("deprecated");
  });

  test("deprecates established pattern", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "established",
      helpful_count: 3,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
    };
    const deprecated = deprecatePattern(maturity);
    expect(deprecated.state).toBe("deprecated");
  });

  test("deprecates proven pattern", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "proven",
      helpful_count: 10,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    };
    const deprecated = deprecatePattern(maturity);
    expect(deprecated.state).toBe("deprecated");
  });

  test("sets deprecated_at timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const deprecated = deprecatePattern(maturity);
    const after = new Date();

    expect(deprecated.deprecated_at).toBeDefined();
    const deprecatedAt = new Date(deprecated.deprecated_at!);
    expect(deprecatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(deprecatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("updates last_validated timestamp", () => {
    const maturity = createPatternMaturity("test-pattern");
    const before = new Date();
    const deprecated = deprecatePattern(maturity);
    const after = new Date();

    const validated = new Date(deprecated.last_validated);
    expect(validated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(validated.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  test("returns unchanged maturity when already deprecated", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test-pattern",
      state: "deprecated",
      helpful_count: 1,
      harmful_count: 3,
      last_validated: new Date().toISOString(),
      deprecated_at: "2024-01-01T00:00:00Z",
    };

    const deprecated = deprecatePattern(maturity);
    expect(deprecated).toBe(maturity); // same reference
    expect(deprecated.state).toBe("deprecated");
  });

  test("accepts optional reason parameter", () => {
    const maturity = createPatternMaturity("test-pattern");
    // Reason is accepted but not stored (parameter prefixed with _)
    const deprecated = deprecatePattern(maturity, "test reason");
    expect(deprecated.state).toBe("deprecated");
  });
});

// ============================================================================
// getMaturityMultiplier Tests
// ============================================================================

describe("getMaturityMultiplier", () => {
  test("returns 0.5 for candidate", () => {
    expect(getMaturityMultiplier("candidate")).toBe(0.5);
  });

  test("returns 1.0 for established", () => {
    expect(getMaturityMultiplier("established")).toBe(1.0);
  });

  test("returns 1.5 for proven", () => {
    expect(getMaturityMultiplier("proven")).toBe(1.5);
  });

  test("returns 0 for deprecated", () => {
    expect(getMaturityMultiplier("deprecated")).toBe(0);
  });
});

// ============================================================================
// formatMaturityForPrompt Tests
// ============================================================================

describe("formatMaturityForPrompt", () => {
  test("shows limited data for insufficient observations", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 2,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[LIMITED DATA - 2 observations]");
  });

  test("shows singular observation for count of 1", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 1,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[LIMITED DATA - 1 observation]");
  });

  test("shows candidate with observation count when >= 3", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 3,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[CANDIDATE - 3 observations, needs more data]");
  });

  test("shows established with percentages", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "established",
      helpful_count: 7,
      harmful_count: 3,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe(
      "[ESTABLISHED - 70% helpful, 30% harmful from 10 observations]",
    );
  });

  test("shows proven with helpful percentage", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "proven",
      helpful_count: 9,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[PROVEN - 90% helpful from 10 observations]");
  });

  test("shows deprecated with harmful percentage", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "deprecated",
      helpful_count: 2,
      harmful_count: 8,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[DEPRECATED - 80% harmful, avoid using]");
  });

  test("rounds percentages correctly", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "established",
      helpful_count: 2,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    // 2/3 = 66.666... rounds to 67%, 1/3 = 33.333... rounds to 33%
    expect(formatted).toBe(
      "[ESTABLISHED - 67% helpful, 33% harmful from 3 observations]",
    );
  });

  test("handles zero counts edge case", () => {
    const maturity: PatternMaturity = {
      pattern_id: "test",
      state: "candidate",
      helpful_count: 0,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    };

    const formatted = formatMaturityForPrompt(maturity);
    expect(formatted).toBe("[LIMITED DATA - 0 observations]");
  });
});

// ============================================================================
// formatPatternsWithMaturityForPrompt Tests
// ============================================================================

describe("formatPatternsWithMaturityForPrompt", () => {
  test("formats empty map", () => {
    const patterns = new Map<string, PatternMaturity>();
    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toBe("");
  });

  test("groups patterns by maturity state", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Proven pattern", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 9,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    patterns.set("Established pattern", {
      pattern_id: "p2",
      state: "established",
      helpful_count: 5,
      harmful_count: 2,
      last_validated: new Date().toISOString(),
    });

    patterns.set("Candidate pattern", {
      pattern_id: "p3",
      state: "candidate",
      helpful_count: 3,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
    });

    patterns.set("Deprecated pattern", {
      pattern_id: "p4",
      state: "deprecated",
      helpful_count: 1,
      harmful_count: 5,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);

    expect(formatted).toContain("## Proven Patterns");
    expect(formatted).toContain("- Proven pattern");
    expect(formatted).toContain("## Established Patterns");
    expect(formatted).toContain("- Established pattern");
    expect(formatted).toContain("## Candidate Patterns");
    expect(formatted).toContain("- Candidate pattern");
    expect(formatted).toContain("## Deprecated Patterns");
    expect(formatted).toContain("- Deprecated pattern");
  });

  test("omits sections with no patterns", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Only proven", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 10,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);

    expect(formatted).toContain("## Proven Patterns");
    expect(formatted).not.toContain("## Established Patterns");
    expect(formatted).not.toContain("## Candidate Patterns");
    expect(formatted).not.toContain("## Deprecated Patterns");
  });

  test("includes pattern maturity labels", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Test pattern", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 9,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toContain("[PROVEN - 90% helpful from 10 observations]");
  });

  test("maintains multiple patterns in same section", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Pattern A", {
      pattern_id: "p1",
      state: "proven",
      helpful_count: 10,
      harmful_count: 0,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    patterns.set("Pattern B", {
      pattern_id: "p2",
      state: "proven",
      helpful_count: 8,
      harmful_count: 1,
      last_validated: new Date().toISOString(),
      promoted_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toContain("- Pattern A");
    expect(formatted).toContain("- Pattern B");
  });

  test("formats section headers correctly", () => {
    const patterns = new Map<string, PatternMaturity>();

    patterns.set("Test", {
      pattern_id: "p1",
      state: "deprecated",
      helpful_count: 0,
      harmful_count: 5,
      last_validated: new Date().toISOString(),
      deprecated_at: new Date().toISOString(),
    });

    const formatted = formatPatternsWithMaturityForPrompt(patterns);
    expect(formatted).toContain(
      "## Deprecated Patterns\n\nAVOID these patterns - they have poor track records:",
    );
  });
});

// ============================================================================
// InMemoryMaturityStorage Tests
// InMemoryMaturityStorage tests removed - class no longer exists (LanceDB is mandatory)

// ============================================================================
// Anti-Pattern Tests (merged from anti-patterns.test.ts)
// ============================================================================

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe("PatternKindSchema", () => {
  it("validates 'pattern' kind", () => {
    expect(() => PatternKindSchema.parse("pattern")).not.toThrow();
  });

  it("validates 'anti_pattern' kind", () => {
    expect(() => PatternKindSchema.parse("anti_pattern")).not.toThrow();
  });

  it("rejects invalid kind", () => {
    expect(() => PatternKindSchema.parse("invalid")).toThrow();
  });
});

describe("DecompositionPatternSchema", () => {
  it("validates a complete valid pattern", () => {
    const pattern = {
      id: "pattern-123",
      content: "Split by file type",
      kind: "pattern",
      is_negative: false,
      success_count: 5,
      failure_count: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      example_beads: ["bd-123", "bd-456"],
      tags: ["file-splitting"],
      reason: "Test pattern",
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).not.toThrow();
  });

  it("validates a valid anti-pattern", () => {
    const antiPattern = {
      id: "anti-pattern-123",
      content: "AVOID: Split by file type",
      kind: "anti_pattern",
      is_negative: true,
      success_count: 2,
      failure_count: 8,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      example_beads: [],
      tags: [],
    };
    expect(() => DecompositionPatternSchema.parse(antiPattern)).not.toThrow();
  });

  it("applies default values for optional fields", () => {
    const minimal = {
      id: "pattern-minimal",
      content: "Test pattern",
      kind: "pattern",
      is_negative: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const parsed = DecompositionPatternSchema.parse(minimal);
    expect(parsed.success_count).toBe(0);
    expect(parsed.failure_count).toBe(0);
    expect(parsed.tags).toEqual([]);
    expect(parsed.example_beads).toEqual([]);
  });

  it("rejects negative success_count", () => {
    const pattern = {
      id: "pattern-invalid",
      content: "Test",
      kind: "pattern",
      is_negative: false,
      success_count: -1,
      failure_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).toThrow();
  });

  it("rejects negative failure_count", () => {
    const pattern = {
      id: "pattern-invalid",
      content: "Test",
      kind: "pattern",
      is_negative: false,
      success_count: 0,
      failure_count: -1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).toThrow();
  });

  it("rejects invalid kind", () => {
    const pattern = {
      id: "pattern-invalid",
      content: "Test",
      kind: "invalid_kind",
      is_negative: false,
      success_count: 0,
      failure_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    expect(() => DecompositionPatternSchema.parse(pattern)).toThrow();
  });
});

describe("PatternInversionResultSchema", () => {
  it("validates a complete inversion result", () => {
    const now = new Date().toISOString();
    const result = {
      original: {
        id: "pattern-123",
        content: "Split by file type",
        kind: "pattern",
        is_negative: false,
        success_count: 2,
        failure_count: 8,
        created_at: now,
        updated_at: now,
        tags: [],
        example_beads: [],
      },
      inverted: {
        id: "anti-pattern-123",
        content: "AVOID: Split by file type",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 2,
        failure_count: 8,
        created_at: now,
        updated_at: now,
        tags: [],
        example_beads: [],
      },
      reason: "Failed 8/10 times (80% failure rate)",
    };
    expect(() => PatternInversionResultSchema.parse(result)).not.toThrow();
  });
});

// ============================================================================
// shouldInvertPattern Tests
// ============================================================================

describe("shouldInvertPattern", () => {
  const basePattern: DecompositionPattern = {
    id: "pattern-test",
    content: "Test pattern",
    kind: "pattern",
    is_negative: false,
    success_count: 0,
    failure_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    example_beads: [],
  };

  it("returns true when failure rate exceeds 60%", () => {
    const pattern = {
      ...basePattern,
      success_count: 3,
      failure_count: 7, // 70% failure rate
    };
    expect(shouldInvertPattern(pattern)).toBe(true);
  });

  it("returns true when failure rate equals 60%", () => {
    const pattern = {
      ...basePattern,
      success_count: 4,
      failure_count: 6, // Exactly 60% failure rate
    };
    expect(shouldInvertPattern(pattern)).toBe(true);
  });

  it("returns false when failure rate is below 60%", () => {
    const pattern = {
      ...basePattern,
      success_count: 6,
      failure_count: 4, // 40% failure rate
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns false when failure rate is just below threshold", () => {
    const pattern = {
      ...basePattern,
      success_count: 41,
      failure_count: 59, // 59% failure rate (just below 60%)
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns false with insufficient observations (< minObservations)", () => {
    const pattern = {
      ...basePattern,
      success_count: 0,
      failure_count: 2, // Only 2 observations, need 3
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns false when exactly at minObservations but low failure rate", () => {
    const pattern = {
      ...basePattern,
      success_count: 2,
      failure_count: 1, // Exactly 3 observations, 33% failure
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("returns true when at minObservations with high failure rate", () => {
    const pattern = {
      ...basePattern,
      success_count: 1,
      failure_count: 2, // Exactly 3 observations, 67% failure
    };
    expect(shouldInvertPattern(pattern)).toBe(true);
  });

  it("returns false when already an anti-pattern", () => {
    const antiPattern = {
      ...basePattern,
      kind: "anti_pattern" as const,
      is_negative: true,
      success_count: 0,
      failure_count: 10, // 100% failure but already anti-pattern
    };
    expect(shouldInvertPattern(antiPattern)).toBe(false);
  });

  it("returns false with zero observations", () => {
    const pattern = {
      ...basePattern,
      success_count: 0,
      failure_count: 0,
    };
    expect(shouldInvertPattern(pattern)).toBe(false);
  });

  it("respects custom config minObservations", () => {
    const pattern = {
      ...basePattern,
      success_count: 1,
      failure_count: 4, // 80% failure
    };
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      minObservations: 5,
    };
    expect(shouldInvertPattern(pattern, config)).toBe(true);
  });

  it("respects custom config failureRatioThreshold", () => {
    const pattern = {
      ...basePattern,
      success_count: 3,
      failure_count: 7, // 70% failure
    };
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      failureRatioThreshold: 0.8, // Need 80% failure
    };
    expect(shouldInvertPattern(pattern, config)).toBe(false);
  });
});

// ============================================================================
// invertToAntiPattern Tests
// ============================================================================

describe("invertToAntiPattern", () => {
  const basePattern: DecompositionPattern = {
    id: "pattern-123",
    content: "Split by file type",
    kind: "pattern",
    is_negative: false,
    success_count: 2,
    failure_count: 8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: ["file-splitting"],
    example_beads: ["bd-123", "bd-456"],
  };

  it("converts pattern to anti-pattern with correct kind", () => {
    const result = invertToAntiPattern(basePattern, "Test reason");
    expect(result.inverted.kind).toBe("anti_pattern");
    expect(result.inverted.is_negative).toBe(true);
  });

  it("prefixes content with AVOID:", () => {
    const result = invertToAntiPattern(basePattern, "Test reason");
    expect(result.inverted.content).toContain("AVOID:");
    expect(result.inverted.content).toContain("Split by file type");
  });

  it("appends reason to content", () => {
    const result = invertToAntiPattern(basePattern, "Failed too many times");
    expect(result.inverted.content).toContain("Failed too many times");
  });

  it("preserves success and failure counts", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.success_count).toBe(basePattern.success_count);
    expect(result.inverted.failure_count).toBe(basePattern.failure_count);
  });

  it("preserves example_beads", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.example_beads).toEqual(["bd-123", "bd-456"]);
  });

  it("preserves tags", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.tags).toEqual(["file-splitting"]);
  });

  it("generates new ID with 'anti-' prefix", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.inverted.id).toBe("anti-pattern-123");
  });

  it("stores reason in inverted pattern", () => {
    const result = invertToAntiPattern(basePattern, "Custom reason");
    expect(result.inverted.reason).toBe("Custom reason");
  });

  it("updates updated_at timestamp", () => {
    const before = new Date();
    const result = invertToAntiPattern(basePattern, "Test");
    const after = new Date();
    const updatedAt = new Date(result.inverted.updated_at);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("returns original pattern in result", () => {
    const result = invertToAntiPattern(basePattern, "Test");
    expect(result.original).toEqual(basePattern);
  });

  it("returns reason in result", () => {
    const result = invertToAntiPattern(basePattern, "Test reason");
    expect(result.reason).toBe("Test reason");
  });

  it("cleans existing AVOID: prefix", () => {
    const pattern = {
      ...basePattern,
      content: "AVOID: Split by file type",
    };
    const result = invertToAntiPattern(pattern, "Test");
    // Should not have double prefix
    expect(result.inverted.content).toMatch(/^AVOID: Split by file type\./);
    expect(result.inverted.content).not.toMatch(/AVOID:.*AVOID:/);
  });

  it("cleans existing DO NOT: prefix", () => {
    const pattern = {
      ...basePattern,
      content: "DO NOT: Split by file type",
    };
    const result = invertToAntiPattern(pattern, "Test");
    expect(result.inverted.content).toMatch(/^AVOID: Split by file type\./);
  });

  it("cleans existing NEVER: prefix", () => {
    const pattern = {
      ...basePattern,
      content: "NEVER: Split by file type",
    };
    const result = invertToAntiPattern(pattern, "Test");
    expect(result.inverted.content).toMatch(/^AVOID: Split by file type\./);
  });

  it("respects custom antiPatternPrefix", () => {
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      antiPatternPrefix: "DO NOT: ",
    };
    const result = invertToAntiPattern(basePattern, "Test", config);
    expect(result.inverted.content).toContain("DO NOT:");
  });
});

// ============================================================================
// recordPatternObservation Tests
// ============================================================================

describe("recordPatternObservation", () => {
  const basePattern: DecompositionPattern = {
    id: "pattern-test",
    content: "Test pattern",
    kind: "pattern",
    is_negative: false,
    success_count: 5,
    failure_count: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tags: [],
    example_beads: [],
  };

  it("increments success count on success", () => {
    const result = recordPatternObservation(basePattern, true);
    expect(result.pattern.success_count).toBe(6);
    expect(result.pattern.failure_count).toBe(2);
  });

  it("increments failure count on failure", () => {
    const result = recordPatternObservation(basePattern, false);
    expect(result.pattern.success_count).toBe(5);
    expect(result.pattern.failure_count).toBe(3);
  });

  it("adds bead to example_beads when provided", () => {
    const result = recordPatternObservation(basePattern, true, "bd-789");
    expect(result.pattern.example_beads).toContain("bd-789");
  });

  it("does not modify example_beads when beadId not provided", () => {
    const result = recordPatternObservation(basePattern, true);
    expect(result.pattern.example_beads).toEqual([]);
  });

  it("limits example_beads to MAX_EXAMPLE_BEADS (10)", () => {
    const pattern = {
      ...basePattern,
      example_beads: Array(10)
        .fill(0)
        .map((_, i) => `bd-${i}`),
    };
    const result = recordPatternObservation(pattern, true, "bd-new");
    expect(result.pattern.example_beads.length).toBe(10);
    expect(result.pattern.example_beads).toContain("bd-new");
    expect(result.pattern.example_beads).not.toContain("bd-0"); // Oldest removed
  });

  it("keeps newest beads when trimming example_beads", () => {
    const pattern = {
      ...basePattern,
      example_beads: [
        "bd-1",
        "bd-2",
        "bd-3",
        "bd-4",
        "bd-5",
        "bd-6",
        "bd-7",
        "bd-8",
        "bd-9",
        "bd-10",
      ],
    };
    const result = recordPatternObservation(pattern, true, "bd-new");
    expect(result.pattern.example_beads[0]).toBe("bd-2"); // First one removed
    expect(result.pattern.example_beads[9]).toBe("bd-new"); // New one added
  });

  it("updates updated_at timestamp", () => {
    const before = new Date();
    const result = recordPatternObservation(basePattern, true);
    const after = new Date();
    const updatedAt = new Date(result.pattern.updated_at);
    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("does not invert when below threshold", () => {
    const result = recordPatternObservation(basePattern, false); // 5 success, 3 failure = 37.5%
    expect(result.inversion).toBeUndefined();
  });

  it("inverts when crossing threshold", () => {
    const pattern = {
      ...basePattern,
      success_count: 2,
      failure_count: 4, // Currently 66% failure
    };
    const result = recordPatternObservation(pattern, false); // Now 2/7 = 71% failure
    expect(result.inversion).toBeDefined();
    if (result.inversion) {
      expect(result.inversion.inverted.kind).toBe("anti_pattern");
    }
  });

  it("includes failure statistics in inversion reason", () => {
    const pattern = {
      ...basePattern,
      success_count: 3,
      failure_count: 6, // 66% failure
    };
    const result = recordPatternObservation(pattern, false); // 70% failure
    expect(result.inversion).toBeDefined();
    if (result.inversion) {
      expect(result.inversion.reason).toContain("7/10");
      expect(result.inversion.reason).toContain("70%");
    }
  });

  it("does not invert already-inverted anti-patterns", () => {
    const antiPattern: DecompositionPattern = {
      ...basePattern,
      kind: "anti_pattern",
      is_negative: true,
      success_count: 0,
      failure_count: 10,
    };
    const result = recordPatternObservation(antiPattern, false);
    expect(result.inversion).toBeUndefined();
  });

  it("respects custom config for inversion", () => {
    const pattern = {
      ...basePattern,
      success_count: 2,
      failure_count: 3, // 60% failure
    };
    const config: AntiPatternConfig = {
      ...DEFAULT_ANTI_PATTERN_CONFIG,
      failureRatioThreshold: 0.7, // Need 70%
    };
    const result = recordPatternObservation(pattern, false, undefined, config);
    expect(result.inversion).toBeUndefined(); // 66% not enough
  });

  it("preserves original pattern fields", () => {
    const result = recordPatternObservation(basePattern, true);
    expect(result.pattern.id).toBe(basePattern.id);
    expect(result.pattern.content).toBe(basePattern.content);
    expect(result.pattern.kind).toBe(basePattern.kind);
    expect(result.pattern.tags).toEqual(basePattern.tags);
  });
});

// ============================================================================
// extractPatternsFromDescription Tests
// ============================================================================

describe("extractPatternsFromDescription", () => {
  it("detects 'split by file type' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by file type");
    expect(patterns).toContain("Split by file type");
  });

  it("detects 'splitting by file type' variant", () => {
    const patterns = extractPatternsFromDescription("Splitting by file type");
    expect(patterns).toContain("Split by file type");
  });

  it("detects 'split by component' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by component");
    expect(patterns).toContain("Split by component");
  });

  it("detects 'split by layer' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by layer");
    expect(patterns).toContain("Split by layer (UI/logic/data)");
  });

  it("detects 'split by feature' pattern", () => {
    const patterns = extractPatternsFromDescription("Split by feature");
    expect(patterns).toContain("Split by feature");
  });

  it("detects 'one file per task' pattern", () => {
    const patterns = extractPatternsFromDescription("One file per task");
    expect(patterns).toContain("One file per subtask");
  });

  it("detects 'shared types first' pattern", () => {
    const patterns = extractPatternsFromDescription("shared types first");
    expect(patterns).toContain("Handle shared types first");
  });

  it("detects 'API routes separate' pattern", () => {
    const patterns = extractPatternsFromDescription("API routes separate");
    expect(patterns).toContain("Separate API routes");
  });

  it("detects 'tests with code' pattern", () => {
    const patterns = extractPatternsFromDescription("tests with code");
    expect(patterns).toContain("Tests alongside implementation");
  });

  it("detects 'tests in separate subtask' pattern", () => {
    const patterns = extractPatternsFromDescription(
      "tests in separate subtask",
    );
    expect(patterns).toContain("Tests in separate subtask");
  });

  it("detects 'parallelize all' pattern", () => {
    const patterns = extractPatternsFromDescription("Parallelize everything");
    expect(patterns).toContain("Maximize parallelization");
  });

  it("detects 'sequential order' pattern", () => {
    const patterns = extractPatternsFromDescription("Sequential execution");
    expect(patterns).toContain("Sequential execution order");
  });

  it("detects 'dependency chain' pattern", () => {
    const patterns = extractPatternsFromDescription("dependency chain");
    expect(patterns).toContain("Respect dependency chain");
  });

  it("returns empty array for unrecognized descriptions", () => {
    const patterns = extractPatternsFromDescription("random gibberish text");
    expect(patterns).toEqual([]);
  });

  it("detects multiple patterns in one description", () => {
    const patterns = extractPatternsFromDescription(
      "Split by file type and handle shared types first",
    );
    expect(patterns).toContain("Split by file type");
    expect(patterns).toContain("Handle shared types first");
    expect(patterns.length).toBeGreaterThanOrEqual(2);
  });

  it("is case-insensitive", () => {
    const patterns = extractPatternsFromDescription("SPLIT BY FILE TYPE");
    expect(patterns).toContain("Split by file type");
  });

  it("handles partial matches in longer sentences", () => {
    const patterns = extractPatternsFromDescription(
      "We should split by component for this refactor",
    );
    expect(patterns).toContain("Split by component");
  });
});

// ============================================================================
// createPattern Tests
// ============================================================================

describe("createPattern", () => {
  it("creates pattern with provided content", () => {
    const pattern = createPattern("Test pattern");
    expect(pattern.content).toBe("Test pattern");
  });

  it("creates pattern with kind='pattern'", () => {
    const pattern = createPattern("Test");
    expect(pattern.kind).toBe("pattern");
  });

  it("creates pattern with is_negative=false", () => {
    const pattern = createPattern("Test");
    expect(pattern.is_negative).toBe(false);
  });

  it("initializes counts to zero", () => {
    const pattern = createPattern("Test");
    expect(pattern.success_count).toBe(0);
    expect(pattern.failure_count).toBe(0);
  });

  it("includes provided tags", () => {
    const pattern = createPattern("Test", ["tag1", "tag2"]);
    expect(pattern.tags).toEqual(["tag1", "tag2"]);
  });

  it("defaults to empty tags array", () => {
    const pattern = createPattern("Test");
    expect(pattern.tags).toEqual([]);
  });

  it("generates unique ID", () => {
    const p1 = createPattern("Test");
    const p2 = createPattern("Test");
    expect(p1.id).not.toBe(p2.id);
  });

  it("sets created_at timestamp", () => {
    const before = new Date();
    const pattern = createPattern("Test");
    const after = new Date();
    const createdAt = new Date(pattern.created_at);
    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("sets updated_at equal to created_at", () => {
    const pattern = createPattern("Test");
    expect(pattern.updated_at).toBe(pattern.created_at);
  });

  it("initializes example_beads to empty array", () => {
    const pattern = createPattern("Test");
    expect(pattern.example_beads).toEqual([]);
  });
});

// ============================================================================
// formatAntiPatternsForPrompt Tests
// ============================================================================

describe("formatAntiPatternsForPrompt", () => {
  it("formats anti-patterns with header", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "anti-1",
        content: "AVOID: Split by file type",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 0,
        failure_count: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toContain("## Anti-Patterns to Avoid");
    expect(formatted).toContain("AVOID: Split by file type");
  });

  it("filters out non-anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Good pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 10,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
      {
        id: "anti-1",
        content: "AVOID: Bad pattern",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 0,
        failure_count: 10,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toContain("AVOID: Bad pattern");
    expect(formatted).not.toContain("Good pattern");
  });

  it("returns empty string when no anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Good pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 10,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toBe("");
  });

  it("returns empty string for empty array", () => {
    const formatted = formatAntiPatternsForPrompt([]);
    expect(formatted).toBe("");
  });

  it("formats multiple anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "anti-1",
        content: "AVOID: Pattern 1",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 0,
        failure_count: 5,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
      {
        id: "anti-2",
        content: "AVOID: Pattern 2",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 1,
        failure_count: 9,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatAntiPatternsForPrompt(patterns);
    expect(formatted).toContain("AVOID: Pattern 1");
    expect(formatted).toContain("AVOID: Pattern 2");
  });
});

// ============================================================================
// formatSuccessfulPatternsForPrompt Tests
// ============================================================================

describe("formatSuccessfulPatternsForPrompt", () => {
  it("filters patterns below minSuccessRate", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Good pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2, // 80% success
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
      {
        id: "pattern-2",
        content: "Bad pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 5,
        failure_count: 5, // 50% success
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.7);
    expect(formatted).toContain("Good pattern");
    expect(formatted).not.toContain("Bad pattern");
  });

  it("includes success rate percentage in output", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Test pattern",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2, // 80%
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toContain("80% success rate");
  });

  it("filters out anti-patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "anti-1",
        content: "AVOID: Bad",
        kind: "anti_pattern",
        is_negative: true,
        success_count: 10,
        failure_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toBe("");
  });

  it("filters out patterns with < 2 total observations", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Not enough data",
        kind: "pattern",
        is_negative: false,
        success_count: 1,
        failure_count: 0, // Only 1 observation
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.7);
    expect(formatted).toBe("");
  });

  it("returns empty string when no qualifying patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Low success",
        kind: "pattern",
        is_negative: false,
        success_count: 1,
        failure_count: 9, // 10% success
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.7);
    expect(formatted).toBe("");
  });

  it("returns empty string for empty array", () => {
    const formatted = formatSuccessfulPatternsForPrompt([]);
    expect(formatted).toBe("");
  });

  it("uses default minSuccessRate of 0.7", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "69% success",
        kind: "pattern",
        is_negative: false,
        success_count: 69,
        failure_count: 31, // Just below 70%
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toBe(""); // Should be filtered out
  });

  it("respects custom minSuccessRate", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "60% success",
        kind: "pattern",
        is_negative: false,
        success_count: 6,
        failure_count: 4,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns, 0.5);
    expect(formatted).toContain("60% success");
  });

  it("formats multiple successful patterns", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Pattern A",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
      {
        id: "pattern-2",
        content: "Pattern B",
        kind: "pattern",
        is_negative: false,
        success_count: 7,
        failure_count: 3,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toContain("Pattern A");
    expect(formatted).toContain("Pattern B");
  });

  it("includes header when patterns exist", () => {
    const patterns: DecompositionPattern[] = [
      {
        id: "pattern-1",
        content: "Test",
        kind: "pattern",
        is_negative: false,
        success_count: 8,
        failure_count: 2,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tags: [],
        example_beads: [],
      },
    ];
    const formatted = formatSuccessfulPatternsForPrompt(patterns);
    expect(formatted).toContain("## Successful Patterns");
  });
});

// InMemoryPatternStorage tests removed - class no longer exists (LanceDB is mandatory)
