---
name: learning-systems
description: Implicit feedback scoring, confidence decay, and anti-pattern detection. Use when understanding how the swarm plugin learns from outcomes, implementing learning loops, or debugging why patterns are being promoted or deprecated. Unique to opencode-swarm-plugin.
---

# Learning Systems

The swarm plugin learns from task outcomes to improve decomposition quality over time. Three interconnected systems track pattern effectiveness: implicit feedback scoring, confidence decay, and pattern maturity progression.

## Implicit Feedback Scoring

Convert task outcomes into learning signals without explicit user feedback.

### What Gets Scored

**Duration signals:**

- Fast (<5 min) = helpful (1.0)
- Medium (5-30 min) = neutral (0.6)
- Slow (>30 min) = harmful (0.2)

**Error signals:**

- 0 errors = helpful (1.0)
- 1-2 errors = neutral (0.6)
- 3+ errors = harmful (0.2)

**Retry signals:**

- 0 retries = helpful (1.0)
- 1 retry = neutral (0.7)
- 2+ retries = harmful (0.3)

**Success signal:**

- Success = 1.0 (40% weight)
- Failure = 0.0

### Weighted Score Calculation

```typescript
rawScore = success * 0.4 + duration * 0.2 + errors * 0.2 + retries * 0.2;
```

**Thresholds:**

- rawScore >= 0.7 → helpful
- rawScore <= 0.4 → harmful
- 0.4 < rawScore < 0.7 → neutral

### Recording Outcomes

Call `hive_record_outcome` after subtask completion:

```typescript
hive_record_outcome({
  bead_id: "bd-123.1",
  duration_ms: 180000, // 3 minutes
  error_count: 0,
  retry_count: 0,
  success: true,
  files_touched: ["src/auth.ts"],
  strategy: "file-based",
});
```

**Fields tracked:**

- `bead_id` - subtask identifier
- `duration_ms` - time from start to completion
- `error_count` - errors encountered (from ErrorAccumulator)
- `retry_count` - number of retry attempts
- `success` - whether subtask completed successfully
- `files_touched` - modified file paths
- `strategy` - decomposition strategy used (optional)
- `failure_mode` - classification if success=false (optional)
- `failure_details` - error context (optional)

## Confidence Decay

Evaluation criteria weights fade unless revalidated. Prevents stale patterns from dominating future decompositions.

### Half-Life Formula

```
decayed_value = raw_value * 0.5^(age_days / 90)
```

**Decay timeline:**

- Day 0: 100% weight
- Day 90: 50% weight
- Day 180: 25% weight
- Day 270: 12.5% weight

### Criterion Weight Calculation

Aggregate decayed feedback events:

```typescript
helpfulSum = sum(helpful_events.map((e) => e.raw_value * decay(e.timestamp)));
harmfulSum = sum(harmful_events.map((e) => e.raw_value * decay(e.timestamp)));
weight = max(0.1, helpfulSum / (helpfulSum + harmfulSum));
```

**Weight floor:** minimum 0.1 prevents complete zeroing

### Revalidation

Recording new feedback resets decay timer for that criterion:

```typescript
{
  criterion: "type_safe",
  weight: 0.85,
  helpful_count: 12,
  harmful_count: 3,
  last_validated: "2024-12-12T00:00:00Z",  // Reset on new feedback
  half_life_days: 90,
}
```

### When Criteria Get Deprecated

```typescript
total = helpful_count + harmful_count;
harmfulRatio = harmful_count / total;

if (total >= 3 && harmfulRatio > 0.3) {
  // Deprecate criterion - reduce impact to 0
}
```

## Pattern Maturity States

Patterns progress through lifecycle based on feedback accumulation:

**candidate** → **established** → **proven** (or **deprecated**)

### State Transitions

**candidate (initial state):**

- Total feedback < 3 events
- Not enough data to judge
- Multiplier: 0.5x

**established:**

- Total feedback >= 3 events
- Has track record but not proven
- Multiplier: 1.0x

**proven:**

- Decayed helpful >= 5 AND
- Harmful ratio < 15%
- Multiplier: 1.5x

**deprecated:**

- Harmful ratio > 30% AND
- Total feedback >= 3 events
- Multiplier: 0x (excluded)

### Decay Applied to State Calculation

State determination uses decayed counts, not raw counts:

```typescript
const { decayedHelpful, decayedHarmful } =
  calculateDecayedCounts(feedbackEvents);
const total = decayedHelpful + decayedHarmful;
const harmfulRatio = decayedHarmful / total;

// State logic applies to decayed values
```

Old feedback matters less. Pattern must maintain recent positive signal to stay proven.

### Manual State Changes

**Promote to proven:**

```typescript
promotePattern(maturity); // External validation confirms effectiveness
```

**Deprecate:**

```typescript
deprecatePattern(maturity, "Causes file conflicts in 80% of cases");
```

Cannot promote deprecated patterns. Must reset.

### Multipliers in Decomposition

Apply maturity multiplier to pattern scores:

```typescript
const multipliers = {
  candidate: 0.5,
  established: 1.0,
  proven: 1.5,
  deprecated: 0,
};

pattern_score = base_score * multipliers[maturity.state];
```

Proven patterns get 50% boost, deprecated patterns excluded entirely.

## Anti-Pattern Inversion

Failed patterns auto-convert to anti-patterns at >60% failure rate.

### Inversion Threshold

```typescript
const total = pattern.success_count + pattern.failure_count;

if (total >= 3 && pattern.failure_count / total >= 0.6) {
  invertToAntiPattern(pattern, reason);
}
```

**Minimum observations:** 3 total (prevents hasty inversion)
**Failure ratio:** 60% (3+ failures in 5 attempts)

### Inversion Process

**Original pattern:**

```typescript
{
  id: "pattern-123",
  content: "Split by file type",
  kind: "pattern",
  is_negative: false,
  success_count: 2,
  failure_count: 5,
}
```

**Inverted anti-pattern:**

```typescript
{
  id: "anti-pattern-123",
  content: "AVOID: Split by file type. Failed 5/7 times (71% failure rate)",
  kind: "anti_pattern",
  is_negative: true,
  success_count: 2,
  failure_count: 5,
  reason: "Failed 5/7 times (71% failure rate)",
}
```

### Recording Observations

Track pattern outcomes to accumulate success/failure counts:

```typescript
recordPatternObservation(
  pattern,
  success: true,  // or false
  beadId: "bd-123.1",
)

// Returns:
{
  pattern: updatedPattern,
  inversion?: {
    original: pattern,
    inverted: antiPattern,
    reason: "Failed 5/7 times (71% failure rate)",
  }
}
```

### Pattern Extraction

Auto-detect strategies from decomposition descriptions:

```typescript
extractPatternsFromDescription(
  "We'll split by file type, one file per subtask",
);

// Returns: ["Split by file type", "One file per subtask"]
```

**Detected strategies:**

- Split by file type
- Split by component
- Split by layer (UI/logic/data)
- Split by feature
- One file per subtask
- Handle shared types first
- Separate API routes
- Tests alongside implementation
- Tests in separate subtask
- Maximize parallelization
- Sequential execution order
- Respect dependency chain

### Using Anti-Patterns in Prompts

Format for decomposition prompt inclusion:

```typescript
formatAntiPatternsForPrompt(patterns);
```

**Output:**

```markdown
## Anti-Patterns to Avoid

Based on past failures, avoid these decomposition strategies:

- AVOID: Split by file type. Failed 12/15 times (80% failure rate)
- AVOID: One file per subtask. Failed 8/10 times (80% failure rate)
```

## Error Accumulator

Track errors during subtask execution for retry prompts and outcome scoring.

### Error Types

```typescript
type ErrorType =
  | "validation" // Schema/type errors
  | "timeout" // Task exceeded time limit
  | "conflict" // File reservation conflicts
  | "tool_failure" // Tool invocation failed
  | "unknown"; // Unclassified
```

### Recording Errors

```typescript
errorAccumulator.recordError(
  beadId: "bd-123.1",
  errorType: "validation",
  message: "Type error in src/auth.ts",
  options: {
    stack_trace: "...",
    tool_name: "typecheck",
    context: "After adding OAuth types",
  }
)
```

### Generating Error Context

Format accumulated errors for retry prompts:

```typescript
const context = await errorAccumulator.getErrorContext(
  beadId: "bd-123.1",
  includeResolved: false,
)
```

**Output:**

```markdown
## Previous Errors

The following errors were encountered during execution:

### validation (2 errors)

- **Type error in src/auth.ts**
  - Context: After adding OAuth types
  - Tool: typecheck
  - Time: 12/12/2024, 10:30 AM

- **Missing import in src/session.ts**
  - Tool: typecheck
  - Time: 12/12/2024, 10:35 AM

**Action Required**: Address these errors before proceeding. Consider:

- What caused each error?
- How can you prevent similar errors?
- Are there patterns across error types?
```

### Resolving Errors

Mark errors resolved after fixing:

```typescript
await errorAccumulator.resolveError(errorId);
```

Resolved errors excluded from retry context by default.

### Error Statistics

Get error counts for outcome tracking:

```typescript
const stats = await errorAccumulator.getErrorStats("bd-123.1")

// Returns:
{
  total: 5,
  unresolved: 2,
  by_type: {
    validation: 3,
    timeout: 1,
    tool_failure: 1,
  }
}
```

Use `total` for `error_count` in outcome signals.

## Using the Learning System

### Integration Points (All Automatic)

**1. During decomposition (hive_plan_prompt):**

- **Automatically queries semantic memory** for similar tasks via LanceDB
- Queries CASS for similar tasks (if enabled)
- Loads pattern maturity records
- Includes proven patterns in prompt
- Excludes deprecated patterns and anti-patterns
- Returns `memory_queried: true, patterns_found: N` in response

**2. During execution:**

- ErrorAccumulator tracks errors
- Record retry attempts
- Track duration from start to completion

**3. After completion (hive_complete):**

- **Automatically stores successful patterns** to semantic memory
- Extracts patterns from decomposition description
- Generates embeddings and stores to LanceDB
- Records outcome signals
- Scores implicit feedback
- Updates pattern observations
- Checks for anti-pattern inversions (3-strike rule)
- Updates maturity states
- Returns `memory_stored: true` in response

### Full Workflow Example

```typescript
// 1. Decomposition phase (semantic memory queries automatically)
const result = hive_plan_prompt({
  task: "Add OAuth",
  context: "Implement OAuth 2.0 with Google provider",
  query_cass: true,
});

// Tool automatically:
// - Queries semantic memory for similar "OAuth" and "authentication" tasks
// - Loads proven patterns from LanceDB
// - Excludes anti-patterns
// - Returns: { ...prompt, memory_queried: true, patterns_found: 5 }

// 2. Execution phase
const errorAccumulator = new ErrorAccumulator();
const startTime = Date.now();

try {
  // Work happens...
  await implement_subtask();
} catch (error) {
  await errorAccumulator.recordError(
    bead_id,
    classifyError(error),
    error.message,
  );
  retryCount++;
}

// 3. Completion phase (semantic memory stores automatically)
const duration = Date.now() - startTime;
const errorStats = await errorAccumulator.getErrorStats(bead_id);

const completeResult = hive_complete({
  project_key: "$PWD",
  agent_name: "worker-1",
  bead_id,
  summary: "OAuth implemented with Google provider",
  files_touched: modifiedFiles,
});

// Tool automatically:
// - Extracts patterns from summary
// - Generates embeddings with Transformers.js
// - Stores patterns to LanceDB at .hive/vectors/patterns.lance
// - Records outcome for maturity tracking
// - Returns: { ...result, memory_stored: true }

// 4. Learning updates (automatic but can also be done manually)
const scored = scoreImplicitFeedback({
  bead_id,
  duration_ms: duration,
  error_count: errorStats.total,
  retry_count: retryCount,
  success: true,
  timestamp: new Date().toISOString(),
  strategy: "file-based",
});

// Pattern observations tracked automatically
// If failure_count reaches 3, auto-converts to anti-pattern
// Anti-patterns stored with is_negative: true flag
```

### Configuration Tuning

Adjust thresholds based on project characteristics:

```typescript
const learningConfig = {
  halfLifeDays: 90, // Decay speed
  minFeedbackForAdjustment: 3, // Min observations for weight adjustment
  maxHarmfulRatio: 0.3, // Max harmful % before deprecating criterion
  fastCompletionThresholdMs: 300000, // 5 min = fast
  slowCompletionThresholdMs: 1800000, // 30 min = slow
  maxErrorsForHelpful: 2, // Max errors before marking harmful
};

const antiPatternConfig = {
  minObservations: 3, // Min before inversion
  failureRatioThreshold: 0.6, // 60% failure triggers inversion
  antiPatternPrefix: "AVOID: ",
};

const maturityConfig = {
  minFeedback: 3, // Min for leaving candidate state
  minHelpful: 5, // Decayed helpful threshold for proven
  maxHarmful: 0.15, // Max 15% harmful for proven
  deprecationThreshold: 0.3, // 30% harmful triggers deprecation
  halfLifeDays: 90,
};
```

### Debugging Pattern Issues

**Why is pattern not proven?**

Check decayed counts:

```typescript
const feedback = await getFeedback(patternId);
const { decayedHelpful, decayedHarmful } = calculateDecayedCounts(feedback);

console.log({ decayedHelpful, decayedHarmful });
// Need: decayedHelpful >= 5 AND harmfulRatio < 0.15
```

**Why was pattern inverted?**

Check observation counts:

```typescript
const total = pattern.success_count + pattern.failure_count;
const failureRatio = pattern.failure_count / total;

console.log({ total, failureRatio });
// Inverts if: total >= 3 AND failureRatio >= 0.6
```

**Why is criterion weight low?**

Check feedback events:

```typescript
const events = await getFeedbackByCriterion("type_safe");
const weight = calculateCriterionWeight(events);

console.log(weight);
// Shows: helpful vs harmful counts, last_validated date
```

## Semantic Memory Storage (MANDATORY)

The swarm plugin uses **LanceDB** as its mandatory vector storage backend for semantic pattern memory. This is NOT optional - all pattern learning happens through persistent semantic storage.

### Storage Architecture

**Location:** `.hive/vectors/patterns.lance`

**Embeddings:** Transformers.js with `Xenova/all-mpnet-base-v2` (768 dimensions)

**Dependencies:** All bundled - no external services required

### Active Integration (Not Passive Hints)

Earlier versions used passive hints (`memory_query`, `memory_store` flags). Current implementation executes semantic memory operations automatically:

**During decomposition:**
- Tools automatically query past learnings before generating prompts
- Similar patterns retrieved via vector similarity search
- Results included in decomposition context

**After completion:**
- Successful patterns stored automatically to LanceDB
- No manual `semantic-memory store` commands needed
- Embeddings generated and indexed transparently

**After 3-strike failures:**
- Failed patterns automatically converted to anti-patterns
- Stored with negative flag for exclusion in future decompositions

### Tool Responses Include Memory Status

Tools now return memory operation indicators:

```typescript
{
  // ... normal tool response ...
  memory_queried: true,
  patterns_found: 5,
  memory_stored: true
}
```

Check these fields to verify semantic memory is active.

### Storage Initialization

Storage initializes automatically on first use:

```typescript
// No manual setup needed - this happens automatically
const store = await getSemanticMemoryStore(); // Creates .hive/vectors/ if needed
```

**First run:** May take 5-10 seconds to download embedding model (cached after)

**Subsequent runs:** Instant - model and index already on disk

### Pattern Storage Lifecycle

**1. Pattern Extraction (automatic on hive_complete):**

```typescript
// System extracts patterns from decomposition description
const patterns = extractPatternsFromDescription(
  "We split by file type, one file per subtask"
);
// Returns: ["Split by file type", "One file per subtask"]
```

**2. Semantic Indexing (automatic):**

```typescript
// System generates embeddings and stores to LanceDB
await storePattern({
  content: "Split by file type",
  kind: "pattern",
  is_negative: false,
  metadata: {
    bead_id: "bd-123.1",
    success: true,
    timestamp: "2024-12-15T...",
  },
});
```

**3. Query During Decomposition (automatic):**

```typescript
// When hive_plan_prompt runs, it queries similar patterns
const similar = await queryPatterns(taskDescription, { limit: 5 });
// Returns patterns ranked by cosine similarity
```

**4. Anti-Pattern Creation (automatic on 3rd failure):**

```typescript
// After 3 strikes, pattern inverted and stored as anti-pattern
await storePattern({
  content: "AVOID: Split by file type. Failed 5/7 times (71% failure rate)",
  kind: "anti_pattern",
  is_negative: true,
  metadata: { ...original_metadata, failure_rate: 0.71 },
});
```

### Debugging Semantic Memory

**Check if storage is active:**

```typescript
const health = await store.health();
console.log(health);
// { healthy: true, count: 42, location: ".hive/vectors/patterns.lance" }
```

**Query patterns directly:**

```typescript
const results = await store.query("authentication tasks", { limit: 10 });
console.log(results.map((r) => ({ content: r.content, score: r.score })));
```

**Inspect storage directory:**

```bash
ls -la .hive/vectors/patterns.lance/
# Should see LanceDB data files
```

## Storage Interfaces

### FeedbackStorage

Persist feedback events for criterion weight calculation:

```typescript
interface FeedbackStorage {
  store(event: FeedbackEvent): Promise<void>;
  getByCriterion(criterion: string): Promise<FeedbackEvent[]>;
  getByBead(beadId: string): Promise<FeedbackEvent[]>;
  getAll(): Promise<FeedbackEvent[]>;
}
```

### ErrorStorage

Persist errors for retry prompts:

```typescript
interface ErrorStorage {
  store(entry: ErrorEntry): Promise<void>;
  getByBead(beadId: string): Promise<ErrorEntry[]>;
  getUnresolvedByBead(beadId: string): Promise<ErrorEntry[]>;
  markResolved(id: string): Promise<void>;
  getAll(): Promise<ErrorEntry[]>;
}
```

### PatternStorage (Deprecated - Use SemanticMemoryStore)

The old `PatternStorage` interface has been replaced by `SemanticMemoryStore` which provides vector similarity search via LanceDB.

**Legacy interface (for reference only):**

```typescript
interface PatternStorage {
  store(pattern: DecompositionPattern): Promise<void>;
  get(id: string): Promise<DecompositionPattern | null>;
  getAll(): Promise<DecompositionPattern[]>;
  getAntiPatterns(): Promise<DecompositionPattern[]>;
  getByTag(tag: string): Promise<DecompositionPattern[]>;
  findByContent(content: string): Promise<DecompositionPattern[]>;
}
```

**New interface:**

```typescript
interface SemanticMemoryStore {
  store(pattern: PatternRecord): Promise<void>;
  query(text: string, options?: { limit?: number; threshold?: number }): Promise<PatternRecord[]>;
  health(): Promise<{ healthy: boolean; count: number; location: string }>;
}
```

### MaturityStorage

Persist pattern maturity records:

```typescript
interface MaturityStorage {
  store(maturity: PatternMaturity): Promise<void>;
  get(patternId: string): Promise<PatternMaturity | null>;
  getAll(): Promise<PatternMaturity[]>;
  getByState(state: MaturityState): Promise<PatternMaturity[]>;
  storeFeedback(feedback: MaturityFeedback): Promise<void>;
  getFeedback(patternId: string): Promise<MaturityFeedback[]>;
}
```

**Storage Implementation:** All storage backends use LanceDB for pattern memory. Feedback, error, and maturity records use the project's event stream storage.
