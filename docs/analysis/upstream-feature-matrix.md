# Upstream Feature Comparison Matrix

**Date**: December 19, 2025  
**Epic**: opencode-swarm-plugin-8zm  
**Bead**: opencode-swarm-plugin-8zm.3  
**Agent**: GreenStorm  
**Status**: Complete

---

## Executive Summary

This document provides a comprehensive feature-by-feature mapping between **upstream opencode-swarm-plugin v0.30.6** (swarm-tools) and our **hive implementation**.

**Key Findings**:
1. ✅ **Feature Parity Achieved** for core functionality
2. ⚠️ **Naming Divergence**: We use `hive_*`/`hivemail_*`, upstream uses `swarm_*`/`swarmmail_*`
3. ⭐ **We have 7 unique features** upstream lacks
4. ❌ **Gap Identified**: 6 upstream features we don't have (3-strike system, research strategy, broadcast, delegate planning)

**Upstream Version Analyzed**: v0.30.6 (published December 19, 2025)

---

## 1. Tool Naming Convention Differences

### Critical Naming Divergence

| Category | Upstream Prefix | Our Prefix | Impact |
|----------|----------------|------------|--------|
| Work Items | `hive_*` | `beads_*` | Minor - same functionality, different names |
| Messaging | `swarmmail_*` | `hivemail_*` | **Significant** - inverted naming |
| Orchestration | `swarm_*` | `hive_*` | **Significant** - inverted naming |
| Skills | `skills_*` | `skills_*` | ✅ Same |
| Structured | N/A | `structured_*` | Unique to us |
| Specs | N/A | `spec_*` | Unique to us |

### Brand Confusion Risk

**Problem**: Upstream and our fork have inverted naming:
- **Upstream**: Work items = "hive", Orchestration = "swarm", Messaging = "swarmmail"
- **Ours**: Work items = "beads", Orchestration = "hive", Messaging = "hivemail"

This creates confusion if someone reads upstream docs while using our fork.

### Tool Name Mapping Table

| Upstream Tool | Our Equivalent | Status | Notes |
|---------------|----------------|--------|-------|
| `hive_create` | `beads_create` | ✅ Parity | |
| `hive_create_epic` | `beads_create_epic` | ✅ Parity | |
| `hive_query` | `beads_query` | ✅ Parity | |
| `hive_update` | `beads_update` | ✅ Parity | |
| `hive_close` | `beads_close` | ✅ Parity | |
| `hive_start` | `beads_start` | ✅ Parity | |
| `hive_ready` | `beads_ready` | ✅ Parity | |
| `hive_sync` | `beads_sync` | ✅ Parity | |
| `swarmmail_init` | `hivemail_init` | ✅ Parity | |
| `swarmmail_send` | `hivemail_send` | ✅ Parity | |
| `swarmmail_inbox` | `hivemail_inbox` | ✅ Parity | |
| `swarmmail_read_message` | `hivemail_read_message` | ✅ Parity | |
| `swarmmail_reserve` | `hivemail_reserve` | ✅ Parity | |
| `swarmmail_release` | `hivemail_release` | ✅ Parity | |
| `swarm_init` | `hive_init` | ✅ Parity | |
| `swarm_select_strategy` | `hive_select_strategy` | ✅ Parity | |
| `swarm_decompose` | `hive_decompose` | ✅ Parity | |
| `swarm_plan_prompt` | `hive_plan_prompt` | ✅ Parity | |
| `swarm_validate_decomposition` | `hive_validate_decomposition` | ✅ Parity | |
| `swarm_status` | `hive_status` | ✅ Parity | |
| `swarm_subtask_prompt` | `hive_subtask_prompt` | ✅ Parity | |
| `swarm_spawn_subtask` | `hive_spawn_subtask` | ✅ Parity | |
| `swarm_progress` | `hive_progress` | ✅ Parity | |
| `swarm_complete` | `hive_complete` | ✅ Parity | |
| `swarm_evaluation_prompt` | `hive_evaluation_prompt` | ✅ Parity | |
| `swarm_record_outcome` | `hive_record_outcome` | ✅ Parity | |
| `swarm_checkpoint` | N/A (separate file) | ⚠️ Different | We have checkpoint.ts |
| `swarm_recover` | N/A (separate file) | ⚠️ Different | We have checkpoint.ts |
| `swarm_delegate_planning` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| `swarm_broadcast` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| `swarm_accumulate_error` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| `swarm_check_strikes` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| `swarm_get_error_context` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| `swarm_resolve_error` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| `swarm_learn` | ❌ MISSING | ❌ Gap | Learning extraction |
| `skills_list` | `skills_list` | ✅ Parity | |
| `skills_use` | `skills_use` | ✅ Parity | |
| `skills_read` | `skills_read` | ✅ Parity | |
| `skills_create` | `skills_create` | ✅ Parity | |
| N/A | `skills_update` | ⭐ Unique | We have this |
| N/A | `skills_delete` | ⭐ Unique | We have this |
| N/A | `skills_init` | ⭐ Unique | We have this |
| N/A | `skills_add_script` | ⭐ Unique | We have this |
| N/A | `skills_execute` | ⭐ Unique | We have this |

---

## 2. Feature-by-Feature Comparison

### Legend
- ✅ **Parity** - Feature implemented equivalently
- ⭐ **Enhanced** - Our implementation exceeds upstream
- ❌ **Gap** - Upstream has this, we don't
- 🆕 **Unique** - We have this, upstream doesn't
- ⚠️ **Different** - Implemented differently

---

### 2.1 Work Item Tracking

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Create work item | `hive_create` | `beads_create` | ✅ Parity | Same params |
| Atomic epic creation | `hive_create_epic` | `beads_create_epic` | ✅ Parity | Same params |
| Query with filters | `hive_query` | `beads_query` | ✅ Parity | Same params |
| Update status/description | `hive_update` | `beads_update` | ✅ Parity | Same params |
| Close with reason | `hive_close` | `beads_close` | ✅ Parity | Same params |
| Mark in-progress | `hive_start` | `beads_start` | ✅ Parity | Same params |
| Get next ready | `hive_ready` | `beads_ready` | ✅ Parity | Same params |
| Git sync | `hive_sync` | `beads_sync` | ✅ Parity | Same params |
| Link to thread | `beads_link_thread` (legacy) | `beads_link_thread` | ✅ Parity | Same |

**Tool Count**: Upstream 8, Ours 9 (we have beads_link_thread as first-class)

---

### 2.2 Agent Messaging

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Initialize session | `swarmmail_init` | `hivemail_init` | ✅ Parity | Same params |
| Send message | `swarmmail_send` | `hivemail_send` | ✅ Parity | Same params |
| Fetch inbox | `swarmmail_inbox` | `hivemail_inbox` | ✅ Parity | Max 5, headers only |
| Read message body | `swarmmail_read_message` | `hivemail_read_message` | ✅ Parity | Same params |
| Reserve files | `swarmmail_reserve` | `hivemail_reserve` | ✅ Parity | Same params |
| Release files | `swarmmail_release` | `hivemail_release` | ✅ Parity | Same params |
| Acknowledge message | N/A | `hivemail_ack` | 🆕 Unique | We have this |
| Health check | N/A | `hivemail_health` | 🆕 Unique | We have this |

**Tool Count**: Upstream 6, Ours 8 (we have +2 unique)

---

### 2.3 Task Orchestration

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Initialize session | `swarm_init` | `hive_init` | ✅ Parity | |
| Select strategy | `swarm_select_strategy` | `hive_select_strategy` | ✅ Parity | |
| Generate decomposition | `swarm_decompose` | `hive_decompose` | ✅ Parity | |
| Strategy-specific prompt | `swarm_plan_prompt` | `hive_plan_prompt` | ✅ Parity | |
| Validate decomposition | `swarm_validate_decomposition` | `hive_validate_decomposition` | ✅ Parity | |
| Get swarm status | `swarm_status` | `hive_status` | ✅ Parity | |
| Generate worker prompt | `swarm_subtask_prompt` | `hive_subtask_prompt` | ✅ Parity | |
| Spawn subtask | `swarm_spawn_subtask` | `hive_spawn_subtask` | ✅ Parity | |
| Report progress | `swarm_progress` | `hive_progress` | ✅ Parity | |
| Complete subtask | `swarm_complete` | `hive_complete` | ✅ Parity | |
| Handle Task return | N/A | `hive_complete_subtask` | 🆕 Unique | We have this |
| Self-evaluation prompt | `swarm_evaluation_prompt` | `hive_evaluation_prompt` | ✅ Parity | |
| Record outcome | `swarm_record_outcome` | `hive_record_outcome` | ✅ Parity | |
| Delegate planning | `swarm_delegate_planning` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| Broadcast to all | `swarm_broadcast` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| Extract learnings | `swarm_learn` | ❌ MISSING | ❌ Gap | Learning extraction |
| Track single task | N/A | `hive_track_single` | 🆕 Unique | We have this |
| Spawn child task | N/A | `hive_spawn_child` | 🆕 Unique | We have this |

**Tool Count**: Upstream 24, Ours ~14-16 (gaps + unique features)

---

### 2.4 Checkpoint & Recovery

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Save checkpoint | `swarm_checkpoint` | ✅ Have | ✅ Parity | Different tool structure |
| Recover from checkpoint | `swarm_recover` | ✅ Have | ✅ Parity | Different tool structure |
| Auto-checkpoint at milestones | 25/50/75% | 25/50/75% | ✅ Parity | Same behavior |
| 9 integration tests | ✅ | ✅ | ✅ Parity | Similar coverage |

---

### 2.5 Error Handling (3-Strike System)

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Accumulate error | `swarm_accumulate_error` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| Check strikes | `swarm_check_strikes` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| Get error context | `swarm_get_error_context` | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| Resolve error | `swarm_resolve_error` | ❌ MISSING | ❌ Gap | **NEW in upstream** |

**Note**: We have `src/hive-strikes.ts` but it's not exposed as tools.

---

### 2.6 Skills System

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| List skills | `skills_list` | `skills_list` | ✅ Parity | |
| Use skill | `skills_use` | `skills_use` | ✅ Parity | |
| Read skill | `skills_read` | `skills_read` | ✅ Parity | |
| Create skill | `skills_create` | `skills_create` | ✅ Parity | |
| Update skill | N/A | `skills_update` | 🆕 Unique | We have this |
| Delete skill | N/A | `skills_delete` | 🆕 Unique | We have this |
| Initialize directory | N/A | `skills_init` | 🆕 Unique | We have this |
| Add script to skill | N/A | `skills_add_script` | 🆕 Unique | We have this |
| Execute skill script | N/A | `skills_execute` | 🆕 Unique | We have this |
| Bundled skills count | 6 | 7 | ⭐ Enhanced | We have +1 |

**Tool Count**: Upstream 4, Ours 10 (we have +6 unique tools)

---

### 2.7 Decomposition Strategies

| Strategy | Upstream | Ours | Status | Notes |
|----------|----------|------|--------|-------|
| file-based | ✅ | ✅ | ✅ Parity | Refactoring |
| feature-based | ✅ | ✅ | ✅ Parity | New features |
| risk-based | ✅ | ✅ | ✅ Parity | Bug fixes |
| research-based | ✅ | ❌ MISSING | ❌ Gap | **NEW in upstream** |
| auto | ✅ | ✅ | ✅ Parity | Let system decide |

---

### 2.8 Structured JSON Tools

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Extract JSON | N/A | `structured_extract_json` | 🆕 Unique | |
| Validate response | N/A | `structured_validate` | 🆕 Unique | |
| Parse evaluation | N/A | `structured_parse_evaluation` | 🆕 Unique | |
| Parse decomposition | N/A | `structured_parse_decomposition` | 🆕 Unique | |
| Parse bead tree | N/A | `structured_parse_bead_tree` | 🆕 Unique | |

**Tool Count**: Upstream 0, Ours 5 (entirely unique)

---

### 2.9 Design Specification System

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Write spec | N/A | `spec_write` | 🆕 Unique | |
| Quick write spec | N/A | `spec_quick_write` | 🆕 Unique | |
| Read spec | N/A | `spec_read` | 🆕 Unique | |

**Tool Count**: Upstream 0, Ours 3 (entirely unique)

---

### 2.10 Learning & Memory

| Feature | Upstream | Ours | Status | Notes |
|---------|----------|------|--------|-------|
| Pattern maturity lifecycle | ✅ | ✅ | ✅ Parity | CANDIDATE→ESTABLISHED→PROVEN→DEPRECATED |
| Confidence decay | 90-day half-life | 90-day half-life | ✅ Parity | Same |
| Semantic search | Ollama required | LanceDB (no deps) | ⭐ Enhanced | Ours is zero-config |
| Embedding model | mxbai-embed-large | Hugging Face local | ⭐ Enhanced | Ours is embedded |
| Mandate system | N/A | ✅ | 🆕 Unique | Democratic knowledge |
| Outcome signals | ✅ | ✅ | ✅ Parity | Fast/slow, errors |

---

### 2.11 External Dependencies

| Dependency | Upstream | Ours | Status | Notes |
|------------|----------|------|--------|-------|
| OpenCode | Required | Required | ✅ Parity | Host agent |
| CASS | Optional | ❌ Skipped | ⚠️ Different | We use LanceDB |
| UBS | Optional | ❌ Skipped | ⚠️ Different | We use TypeScript strict |
| Ollama | Required for semantic | ❌ Not needed | ⭐ Enhanced | We use local embeddings |
| PGLite | ✅ | ✅ | ✅ Parity | Embedded Postgres |
| LanceDB | ❌ | ✅ | 🆕 Unique | Embedded vectors |

---

## 3. Gap Analysis

### 3.1 Features Upstream Has That We Lack (6 Gaps)

| Gap # | Feature | Upstream Tool(s) | Priority | Effort | Impact |
|-------|---------|------------------|----------|--------|--------|
| 1 | **3-Strike Error System** | `swarm_accumulate_error`, `swarm_check_strikes`, `swarm_get_error_context`, `swarm_resolve_error` | HIGH | Medium | Error resilience |
| 2 | **Research-Based Strategy** | `swarm_select_strategy` option | MEDIUM | Low | Unknown domains |
| 3 | **Delegate Planning** | `swarm_delegate_planning` | MEDIUM | Medium | Complex tasks |
| 4 | **Broadcast to All** | `swarm_broadcast` | LOW | Low | Coordinator convenience |
| 5 | **Learning Extraction** | `swarm_learn` | LOW | Medium | Automatic patterns |
| 6 | **CASS Integration** | Built-in | LOW | High | Cross-project search |

**Note**: Gap #1 is partially addressed by `src/hive-strikes.ts` but not exposed as tools.

---

### 3.2 Features We Have That Upstream Lacks (7 Unique)

| # | Feature | Our Tool(s) | Value Proposition |
|---|---------|-------------|-------------------|
| 1 | **Mandate System** | `src/mandates.ts` | Democratic knowledge curation |
| 2 | **Design Specs** | `spec_write`, `spec_read` | Human-in-the-loop approval |
| 3 | **Skills CRUD** | `skills_update`, `skills_delete` | Full skill lifecycle |
| 4 | **Skills Scripts** | `skills_add_script`, `skills_execute` | Executable skills |
| 5 | **Structured Parsing** | `structured_*` (5 tools) | JSON extraction helpers |
| 6 | **Output Guardrails** | `src/output-guardrails.ts` | Context bloat prevention |
| 7 | **Eval Capture** | `src/eval-capture.ts` | Decomposition metrics |

---

### 3.3 Naming Differences Summary

| Category | Upstream Name | Our Name | Confusion Risk |
|----------|---------------|----------|----------------|
| Work Item Tracker | "Hive" | "Beads" | Medium |
| Orchestration | "Swarm" | "Hive" | **HIGH** |
| Messaging | "Swarm Mail" | "Hive Mail" | **HIGH** |
| Work Item (singular) | "Cell" | "Bead" | Low |
| Tool Prefix (work) | `hive_*` | `beads_*` | Medium |
| Tool Prefix (orchestration) | `swarm_*` | `hive_*` | **HIGH** |
| Tool Prefix (messaging) | `swarmmail_*` | `hivemail_*` | **HIGH** |

---

## 4. Tool Count Summary

| Category | Upstream | Ours | Difference |
|----------|----------|------|------------|
| Work Items | 8 | 9 | +1 |
| Messaging | 6 | 8 | +2 |
| Orchestration | 24 | ~14 | -10 (but +4 unique) |
| Skills | 4 | 10 | +6 |
| Structured | 0 | 5 | +5 |
| Spec | 0 | 3 | +3 |
| **TOTAL** | **42** | **~47** | **+5** |

---

## 5. Recommendations

### 5.1 High Priority (Should Implement)

#### 1. Expose 3-Strike Error Tools (4 hours)

We already have `src/hive-strikes.ts`. Expose as tools:
- `hive_accumulate_error`
- `hive_check_strikes`
- `hive_get_error_context`
- `hive_resolve_error`

#### 2. Add Research-Based Strategy (2 hours)

Add `research-based` to decomposition strategies. Use when task domain is unfamiliar.

### 5.2 Medium Priority (Consider)

#### 3. Add Delegate Planning (4 hours)

Implement `hive_delegate_planning` to spawn dedicated planner subagent for complex tasks.

#### 4. Add Broadcast (2 hours)

Implement `hive_broadcast` for coordinator announcements to all active agents.

### 5.3 Low Priority (Future)

#### 5. Learning Extraction (4 hours)

Implement `hive_learn` to automatically extract patterns from outcomes.

---

## 6. Conclusion

### Overall Assessment

| Aspect | Status |
|--------|--------|
| Core Feature Parity | ✅ **Achieved** |
| Naming Consistency | ⚠️ **Divergent** |
| Unique Enhancements | ⭐ **+7 features** |
| Gaps to Address | ❌ **6 gaps** (2 high priority) |

### Key Takeaways

1. **We have achieved functional parity** for core orchestration, messaging, and work item tracking
2. **Naming is significantly divergent** - could cause confusion for users familiar with upstream
3. **We have 7 unique features** that upstream lacks (mandates, specs, skills CRUD, etc.)
4. **We should expose 3-strike system** as tools (code exists, not exposed)
5. **We should add research-based strategy** (low effort, high value for unknown domains)

---

**Document Complete**  
**Generated**: December 19, 2025  
**Agent**: GreenStorm  
**Bead**: opencode-swarm-plugin-8zm.3  
**Status**: Ready for Coordinator Review
