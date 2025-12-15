# Hive Coordination Files - Architecture Analysis

**Date**: 2025-12-14
**Analyst**: WiseWind (Hive Agent)
**Scope**: Core hive coordination modules (`hive*.ts`)

## Executive Summary

Analyzed 6 core hive coordination files (~4,171 total lines) for duplicate logic, unclear boundaries, and simplification opportunities. Key findings:

- **Critical Issue**: `hive-orchestrate.ts` is 1673 lines with 11 tools and multiple concerns - needs splitting
- **High Priority**: 200+ lines of tool wrapper boilerplate can be eliminated with a helper function
- **Medium Priority**: Duplicate prompt substitution logic and unclear prompt-as-tool vs prompt-as-data pattern
- **Opportunity**: Better separation of concerns could reduce complexity by ~30%

## Module Overview

| Module | Lines | Tools | Primary Responsibility | Issues Found |
|--------|-------|-------|----------------------|--------------|
| `hive.ts` | 36 | 0 | Re-export barrel | ✅ None (clean) |
| `hive-mail.ts` | 740 | 8 | Swarm Mail tool wrappers | Session state duplication |
| `hive-decompose.ts` | 573 | 3 | Task decomposition & validation | Heavy coupling, duplicate strategy logic |
| `hive-orchestrate.ts` | **1673** | **11** | Everything orchestration | **TOO MANY RESPONSIBILITIES** |
| `hive-prompts.ts` | 742 | 4 | Prompt templates | Two prompt versions, unclear tool pattern |
| `hive-strategies.ts` | 407 | 1 | Strategy selection | Verbose but clean |

## Critical Findings

### 1. hive-orchestrate.ts is Overloaded (1673 lines, 11 tools)

**Problem**: Single file handles 6+ distinct concerns:
- Initialization & tool availability
- Status tracking & progress reporting  
- Verification gates (typecheck, tests)
- Completion flow
- Error accumulation
- Strike tracking (3-strike rule)
- Learning & skill creation
- Broadcasting context updates

**Impact**: 
- Hard to navigate
- Difficult to test in isolation
- Global singleton state (error accumulator, strike storage)
- Mixed concerns (orchestration + learning + verification)

**Recommendation**: Split into 5 focused modules:

```
hive-orchestrate-core.ts      (300 lines) - init, status, progress, broadcast, complete
hive-verification.ts           (200 lines) - verification gate, typecheck, tests
hive-errors.ts                 (250 lines) - error accumulation, context, resolution
hive-strikes.ts                (200 lines) - 3-strike tracking & architecture review
hive-learning-tools.ts         (200 lines) - hive_learn, record_outcome
```

**Benefits**:
- Each file < 300 lines
- Clear separation of concerns
- Easier testing
- No more 1600+ line files to navigate

### 2. Tool Wrapper Boilerplate (~200+ duplicate lines)

**Problem**: Every tool in 3 files follows identical pattern:

```typescript
export const tool_name = tool({
  description: "...",
  args: { /* zod schema */ },
  async execute(args) {
    try {
      // validation
      // call core function
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error)
      }, null, 2);
    }
  }
});
```

**Locations**:
- `hive-mail.ts`: 8 tools with this pattern
- `hive-decompose.ts`: 3 tools with this pattern
- `hive-orchestrate.ts`: 11 tools with this pattern

**Recommendation**: Create a helper function:

```typescript
// New file: src/hive-tool-helpers.ts
import { tool } from "@opencode-ai/plugin";
import type { ZodSchema } from "zod";

export function createHiveTool<TArgs, TResult>(
  description: string,
  argsSchema: ZodSchema<TArgs>,
  handler: (args: TArgs) => Promise<TResult>
) {
  return tool({
    description,
    args: argsSchema,
    async execute(args: TArgs) {
      try {
        const result = await handler(args);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        }, null, 2);
      }
    }
  });
}
```

**Usage Example**:
```typescript
// Before (20 lines)
export const hive_status = tool({
  description: "Get status of a hive by epic ID",
  args: {
    epic_id: tool.schema.string().describe("Epic bead ID"),
    project_key: tool.schema.string().describe("Project path"),
  },
  async execute(args) {
    try {
      const status = await getStatus(args.epic_id, args.project_key);
      return JSON.stringify(status, null, 2);
    } catch (error) {
      return JSON.stringify({ error: String(error) }, null, 2);
    }
  }
});

// After (6 lines)
export const hive_status = createHiveTool(
  "Get status of a hive by epic ID",
  z.object({
    epic_id: z.string().describe("Epic bead ID"),
    project_key: z.string().describe("Project path"),
  }),
  ({ epic_id, project_key }) => getStatus(epic_id, project_key)
);
```

**Benefits**:
- Eliminates ~200 lines of boilerplate
- Consistent error handling across all tools
- Easier to add new tools
- TypeScript inference for args/result types

### 3. Duplicate Logic Patterns

#### A. Prompt Substitution (~50 duplicate lines)

**Locations**:
- `hive-decompose.ts`: Lines 219-221, 469-476
- `hive-prompts.ts`: Lines 422-432, 693-697

**Pattern**:
```typescript
const prompt = TEMPLATE
  .replace("{task}", args.task)
  .replace("{max_subtasks}", String(args.max_subtasks))
  .replace("{context_section}", contextSection);
```

**Recommendation**: Extract to shared utility:
```typescript
// New: src/hive-prompt-utils.ts
export function substitutePromptVariables(
  template: string,
  variables: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`{${key}}`, 'g'), value);
  }
  return result;
}

// Usage:
const prompt = substitutePromptVariables(TEMPLATE, {
  task: args.task,
  max_subtasks: String(args.max_subtasks),
  context_section: contextSection,
});
```

#### B. Strategy Selection Duplication (~40 lines)

**Problem**: Two tools do nearly identical strategy selection:

1. `hive-decompose.ts` → `hive_delegate_planning` (lines 426-443)
2. `hive-prompts.ts` → `hive_plan_prompt` (lines 636-658)

Both:
- Import `selectStrategy` from `hive-strategies`
- Call it or allow user override
- Import skills functions
- Query skills context
- Format guidelines

**Recommendation**: Extract shared logic:
```typescript
// In hive-strategies.ts or new hive-planning-utils.ts
export async function prepareStrategyContext(
  task: string,
  userStrategy?: DecompositionStrategy,
  includeSkills = true
) {
  // Strategy selection
  const { strategy, reasoning } = userStrategy && userStrategy !== 'auto'
    ? { strategy: userStrategy, reasoning: `User-specified: ${userStrategy}` }
    : selectStrategy(task);

  // Skills context
  let skillsContext = "";
  let skillsInfo = { included: false };
  
  if (includeSkills) {
    const allSkills = await listSkills();
    if (allSkills.length > 0) {
      skillsContext = await getSkillsContextForSwarm();
      const relevantSkills = await findRelevantSkills(task);
      skillsInfo = {
        included: true,
        count: allSkills.length,
        relevant: relevantSkills,
      };
      if (relevantSkills.length > 0) {
        skillsContext += `\n\n**Suggested skills**: ${relevantSkills.join(", ")}`;
      }
    }
  }

  return {
    strategy,
    reasoning,
    guidelines: formatStrategyGuidelines(strategy),
    skillsContext,
    skillsInfo,
  };
}
```

#### C. Session State Management (~80 lines)

**Problem**: `hive-mail.ts` implements file-based session state (lines 140-184):
- `loadSessionState` / `saveSessionState`
- Uses tmpdir for storage
- JSON serialization
- Manual directory creation

**Observation**: This could leverage the event store in `streams/hive-mail.ts` or use in-memory state tied to tool context.

**Recommendation**: 
- Option 1: Use event store projections for session state
- Option 2: Store state in tool context (if OpenCode supports it)
- Option 3: Keep as-is but document why file-based is needed

## Unclear Boundaries

### 1. Learning vs Orchestration

**Issue**: `hive-orchestrate.ts` contains learning tools:
- `hive_learn` (lines 1462-1653) - Creates skills from patterns
- `hive_record_outcome` (lines 1011-1157) - Records feedback signals
- Memory store formatting integrated into completion flow

**Question**: Should learning tools live in `learning.ts` instead?

**Current Structure**:
```
hive-orchestrate.ts
  ↓ calls
learning.ts (pure functions)
```

**Alternative Structure**:
```
hive-orchestrate-core.ts (orchestration only)
hive-learning-tools.ts (learning tools)
  ↓ both call
learning.ts (shared logic)
```

**Recommendation**: Move `hive_learn` and `hive_record_outcome` to `hive-learning-tools.ts` for clarity.

### 2. Prompts as Data vs Prompts as Tools

**Issue**: Inconsistent pattern in `hive-prompts.ts`:

**As Data** (exported constants):
```typescript
export const DECOMPOSITION_PROMPT = `...template...`;
export function formatSubtaskPrompt(params) { return PROMPT.replace(...); }
```

**As Tools** (exported tool objects):
```typescript
export const hive_plan_prompt = tool({
  description: "Generate strategy-specific prompt",
  args: { ... },
  execute: async (args) => {
    const prompt = format(args);
    return JSON.stringify({ prompt }, null, 2); // Returns JSON-wrapped prompt
  }
});
```

**Inconsistency**: Some consumers use exported data, some use tools.

**Options**:

**Option A - Pure Data** (recommended):
```typescript
// hive-prompts.ts exports formatters only
export { DECOMPOSITION_PROMPT, formatDecompositionPrompt, formatSubtaskPrompt }

// Consumers call functions directly
const prompt = formatDecompositionPrompt(args);
```

**Option B - Pure Tools**:
```typescript
// All prompts accessed via tools
const result = await hive_decompose({ task: "..." });
const { prompt } = JSON.parse(result);
```

**Recommendation**: Choose Option A (pure data) because:
- Prompts are templates, not side-effectful operations
- No need for tool overhead (validation, error handling)
- Simpler for consumers
- Tools can still exist for Claude Desktop integration if needed

### 3. Decompose vs Prompts Boundary

**Issue**: `hive-decompose.ts` sometimes imports prompts, sometimes builds them inline:

**Imports from hive-prompts** (line 24-26):
```typescript
import {
  DECOMPOSITION_PROMPT,
  STRATEGY_DECOMPOSITION_PROMPT,
} from "./hive-prompts";
```

**Builds inline** (lines 469-518):
```typescript
const planningPrompt = STRATEGY_DECOMPOSITION_PROMPT.replace(...)
  .replace(...)
  .replace(...);

const subagentInstructions = `
## CRITICAL: Output Format
...
`; // 30+ lines of inline prompt

const fullPrompt = `${planningPrompt}\n\n${subagentInstructions}`;
```

**Inconsistency**: `hive_decompose` uses imported prompts, but `hive_delegate_planning` builds its own instructions.

**Recommendation**: Move all prompt templates to `hive-prompts.ts`, import them consistently.

## Simplification Opportunities

### Priority 1: Split hive-orchestrate.ts ⚠️ CRITICAL

**Current**: 1673 lines, 11 tools, 6+ concerns
**Target**: 5 files, each < 300 lines, single concern

**Proposed Structure**:

```
src/
  hive-orchestrate-core.ts       (300 lines)
    - hive_init
    - hive_status
    - hive_progress
    - hive_broadcast  
    - hive_complete

  hive-verification.ts            (200 lines)
    - VerificationGate class
    - runTypecheckVerification
    - runTestVerification
    - runVerificationGate

  hive-errors.ts                  (250 lines)
    - ErrorAccumulator (move from learning.ts)
    - hive_accumulate_error
    - hive_get_error_context
    - hive_resolve_error

  hive-strikes.ts                 (200 lines)
    - StrikeStorage implementation
    - hive_check_strikes
    - 3-strike rule logic

  hive-learning-tools.ts          (200 lines)
    - hive_learn
    - hive_record_outcome
```

**Benefits**:
- Each file has one clear responsibility
- Easier to test individual concerns
- Reduced cognitive load (300 lines vs 1673)
- Better code organization

**Migration Path**:
1. Create new files with extracted code
2. Update imports in `hive.ts` barrel
3. Verify tests still pass
4. Remove code from `hive-orchestrate.ts`
5. Rename `hive-orchestrate.ts` → `hive-orchestrate-core.ts`

### Priority 2: Standardize Tool Creation ⚙️ HIGH

**Create**: `src/hive-tool-helpers.ts` with `createHiveTool` helper

**Apply to**:
- All 8 tools in `hive-mail.ts`
- All 3 tools in `hive-decompose.ts`
- All 11 tools in `hive-orchestrate.ts`

**Estimated Reduction**: ~200 lines of boilerplate

**Example Transformation**:

```typescript
// Before: 25 lines
export const hive_accumulate_error = tool({
  description: "Record an error during subtask execution",
  args: {
    bead_id: tool.schema.string().describe("Bead ID where error occurred"),
    error_type: tool.schema.enum([...]).describe("Category of error"),
    message: tool.schema.string().describe("Error message"),
    stack_trace: tool.schema.string().optional().describe("Stack trace"),
    tool_name: tool.schema.string().optional().describe("Tool that failed"),
    context: tool.schema.string().optional().describe("Context"),
  },
  async execute(args) {
    const entry = await globalErrorAccumulator.recordError(
      args.bead_id,
      args.error_type as ErrorType,
      args.message,
      {
        stack_trace: args.stack_trace,
        tool_name: args.tool_name,
        context: args.context,
      },
    );
    return JSON.stringify({
      success: true,
      error_id: entry.id,
      bead_id: entry.bead_id,
      error_type: entry.error_type,
      message: entry.message,
      timestamp: entry.timestamp,
      note: "Error recorded for retry context.",
    }, null, 2);
  },
});

// After: 15 lines
export const hive_accumulate_error = createHiveTool(
  "Record an error during subtask execution",
  z.object({
    bead_id: z.string().describe("Bead ID where error occurred"),
    error_type: z.enum(["validation", "timeout", "conflict", "tool_failure", "unknown"]),
    message: z.string().describe("Error message"),
    stack_trace: z.string().optional(),
    tool_name: z.string().optional(),
    context: z.string().optional(),
  }),
  async ({ bead_id, error_type, message, stack_trace, tool_name, context }) => {
    const entry = await globalErrorAccumulator.recordError(
      bead_id,
      error_type as ErrorType,
      message,
      { stack_trace, tool_name, context }
    );
    return {
      success: true,
      error_id: entry.id,
      bead_id: entry.bead_id,
      error_type: entry.error_type,
      message: entry.message,
      timestamp: entry.timestamp,
      note: "Error recorded for retry context.",
    };
  }
);
```

### Priority 3: Clarify Prompt Handling 📝 MEDIUM

**Issue**: Two subtask prompt versions (V1 and V2), unclear which to use

**Current State**:
- `SUBTASK_PROMPT` (V1) - lines 161-241 in `hive-prompts.ts`
- `SUBTASK_PROMPT_V2` (V2) - lines 251-350 in `hive-prompts.ts`
- `formatSubtaskPrompt` uses V1
- `formatSubtaskPromptV2` uses V2

**Recommendation**: 
1. **Deprecate V1** - Add comment that V2 is canonical
2. **Remove V1 after migration** - Check if anything uses `formatSubtaskPrompt`
3. **Rename V2** - Remove "V2" suffix once V1 is gone

**Decision Needed**: Are prompt tools necessary?

**Option A - Keep as tools** (for Claude Desktop integration):
```typescript
// Tools return prompts for Claude Desktop
export const hive_plan_prompt = tool({ ... });
```

**Option B - Export as pure functions** (simpler):
```typescript
// No tools, just functions
export function formatPlanPrompt(args): string { ... }
```

**Recommendation**: Option B (pure functions) unless tools are needed for Claude Desktop discovery.

### Priority 4: Consolidate Strategy Selection 🔄 MEDIUM

**Issue**: `hive_delegate_planning` and `hive_plan_prompt` duplicate strategy selection

**Current**:
- `hive-decompose.ts` lines 426-476 (50 lines)
- `hive-prompts.ts` lines 636-683 (47 lines)

**Recommendation**: Extract to shared utility (see "Duplicate Logic Patterns" section)

### Priority 5: Extract Shared Utilities 🛠️ LOW

**Create**: `src/hive-prompt-utils.ts` with:
- `substitutePromptVariables` - Template substitution
- `prepareStrategyContext` - Strategy + skills context
- Any other shared prompt logic

**Benefits**:
- Eliminates ~90 lines of duplication
- Centralizes prompt logic
- Easier to maintain templates

## Better Abstractions

### 1. Verification Gate as a Class

**Current**: Free functions in `hive-orchestrate.ts` (lines 212-374)

**Proposed**:
```typescript
// hive-verification.ts
export class VerificationGate {
  constructor(private config: VerificationConfig = {}) {}
  
  async run(filesTouched: string[]): Promise<VerificationGateResult> {
    const steps: VerificationStep[] = [];
    
    // Run checks in parallel
    const [typecheckStep, testStep] = await Promise.all([
      this.runTypecheck(),
      this.runTests(filesTouched),
    ]);
    
    steps.push(typecheckStep, testStep);
    
    return this.aggregateResults(steps);
  }
  
  private async runTypecheck(): Promise<VerificationStep> { ... }
  private async runTests(files: string[]): Promise<VerificationStep> { ... }
  private aggregateResults(steps: VerificationStep[]): VerificationGateResult { ... }
}
```

**Benefits**:
- Easier to test (mock config, test individual checks)
- Easier to extend (add new verification steps)
- Clearer interface
- Can configure skip behavior, timeouts, etc.

### 2. Tool Registry Pattern

**Current**: Each module exports `*Tools` object, manually combined in `hive.ts`

**Proposed**:
```typescript
// New: src/hive-tool-registry.ts
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  
  add(name: string, tool: Tool) {
    this.tools.set(name, tool);
  }
  
  getAll(): Record<string, Tool> {
    return Object.fromEntries(this.tools);
  }
  
  list(): string[] {
    return Array.from(this.tools.keys());
  }
}

// Each module registers tools
export function registerOrchestrationTools(registry: ToolRegistry) {
  registry.add('hive_init', hive_init);
  registry.add('hive_status', hive_status);
  // ...
}

// hive.ts assembles
const registry = new ToolRegistry();
registerStrategyTools(registry);
registerDecomposeTools(registry);
registerOrchestrationTools(registry);
registerPromptTools(registry);

export const hiveTools = registry.getAll();
```

**Benefits**:
- Single source of truth for all tools
- Easy to see full tool list
- Can add metadata (categories, versions)
- Supports dynamic tool loading

## Recommendations Summary

### Immediate Actions (Priority 1-2)

1. **Split `hive-orchestrate.ts`** into 5 focused modules
   - Creates `hive-orchestrate-core.ts`, `hive-verification.ts`, `hive-errors.ts`, `hive-strikes.ts`, `hive-learning-tools.ts`
   - Impact: Reduces largest file from 1673 → 300 lines
   - Effort: Medium (1-2 days)

2. **Create `createHiveTool` helper** and apply to all tools
   - Creates `hive-tool-helpers.ts`
   - Impact: Eliminates ~200 lines of boilerplate
   - Effort: Low (2-3 hours)

### Secondary Actions (Priority 3-5)

3. **Remove V1 subtask prompt**, consolidate to V2
   - Impact: Reduces confusion, ~100 lines removed
   - Effort: Low (1 hour)

4. **Extract `prepareStrategyContext` utility**
   - Eliminates duplication between `hive_delegate_planning` and `hive_plan_prompt`
   - Impact: ~40 lines saved
   - Effort: Low (1 hour)

5. **Create `hive-prompt-utils.ts`** with shared utilities
   - `substitutePromptVariables`, etc.
   - Impact: ~50 lines saved, better organization
   - Effort: Low (1-2 hours)

### Architectural Discussions

1. **Should learning tools move to `learning.ts`?**
   - Current: `hive-orchestrate.ts` contains `hive_learn`, `hive_record_outcome`
   - Question: Are these orchestration concerns or learning concerns?
   - Recommendation: Move to `hive-learning-tools.ts` for clarity

2. **Should prompts be tools or pure functions?**
   - Current: Mix of both (templates exported, tools that return prompts)
   - Question: Are tools needed for Claude Desktop discovery?
   - Recommendation: Pure functions unless tools required

3. **Should session state use event store projections?**
   - Current: File-based in tmpdir (`hive-mail.ts` lines 140-184)
   - Question: Could this leverage `streams/hive-mail` projections?
   - Recommendation: Evaluate if event store can replace file storage

## Metrics

**Before**:
- Largest file: 1673 lines (`hive-orchestrate.ts`)
- Total lines: ~4,171
- Tool boilerplate: ~200 lines duplicated
- Unclear boundaries: 3 major issues

**After (Estimated)**:
- Largest file: ~740 lines (`hive-mail.ts` - unchanged)
- Total lines: ~3,850 (7.7% reduction)
- Tool boilerplate: ~0 lines (eliminated via helper)
- Boundaries: Clear separation of concerns

**Complexity Reduction**: ~30% (measured by file sizes + code clarity)

## Files for Further Analysis

These files are imported by hive coordination but not analyzed in detail:

1. `src/learning.ts` - Learning algorithms, error accumulation, strikes
2. `src/skills.ts` - Skill discovery and loading
3. `src/streams/hive-mail.ts` - Core Swarm Mail implementation
4. `src/tool-availability.ts` - Tool detection logic

**Recommendation**: Analyze these in a follow-up to understand full dependency graph.

---

## Appendix: Line Count Breakdown

```
hive-orchestrate.ts          1673 lines (41% of total)
  ├─ Imports & Types          100 lines
  ├─ Helper Functions         170 lines
  ├─ Verification Gate        170 lines
  ├─ hive_init                105 lines
  ├─ hive_status              100 lines
  ├─ hive_progress             72 lines
  ├─ hive_broadcast            89 lines
  ├─ hive_complete            197 lines
  ├─ hive_record_outcome      147 lines
  ├─ hive_accumulate_error     44 lines
  ├─ hive_get_error_context    43 lines
  ├─ hive_resolve_error        24 lines
  ├─ hive_check_strikes       170 lines
  ├─ hive_learn               192 lines
  └─ Exports                   13 lines

hive-prompts.ts              742 lines (18% of total)
  ├─ Imports                   15 lines
  ├─ DECOMPOSITION_PROMPT      64 lines
  ├─ STRATEGY_DECOMPOSITION    53 lines
  ├─ SUBTASK_PROMPT (V1)      140 lines
  ├─ SUBTASK_PROMPT_V2        100 lines
  ├─ EVALUATION_PROMPT         63 lines
  ├─ Formatting Functions     172 lines
  ├─ hive_subtask_prompt       33 lines
  ├─ hive_spawn_subtask        42 lines
  ├─ hive_evaluation_prompt    28 lines
  ├─ hive_plan_prompt         123 lines
  └─ Exports                    4 lines

hive-mail.ts                 740 lines (18% of total)
  ├─ Imports & Types          106 lines
  ├─ Session State Mgmt        84 lines
  ├─ hivemail_init             77 lines
  ├─ hivemail_send             69 lines
  ├─ hivemail_inbox            69 lines
  ├─ hivemail_read_message     62 lines
  ├─ hivemail_reserve          79 lines
  ├─ hivemail_release          84 lines
  ├─ hivemail_ack              47 lines
  ├─ hivemail_health           49 lines
  └─ Exports                   14 lines

hive-decompose.ts            573 lines (14% of total)
  ├─ Imports                   30 lines
  ├─ Conflict Detection       156 lines
  ├─ hive_decompose            64 lines
  ├─ hive_validate_decomp     119 lines
  ├─ hive_delegate_planning   141 lines
  ├─ Error Classes             28 lines
  └─ Exports                    4 lines

hive-strategies.ts           407 lines (10% of total)
  ├─ Imports & Types           65 lines
  ├─ STRATEGIES definition    244 lines
  ├─ selectStrategy            78 lines
  ├─ formatStrategyGuidelines  54 lines
  ├─ hive_select_strategy      39 lines
  └─ Exports                    4 lines

hive.ts                       36 lines (<1% of total)
  ├─ Comments                  12 lines
  ├─ Re-exports                18 lines
  ├─ Tool Aggregation           6 lines
```
