# Schema Module Simplification Analysis

**Date:** 2025-12-14  
**Analyst:** BrightMoon  
**Bead:** opencode-swarm-plugin-kqf.1  

## Executive Summary

The `src/schemas/` module is well-structured with clear separation of concerns across 5 files (889 total lines). Analysis identified **8 specific opportunities** for simplification across 4 categories: redundant patterns, type consolidation, enhanced type safety, and boilerplate reduction.

**Key Findings:**
- 🟢 **Strengths:** Clear naming, consistent Zod usage, good documentation
- 🟡 **Moderate Issues:** Some conceptual overlap between bead.ts and task.ts
- 🔴 **Priority Issues:** Duplicate subtask specifications, inconsistent timestamp handling

---

## 1. Redundant Patterns

### 1.1 Duplicate Subtask Specifications ⚠️ HIGH PRIORITY

**Location:** `bead.ts` vs `task.ts`

**Issue:** Two different schemas define subtask structure:

```typescript
// bead.ts:132-147
export const SubtaskSpecSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(""),
  files: z.array(z.string()).default([]),
  dependencies: z.array(z.number().int().min(0)).default([]),
  estimated_complexity: z.number().int().min(1).max(5).default(3),
});

// task.ts:39-47
export const DecomposedSubtaskSchema = z.object({
  title: z.string().min(1),
  description: z.string(),
  files: z.array(z.string()),
  estimated_effort: EffortLevelSchema, // "trivial" | "small" | "medium" | "large"
  risks: z.array(z.string()).optional().default([]),
});
```

**Analysis:**
- Both represent subtasks but use different complexity measures:
  - `SubtaskSpecSchema`: numeric scale (1-5) + dependencies array
  - `DecomposedSubtaskSchema`: effort enum + risks array
- `SubtaskSpecSchema` is used for epic creation (API-facing)
- `DecomposedSubtaskSchema` is used for task decomposition (internal planning)

**Recommendation:** Create a unified base schema with optional extensions

```typescript
// schemas/subtask.ts (NEW FILE)
export const BaseSubtaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  files: z.array(z.string()).default([]),
});

// For epic creation (external API)
export const EpicSubtaskSchema = BaseSubtaskSchema.extend({
  dependencies: z.array(z.number().int().min(0)).default([]),
  estimated_complexity: z.number().int().min(1).max(5).default(3),
});

// For decomposition planning (internal)
export const DecomposedSubtaskSchema = BaseSubtaskSchema.extend({
  description: z.string(), // Required for planning
  estimated_effort: EffortLevelSchema,
  risks: z.array(z.string()).default([]),
});
```

**Impact:** Reduces ~30 lines, clearer separation of concerns

---

### 1.2 Timestamp Field Inconsistency

**Location:** All schema files

**Issue:** Inconsistent handling of datetime fields:

```typescript
// bead.ts:65-77 - All timestamps required with offset
created_at: z.string().datetime({ offset: true, message: "..." })
updated_at: z.string().datetime({ offset: true, message: "..." }).optional()

// evaluation.ts:66 - Optional timestamp, same validation
timestamp: z.string().datetime({ offset: true }).optional()

// task.ts:119,135 - Required timestamp
started_at: z.string().datetime({ offset: true })
timestamp: z.string().datetime({ offset: true })
```

**Recommendation:** Create reusable timestamp schemas

```typescript
// schemas/common.ts (NEW FILE)
const TIMESTAMP_ERROR = "Must be ISO-8601 datetime with timezone (e.g., 2024-01-15T10:30:00Z)";

export const RequiredTimestampSchema = z.string().datetime({
  offset: true,
  message: TIMESTAMP_ERROR,
});

export const OptionalTimestampSchema = RequiredTimestampSchema.optional();

export const DefaultedTimestampSchema = RequiredTimestampSchema.default(() => 
  new Date().toISOString()
);
```

**Impact:** Eliminates ~15 lines of repetitive datetime definitions, consistent error messages

---

## 2. Consolidation Opportunities

### 2.1 Effort/Complexity Normalization

**Location:** `bead.ts:145` and `task.ts:18-24`

**Issue:** Two different complexity measures:
- Numeric: 1-5 scale (`estimated_complexity`)
- Categorical: "trivial" | "small" | "medium" | "large" (`estimated_effort`)

**Analysis:**
```typescript
// Current mapping (implicit):
1 (trivial)   → "trivial" (< 5 min)
2 (simple)    → "small" (5-30 min)
3 (moderate)  → "medium" (30min-2hr)
4 (complex)   → "large" (2+ hr)
5 (very complex) → "large" (no equivalent)
```

**Recommendation:** Use categorical enum everywhere, add numeric converter

```typescript
// schemas/common.ts
export const ComplexityLevelSchema = z.enum([
  "trivial",    // < 5 min
  "simple",     // 5-30 min
  "moderate",   // 30min-2hr
  "complex",    // 2-4 hr
  "very_complex" // 4+ hr
]);

export const complexityToNumber = (level: ComplexityLevel): number => {
  const map = { trivial: 1, simple: 2, moderate: 3, complex: 4, very_complex: 5 };
  return map[level];
};

export const numberToComplexity = (n: number): ComplexityLevel => {
  if (n <= 1) return "trivial";
  if (n === 2) return "simple";
  if (n === 3) return "moderate";
  if (n === 4) return "complex";
  return "very_complex";
};
```

**Impact:** Single source of truth for complexity, preserves backward compatibility

---

### 2.2 Status Enum Overlap

**Location:** `bead.ts:10-16`, `task.ts:101`

**Issue:** Similar but different status enums:

```typescript
// bead.ts - BeadStatusSchema
"open" | "in_progress" | "blocked" | "closed"

// task.ts - SpawnedAgentSchema.status
"pending" | "running" | "completed" | "failed"
```

**Analysis:**
- These represent different lifecycle stages:
  - Bead status: Issue tracking lifecycle
  - Agent status: Runtime execution state
- Mapping is implicit: `running` ≈ `in_progress`, `completed` ≈ `closed`

**Recommendation:** Keep separate BUT add explicit mapping utilities

```typescript
// schemas/common.ts
export type BeadStatus = "open" | "in_progress" | "blocked" | "closed";
export type AgentStatus = "pending" | "running" | "completed" | "failed";

export const agentStatusToBeadStatus = (agentStatus: AgentStatus): BeadStatus => {
  switch (agentStatus) {
    case "pending": return "open";
    case "running": return "in_progress";
    case "completed": return "closed";
    case "failed": return "closed"; // or "blocked" depending on failure type
  }
};
```

**Impact:** Explicit domain boundary, easier synchronization

---

## 3. Type Safety Improvements

### 3.1 Dependency Reference Validation

**Location:** `bead.ts:132-137`, `task.ts:52-59`

**Issue:** Dependencies use unvalidated array indices

```typescript
// bead.ts
dependencies: z.array(z.number().int().min(0)).default([])

// task.ts
from: z.number().int().min(0),
to: z.number().int().min(0),
```

**Problem:** No validation that indices reference actual subtasks

**Recommendation:** Add runtime validation with refine

```typescript
export const SubtaskDependencySchema = z.object({
  from: z.number().int().min(0),
  to: z.number().int().min(0),
  type: DependencyTypeSchema,
}).refine(
  data => data.from !== data.to,
  { message: "Subtask cannot depend on itself" }
);

export const TaskDecompositionSchema = z.object({
  // ... other fields
  subtasks: z.array(DecomposedSubtaskSchema).min(1),
  dependencies: z.array(SubtaskDependencySchema).default([]),
}).refine(
  data => {
    const maxIndex = data.subtasks.length - 1;
    return data.dependencies.every(dep => 
      dep.from <= maxIndex && dep.to <= maxIndex
    );
  },
  { message: "Dependency references out-of-bounds subtask index" }
);
```

**Impact:** Prevents runtime errors from invalid dependency references

---

### 3.2 ID Format Validation Consistency

**Location:** `bead.ts:54-59`

**Issue:** Single regex for all ID formats makes validation unclear

```typescript
id: z.string().regex(
  /^[a-z0-9]+(-[a-z0-9]+)+(\.[\w-]+)?$/,
  "Invalid bead ID format (expected: project-slug-hash or project-slug-hash.N)"
)
```

**Recommendation:** Separate schemas for different ID types

```typescript
// schemas/common.ts
const PROJECT_SLUG_HASH = /^[a-z0-9]+(-[a-z0-9]+)+$/;
const SUBTASK_SUFFIX = /^[a-z0-9]+(-[a-z0-9]+)+\.[\w-]+$/;

export const BeadIdSchema = z.string().regex(
  PROJECT_SLUG_HASH,
  "Invalid bead ID: expected format 'project-name-abc12'"
);

export const SubtaskIdSchema = z.string().regex(
  SUBTASK_SUFFIX,
  "Invalid subtask ID: expected format 'project-name-abc12.1' or 'project-name-abc12.subtask-name'"
);

export const AnyBeadIdSchema = z.union([BeadIdSchema, SubtaskIdSchema]);
```

**Usage:**
```typescript
// In BeadSchema
id: AnyBeadIdSchema

// In SubtaskSpecSchema (when id_suffix used)
id: SubtaskIdSchema
```

**Impact:** More precise validation errors, clearer documentation

---

### 3.3 Discriminated Union for Evaluation Results

**Location:** `evaluation.ts:61-68`

**Issue:** `retry_suggestion` is nullable but logically coupled to `passed`

```typescript
export const EvaluationSchema = z.object({
  passed: z.boolean(),
  // ...
  retry_suggestion: z.string().nullable(),
});
```

**Recommendation:** Use discriminated union

```typescript
export const EvaluationSchema = z.discriminatedUnion("passed", [
  z.object({
    passed: z.literal(true),
    criteria: z.record(z.string(), CriterionEvaluationSchema),
    overall_feedback: z.string(),
    retry_suggestion: z.null().optional(),
    timestamp: OptionalTimestampSchema,
  }),
  z.object({
    passed: z.literal(false),
    criteria: z.record(z.string(), CriterionEvaluationSchema),
    overall_feedback: z.string(),
    retry_suggestion: z.string(), // Required when failed
    timestamp: OptionalTimestampSchema,
  }),
]);
```

**Impact:** Type-safe guarantee: failing evaluations always have retry suggestions

---

## 4. Boilerplate Reduction

### 4.1 Schema Export Organization

**Location:** `index.ts` (128 lines)

**Issue:** Manual re-export of ~50 schemas and types

**Current Pattern:**
```typescript
export {
  BeadStatusSchema,
  BeadTypeSchema,
  // ... 12 more exports
  type BeadStatus,
  type BeadType,
  // ... 12 more type exports
} from "./bead";
```

**Recommendation:** Use namespace exports where appropriate

```typescript
// For closely related schemas
export * as BeadSchemas from "./bead";
export * as EvaluationSchemas from "./evaluation";
export * as TaskSchemas from "./task";
export * as MandateSchemas from "./mandate";

// Still export commonly used items at top level
export { BeadSchema, BeadStatusSchema, type Bead } from "./bead";
export { EvaluationSchema, type Evaluation } from "./evaluation";
export { TaskDecompositionSchema, type TaskDecomposition } from "./task";
```

**Impact:** Reduces index.ts from 128 to ~40 lines while maintaining DX

---

### 4.2 Args Schema Pattern Extraction

**Location:** All files

**Pattern:** Many `*ArgsSchema` follow same pattern:

```typescript
// bead.ts
export const BeadCreateArgsSchema = z.object({ ... });
export type BeadCreateArgs = z.infer<typeof BeadCreateArgsSchema>;

export const BeadUpdateArgsSchema = z.object({ ... });
export type BeadUpdateArgs = z.infer<typeof BeadUpdateArgsSchema>;

// Repeated in evaluation.ts, mandate.ts, task.ts
```

**Recommendation:** Use schema builder helper (low priority)

```typescript
// schemas/utils.ts
export const createArgsSchema = <T extends z.ZodRawShape>(
  name: string,
  shape: T
) => {
  const schema = z.object(shape);
  return {
    schema,
    type: {} as z.infer<typeof schema>,
  };
};

// Usage:
const BeadCreate = createArgsSchema("BeadCreate", {
  title: z.string().min(1, "Title required"),
  type: BeadTypeSchema.default("task"),
  // ...
});

export const BeadCreateArgsSchema = BeadCreate.schema;
export type BeadCreateArgs = typeof BeadCreate.type;
```

**Impact:** Marginal - reduces 2 lines per schema but adds indirection

---

## 5. Documentation Improvements

### 5.1 Missing Cross-References

**Issue:** Related schemas don't reference each other

**Recommendation:** Add JSDoc cross-references

```typescript
/**
 * Subtask specification for epic decomposition
 * 
 * @see {DecomposedSubtaskSchema} for planning/decomposition variant
 * @see {EpicCreateArgsSchema} for usage in epic creation
 */
export const SubtaskSpecSchema = z.object({ ... });

/**
 * Decomposed subtask for task planning
 * 
 * @see {SubtaskSpecSchema} for epic creation variant
 * @see {TaskDecompositionSchema} for full decomposition structure
 */
export const DecomposedSubtaskSchema = z.object({ ... });
```

---

### 5.2 Schema Decision Documentation

**Recommendation:** Add ARCHITECTURE.md to schemas/

```markdown
# Schema Architecture Decisions

## Why Two Subtask Schemas?

**SubtaskSpecSchema** (bead.ts): Used for epic creation API
- Consumer: CLI tool, external agents
- Focus: What needs to be done, dependencies
- Complexity: Numeric (1-5) for simple ordering

**DecomposedSubtaskSchema** (task.ts): Used for internal planning
- Consumer: Hive coordinator, decomposition agent  
- Focus: How to execute, risk assessment
- Complexity: Categorical effort levels with time estimates

## Complexity vs Effort

- **Complexity** (1-5): Intrinsic difficulty, used for prioritization
- **Effort** (trivial/small/medium/large): Time estimate, used for scheduling
```

---

## 6. Priority Recommendations

### 🔴 HIGH PRIORITY (Do First)

1. **Create common.ts with shared primitives** (2.1, 2.2, 3.2)
   - Timestamp schemas
   - ID validation schemas  
   - Complexity/effort enum with converters
   - Status mapping utilities

2. **Add dependency validation** (3.1)
   - Prevents runtime errors
   - Easy win with `.refine()`

### 🟡 MEDIUM PRIORITY (Do Next)

3. **Consolidate subtask schemas** (1.1)
   - Create base schema with variants
   - Update imports in consuming code

4. **Discriminated union for evaluations** (3.3)
   - Better type safety
   - Breaking change - needs careful migration

### 🟢 LOW PRIORITY (Nice to Have)

5. **Namespace exports in index.ts** (4.1)
   - Reduces line count
   - Non-breaking if done carefully

6. **Add cross-references and architecture doc** (5.1, 5.2)
   - Documentation only
   - High value for maintainability

---

## 7. Implementation Roadmap

### Phase 1: Foundation (No Breaking Changes)
- [ ] Create `src/schemas/common.ts` with shared utilities
- [ ] Add `.refine()` validations to existing schemas
- [ ] Add JSDoc cross-references

### Phase 2: Consolidation (Minor Breaking Changes)
- [ ] Create `src/schemas/subtask.ts` with unified base
- [ ] Deprecate old exports with `@deprecated` tags
- [ ] Update consuming code to use new schemas

### Phase 3: Optimization (Quality of Life)
- [ ] Refactor index.ts with namespace exports
- [ ] Add ARCHITECTURE.md documentation
- [ ] Remove deprecated exports (major version bump)

---

## 8. Metrics

### Current State
- **Total Lines:** 889 (excluding tests)
- **Schema Count:** 47 exported schemas
- **Type Count:** 47 exported types
- **Files:** 5 (+ 1 test file)

### After Simplification (Estimated)
- **Total Lines:** ~720 (-169 lines, -19%)
- **Schema Count:** 49 (+2 from utilities, -0 from consolidation)
- **Type Count:** 47 (unchanged)
- **Files:** 7 (+2: common.ts, subtask.ts, +0: ARCHITECTURE.md)

### Code Quality Improvements
- ✅ No runtime dependency validation → ✅ Validated at parse time
- ✅ Implicit complexity mapping → ✅ Explicit converters
- ✅ Scattered timestamp defs → ✅ Single source of truth
- ✅ Manual exports → ✅ Namespace organization

---

## 9. Risk Assessment

### Low Risk
- Adding common.ts (new code, no changes to existing)
- JSDoc improvements (documentation only)
- Adding `.refine()` validations (stricter but backward compatible)

### Medium Risk  
- Consolidating subtask schemas (needs code search for all usages)
- Namespace exports (could break direct imports)

### High Risk
- Discriminated union for evaluations (breaking change to type signature)
- Changing complexity from number to enum (API change)

**Mitigation:** Use deprecation warnings, provide codemods, version bump

---

## 10. Conclusion

The schemas module is fundamentally well-designed but has accumulated some technical debt from rapid iteration. The recommended improvements focus on:

1. **Eliminating redundancy** without losing domain-specific nuance
2. **Improving type safety** through runtime validation
3. **Reducing boilerplate** while maintaining clarity
4. **Better documentation** of architectural decisions

**Estimated Effort:** 4-6 hours for Phase 1, 6-8 hours for Phase 2, 2-3 hours for Phase 3

**Expected Benefit:** 
- ~20% reduction in code size
- Stricter validation catches more errors at parse time  
- Clearer intent for future maintainers
- Easier to extend with new features

**Recommendation:** Proceed with Phase 1 immediately (low risk, high value), evaluate Phase 2 based on feedback, defer Phase 3 until next major version.
