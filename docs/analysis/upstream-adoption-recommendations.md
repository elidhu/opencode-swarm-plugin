# Upstream Feature Adoption Recommendations

**Date**: December 19, 2025  
**Epic**: opencode-swarm-plugin-8zm  
**Bead**: opencode-swarm-plugin-8zm.5  
**Agent**: WildFire  
**Status**: Complete

---

## Executive Summary

Analysis of the 6 upstream gaps identified in `upstream-feature-matrix.md` reveals:

| Finding | Status |
|---------|--------|
| **3-Strike Error System** | ✅ Already implemented (unified `hive_check_strikes` tool) |
| **Research-Based Strategy** | ✅ Already implemented in `hive-strategies.ts` |
| **hive_broadcast** | ❌ Not implemented - recommend P2 |
| **hive_delegate_planning** | ❌ Not implemented - recommend P1 |
| **swarm_learn** | ❌ Not implemented - recommend P3 |
| **CASS Integration** | ❌ Intentionally skipped - not recommended |

**Key Takeaway**: 2 of 6 "gaps" are false positives - we already have the functionality. Only 3 features warrant implementation consideration.

---

## 1. Feature-by-Feature Analysis

### 1.1 3-Strike Error System

| Aspect | Assessment |
|--------|------------|
| **Upstream Tools** | `swarm_accumulate_error`, `swarm_check_strikes`, `swarm_get_error_context`, `swarm_resolve_error` |
| **Our Implementation** | `hive_check_strikes` (consolidated) |
| **Gap Status** | ✅ **FALSE POSITIVE** - Already implemented |

#### Our Implementation Details

Located in `src/hive-strikes.ts`, our `hive_check_strikes` tool provides:

```typescript
// Single tool with 4 actions:
action: "check"       // Check strike count (equivalent to swarm_check_strikes)
action: "add_strike"  // Record failure (equivalent to swarm_accumulate_error)
action: "clear"       // Reset strikes (equivalent to swarm_resolve_error)
action: "get_prompt"  // Get architecture review (equivalent to swarm_get_error_context)
```

**Advantages of our approach**:
- Single tool vs 4 tools = simpler mental model
- Atomic operations prevent race conditions
- Integrated anti-pattern storage and broadcast on 3-strike

**Recommendation**: **No action needed** - Our consolidated tool is architecturally superior.

---

### 1.2 Research-Based Decomposition Strategy

| Aspect | Assessment |
|--------|------------|
| **Upstream** | `research-based` strategy option |
| **Our Implementation** | ✅ Fully implemented in `hive-strategies.ts` |
| **Gap Status** | ✅ **FALSE POSITIVE** - Already implemented |

#### Our Implementation Details

Located in `src/hive-strategies.ts` lines 190-242:

```typescript
"research-based": {
  name: "research-based",
  description: "Parallel search across multiple sources, then synthesize...",
  keywords: [
    "research", "investigate", "explore", "find out", "discover",
    "understand", "learn about", "analyze", "what is", "how does",
    "compare", "evaluate", "study", "look up", "dig into", "figure out",
    "debug options", "documentation", ...
  ],
  guidelines: [
    "Split by information source (PDFs, repos, history, web)",
    "Each agent searches with different query angles",
    "Include a synthesis subtask that depends on all search subtasks",
    ...
  ]
}
```

**Recommendation**: **No action needed** - Already complete.

---

### 1.3 hive_broadcast (Message All Agents)

| Aspect | Assessment |
|--------|------------|
| **Implementation Effort** | 2-4 hours |
| **Value to Users** | Medium |
| **Architecture Compatibility** | Easy |
| **Priority** | **P2** (Nice to have) |

#### Current State

We have `hivemail_send` which accepts `to: string[]` for targeted messaging. Broadcast would add convenience for coordinator announcements.

#### Implementation Approach

```typescript
// New tool in src/hive.ts
export const hive_broadcast = tool({
  description: "Broadcast message to all active agents in an epic",
  args: {
    epic_id: tool.schema.string(),
    subject: tool.schema.string(),
    body: tool.schema.string(),
    importance: tool.schema.enum(["low", "normal", "high", "urgent"]).optional(),
  },
  async execute(args) {
    // 1. Query all agents with in_progress beads under epic_id
    // 2. Send message to each agent via hivemail_send
    // 3. Return delivery status
  }
});
```

#### Effort Breakdown

| Task | Hours |
|------|-------|
| Query active agents from bead metadata | 1h |
| Implement broadcast logic | 1h |
| Add tests | 1h |
| Documentation | 0.5h |
| **Total** | **3.5 hours** |

#### ROI Analysis

| Factor | Score |
|--------|-------|
| Effort | Low (3.5h) |
| Value | Medium (convenience for coordinators) |
| Risk | Low (additive feature) |
| **ROI** | **Positive but not urgent** |

**Recommendation**: Implement in next feature batch, not blocking.

---

### 1.4 hive_delegate_planning (Planner Subagent)

| Aspect | Assessment |
|--------|------------|
| **Implementation Effort** | 4-8 hours |
| **Value to Users** | High |
| **Architecture Compatibility** | Medium |
| **Priority** | **P1** (Should implement) |

#### Use Case

For complex tasks where the coordinator shouldn't block on decomposition:

1. Coordinator calls `hive_delegate_planning(task, constraints)`
2. System spawns a dedicated planner agent
3. Planner runs `hive_decompose` → `hive_validate_decomposition` → creates epic
4. Coordinator continues other work while planning happens

#### Implementation Approach

```typescript
export const hive_delegate_planning = tool({
  description: "Delegate task decomposition to a dedicated planner subagent",
  args: {
    task: tool.schema.string().min(1),
    strategy: tool.schema.enum(["file-based", "feature-based", "risk-based", "research-based", "auto"]).optional(),
    max_subtasks: tool.schema.number().min(2).max(10).optional(),
    notify_on_complete: tool.schema.boolean().optional(),
  },
  async execute(args) {
    // 1. Generate planner agent prompt using hive_subtask_prompt pattern
    // 2. Spawn using Task tool (if available) or queue as special bead
    // 3. Return tracking ID for status checks
  }
});
```

#### Effort Breakdown

| Task | Hours |
|------|-------|
| Define planner agent system prompt | 1h |
| Implement spawn/queue logic | 2h |
| Handle callback/notification on completion | 1.5h |
| Integration with existing hive_* tools | 1h |
| Add tests | 1.5h |
| Documentation | 1h |
| **Total** | **8 hours** |

#### ROI Analysis

| Factor | Score |
|--------|-------|
| Effort | Medium (8h / 1 day) |
| Value | High (enables parallel planning, reduces coordinator blocking) |
| Risk | Medium (new async pattern) |
| **ROI** | **Strong positive** |

**Recommendation**: Implement as P1 - significant value for complex epics.

---

### 1.5 swarm_learn (Learning Extraction)

| Aspect | Assessment |
|--------|------------|
| **Implementation Effort** | 4-6 hours |
| **Value to Users** | Medium |
| **Architecture Compatibility** | Easy |
| **Priority** | **P3** (Future) |

#### Current State

We already have:
- `src/learning.ts` - Pattern storage and retrieval
- `src/outcomes.ts` - Outcome signal recording
- `src/pattern-maturity.ts` - Pattern lifecycle management
- Automatic anti-pattern storage on 3-strike

What's missing is an **explicit tool** for agents to extract/store learnings on demand.

#### Implementation Approach

```typescript
export const hive_learn = tool({
  description: "Extract and store a learning/pattern from completed work",
  args: {
    bead_id: tool.schema.string(),
    pattern_type: tool.schema.enum(["positive", "negative", "anti_pattern"]),
    summary: tool.schema.string(),
    tags: tool.schema.array(tool.schema.string()).optional(),
  },
  async execute(args) {
    // 1. Validate bead is closed/completed
    // 2. Store pattern in learning storage
    // 3. Update pattern maturity if existing pattern
    // 4. Return confirmation
  }
});
```

#### ROI Analysis

| Factor | Score |
|--------|-------|
| Effort | Low-Medium (5h) |
| Value | Medium (most learning is automatic) |
| Risk | Low (additive) |
| **ROI** | **Moderate** |

**Recommendation**: P3 - Implement when addressing learning system improvements.

---

### 1.6 CASS Integration

| Aspect | Assessment |
|--------|------------|
| **Implementation Effort** | 8-16 hours |
| **Value to Users** | Low (for our use case) |
| **Architecture Compatibility** | Hard (requires external service) |
| **Priority** | **Not Recommended** |

#### Decision Rationale

Per `docs/analysis/optional-integrations-decision.md`:

| Factor | CASS | Our LanceDB |
|--------|------|-------------|
| Setup | Requires Ollama + external service | Zero-config embedded |
| Dependencies | External runtime | None |
| Use Case | Cross-project search | Project-local patterns |
| Maintenance | Additional service | Built into plugin |

**Our LanceDB approach is intentionally simpler** and sufficient for single-project hive operations. CASS adds complexity without proportional value for our primary use cases.

**Recommendation**: **Do not implement** - Intentional architectural divergence.

---

## 2. Effort vs Value Matrix

```
                    HIGH VALUE
                        │
    ┌───────────────────┼───────────────────┐
    │                   │                   │
    │   P1: Should      │   P0: Must        │
    │   Implement       │   Implement       │
    │                   │                   │
    │ ★ delegate_       │                   │
    │   planning        │   (none)          │
    │   (8h)            │                   │
    │                   │                   │
LOW ├───────────────────┼───────────────────┤ HIGH
EFFORT                  │                   EFFORT
    │                   │                   │
    │   P2: Nice        │   P3: Defer       │
    │   to Have         │                   │
    │                   │                   │
    │ ★ broadcast       │ ★ hive_learn      │
    │   (3.5h)          │   (5h)            │
    │                   │                   │
    │                   │ ✗ CASS            │
    │                   │   (16h, not rec)  │
    │                   │                   │
    └───────────────────┼───────────────────┘
                        │
                    LOW VALUE
```

---

## 3. Recommended Implementation Order

### Phase 1: Quick Wins (Week 1)
| Priority | Feature | Hours | Rationale |
|----------|---------|-------|-----------|
| P2 | `hive_broadcast` | 3.5h | Low effort, immediate utility |

### Phase 2: Strategic Value (Week 2)
| Priority | Feature | Hours | Rationale |
|----------|---------|-------|-----------|
| P1 | `hive_delegate_planning` | 8h | High value for complex epics |

### Phase 3: Learning Enhancements (Future)
| Priority | Feature | Hours | Rationale |
|----------|---------|-------|-----------|
| P3 | `hive_learn` | 5h | Enhances learning system |

### Not Planned
| Feature | Rationale |
|---------|-----------|
| CASS Integration | Intentional divergence - LanceDB is sufficient |
| 3-Strike Tools | Already have `hive_check_strikes` (consolidated) |
| Research Strategy | Already implemented in `hive-strategies.ts` |

---

## 4. Total Investment Summary

| Category | Hours | Status |
|----------|-------|--------|
| Already Implemented | 0h | ✅ 3-strike, research strategy |
| Recommended Features | 16.5h | P1 + P2 |
| Deferred | 5h | P3 (hive_learn) |
| Not Recommended | 0h | CASS |
| **Total New Work** | **16.5-21.5h** | ~2-3 days |

---

## 5. Conclusion

The gap analysis in `upstream-feature-matrix.md` identified 6 gaps, but:

1. **2 are false positives** - We already have `hive_check_strikes` and `research-based` strategy
2. **1 is intentionally skipped** - CASS integration doesn't fit our architecture
3. **3 are genuine opportunities** - broadcast, delegate_planning, and hive_learn

**Actual implementation backlog**: 3 features, ~16.5-21.5 hours total.

### Recommended Priority Order

1. **P1: `hive_delegate_planning`** (8h) - Enables async planning for complex tasks
2. **P2: `hive_broadcast`** (3.5h) - Convenience for coordinator announcements  
3. **P3: `hive_learn`** (5h) - Explicit learning extraction (defer to learning system overhaul)

---

**Document Complete**  
**Generated**: December 19, 2025  
**Agent**: WildFire  
**Bead**: opencode-swarm-plugin-8zm.5  
**Status**: Ready for Coordinator Review
