# Upstream Current Features Inventory

**Date**: December 19, 2025  
**Epic**: opencode-swarm-plugin-8zm  
**Bead**: opencode-swarm-plugin-8zm.1  
**Agent**: BlueMoon  
**Status**: Complete

---

## Executive Summary

This document provides a comprehensive inventory of the **upstream opencode-swarm-plugin** (v0.30.6) as of December 19, 2025. The upstream is actively maintained at:

- **Repository**: https://github.com/joelhooks/swarm-tools
- **NPM Package**: `opencode-swarm-plugin` (v0.30.6, published 10 hours ago)
- **Documentation**: https://swarmtools.ai/docs
- **Downloads**: 7,406 weekly

**Key Findings Since Last Analysis (Dec 15, 2025)**:
1. **NEW**: Rebranded "Beads" to "Hive" (with backward-compatible `beads_*` tools)
2. **NEW**: "Agent Mail" rebranded to "Swarm Mail" (`swarmmail_*` tools)
3. **NEW**: `swarm_delegate_planning` - Delegate planning to planner subagent
4. **NEW**: `swarm_broadcast` - Send message to all active agents
5. **NEW**: `swarm_accumulate_error`, `swarm_check_strikes`, `swarm_get_error_context`, `swarm_resolve_error` - 3-strike error system
6. **NEW**: Checkpoint & Recovery proven with 9 integration tests
7. **NEW**: Research-based decomposition strategy added
8. **ENHANCED**: Ollama integration for semantic memory (embedded in plugin)

---

## 1. Upstream Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     SWARM TOOLS STACK                       │
├─────────────────────────────────────────────────────────────┤
│  TIER 3: ORCHESTRATION                                      │
│  └── OpenCode Plugin (hive, swarm, skills, learning)       │
│                                                             │
│  TIER 2: COORDINATION                                       │
│  ├── DurableMailbox - Actor inbox with typed envelopes     │
│  ├── DurableLock - CAS-based mutual exclusion              │
│  └── ask<Req, Res>() - Request/Response (RPC-style)        │
│                                                             │
│  TIER 1: PRIMITIVES                                         │
│  ├── DurableCursor - Checkpointed stream reader            │
│  └── DurableDeferred - Distributed promise                 │
│                                                             │
│  STORAGE                                                    │
│  └── PGLite (Embedded Postgres) + Event Sourcing           │
└─────────────────────────────────────────────────────────────┘
```

### Package Structure

The upstream is organized as a monorepo with two packages:

```
joelhooks/swarm-tools/
├── packages/
│   ├── swarm-mail/              # Event sourcing primitives
│   │   └── src/streams/         # DurableMailbox, DurableLock, etc.
│   └── opencode-swarm-plugin/   # Main plugin
│       ├── src/                 # Plugin tools
│       ├── global-skills/       # Bundled skills
│       └── docs/                # Architecture docs
├── apps/web/                    # Documentation website (swarmtools.ai)
├── .hive/                       # Git-backed work items
└── turbo.json                   # Turborepo config
```

---

## 2. Tool Inventory

### 2.1 Hive Tools (Work Item Tracking) - 8 Tools

**Note**: This was previously called "Beads" - renamed to "Hive" in recent versions. The `beads_*` tools still work but show deprecation warnings.

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `hive_create` | `title`, `type?`, `description?`, `parent_id?`, `priority?` | Create cell with type-safe validation | ✅ Current |
| `hive_create_epic` | `epic_title`, `epic_description?`, `subtasks[]` | Atomic epic + subtasks creation | ✅ Current |
| `hive_query` | `status?`, `type?`, `ready?`, `limit?` | Query cells with filters | ✅ Current |
| `hive_update` | `id`, `status?`, `description?`, `priority?` | Update status/description/priority | ✅ Current |
| `hive_close` | `id`, `reason` | Close cell with reason | ✅ Current |
| `hive_start` | `id` | Mark cell as in-progress | ✅ Current |
| `hive_ready` | (none) | Get next unblocked cell (highest priority) | ✅ Current |
| `hive_sync` | `auto_pull?` | Sync cells to git and push | ✅ Current |

**Legacy Tools** (still functional, show deprecation):
- `beads_create`, `beads_create_epic`, `beads_query`, `beads_update`, `beads_close`, `beads_start`, `beads_ready`, `beads_sync`

---

### 2.2 Swarm Mail Tools (Agent Coordination) - 6 Tools

**Note**: Previously "Agent Mail" - rebranded to "Swarm Mail" in recent versions.

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `swarmmail_init` | `project_path`, `agent_name?`, `task_description?` | Initialize session | ✅ Current |
| `swarmmail_send` | `to[]`, `subject`, `body`, `thread_id?`, `importance?`, `ack_required?` | Send message to agents | ✅ Current |
| `swarmmail_inbox` | `limit?`, `urgent_only?` | Fetch inbox (context-safe, max 5 messages, headers only) | ✅ Current |
| `swarmmail_read_message` | `message_id` | Fetch one message body by ID | ✅ Current |
| `swarmmail_reserve` | `paths[]`, `exclusive?`, `reason?`, `ttl_seconds?` | Reserve files for exclusive edit | ✅ Current |
| `swarmmail_release` | `paths?`, `reservation_ids?` | Release file reservations | ✅ Current |

**Message Format**:
```typescript
{
  to: string[];           // Recipient agent names
  subject: string;        // Message subject
  body: string;           // Message content
  thread_id?: string;     // Thread for grouping
  importance?: "low" | "normal" | "high" | "urgent";
  ack_required?: boolean; // Request acknowledgment
}
```

---

### 2.3 Swarm Tools (Task Orchestration) - 24 Tools

#### Core Orchestration (7 tools)

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `swarm_init` | `project_path?` | Initialize swarm session, check tool availability | ✅ Current |
| `swarm_select_strategy` | `task`, `codebase_context?` | Analyze task, recommend decomposition strategy | ✅ Current |
| `swarm_decompose` | `task`, `max_subtasks?`, `query_cass?`, `cass_limit?`, `context?` | Generate decomposition prompt (queries CASS) | ✅ Current |
| `swarm_plan_prompt` | `task`, `strategy?`, `max_subtasks?`, `query_cass?`, `cass_limit?`, `context?` | Generate strategy-specific decomposition prompt | ✅ Current |
| `swarm_validate_decomposition` | `response` | Validate response against BeadTreeSchema, detect conflicts | ✅ Current |
| `swarm_status` | `epic_id`, `project_key?` | Get swarm progress by epic ID | ✅ Current |
| `swarm_delegate_planning` | (unknown params) | Delegate planning to planner subagent | **NEW** |

#### Worker Management (5 tools)

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `swarm_subtask_prompt` | `agent_name`, `bead_id`, `epic_id`, `subtask_title`, `files[]`, `subtask_description?`, `shared_context?` | Generate worker agent prompt | ✅ Current |
| `swarm_spawn_subtask` | `bead_id`, `epic_id`, `subtask_title`, `files[]`, `subtask_description?`, `shared_context?` | Prepare subtask for Task tool spawning | ✅ Current |
| `swarm_progress` | `project_key`, `agent_name`, `bead_id`, `status`, `message?`, `progress_percent?`, `files_touched?` | Report subtask progress to coordinator | ✅ Current |
| `swarm_complete` | `project_key`, `agent_name`, `bead_id`, `summary`, `files_touched?`, `evaluation?`, `skip_ubs_scan?` | Complete subtask (runs UBS scan, releases reservations) | ✅ Current |
| `swarm_evaluation_prompt` | `bead_id`, `subtask_title`, `files_touched[]` | Generate self-evaluation prompt | ✅ Current |

#### Learning System (2 tools)

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `swarm_record_outcome` | `bead_id`, `duration_ms`, `success`, `strategy?`, `error_count?`, `retry_count?`, `files_touched?`, `criteria?` | Record outcome for implicit feedback scoring | ✅ Current |
| `swarm_learn` | (unknown params) | Extract learnings from outcome | ✅ Current |

#### Checkpoint & Recovery (2 tools)

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `swarm_checkpoint` | `project_key`, `agent_name`, `cell_id`, `epic_id`, `files_modified[]`, `progress_percent`, `directives?`, `error_context?` | Save progress snapshot (auto at 25/50/75%) | ✅ Current |
| `swarm_recover` | `project_key`, `epic_id` | Resume from last checkpoint (returns full context) | ✅ Current |

**Checkpoint Data Structure**:
```typescript
{
  epic_id: string;
  cell_id: string;
  strategy: "file-based" | "feature-based" | "risk-based" | "research-based";
  files: string[];
  progress_percent: number;
  directives: {
    shared_context?: string;
    skills_to_load?: string[];
    coordinator_notes?: string;
  };
  recovery: {
    last_checkpoint: number;     // Unix timestamp
    files_modified: string[];
    error_context?: string;
  };
}
```

#### Communication (2 tools)

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `swarm_broadcast` | (unknown params) | Send message to all active agents | **NEW** |
| (Agent Mail via swarmmail_send) | | Point-to-point messaging | ✅ Current |

#### Error Handling (4 tools) - **NEW**

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `swarm_accumulate_error` | (unknown params) | Track recurring errors (3-strike system) | **NEW** |
| `swarm_check_strikes` | (unknown params) | Check if error threshold reached | **NEW** |
| `swarm_get_error_context` | (unknown params) | Get context for error pattern | **NEW** |
| `swarm_resolve_error` | (unknown params) | Mark error pattern as resolved | **NEW** |

**3-Strike Error System**: When an error pattern accumulates 3 strikes, the swarm escalates or changes strategy.

---

### 2.4 Skills Tools (Knowledge Injection) - 4 Tools

| Tool | Parameters | Purpose | Status |
|------|------------|---------|--------|
| `skills_list` | `source?` | List available skills (all/global/project/bundled) | ✅ Current |
| `skills_use` | `name`, `context?` | Load skill into agent context | ✅ Current |
| `skills_read` | `name` | Read skill's full content including SKILL.md and references | ✅ Current |
| `skills_create` | `name`, `description`, `scope?`, `tags?` | Create new skill with SKILL.md template | ✅ Current |

**Bundled Skills (6 total)**:
- `testing-patterns` - 25 dependency-breaking techniques, characterization tests
- `swarm-coordination` - Multi-agent decomposition, file reservations
- `cli-builder` - Argument parsing, help text, subcommands
- `system-design` - Architecture decisions, module boundaries
- `learning-systems` - Confidence decay, pattern maturity
- `skill-creator` - Meta-skill for creating new skills

---

## 3. Decomposition Strategies

### Available Strategies (4 total)

| Strategy | Use Case | Description |
|----------|----------|-------------|
| `file-based` | Refactoring | Split by directory structure, minimize cross-file dependencies |
| `feature-based` | New features | Split by vertical slices (UI → API → DB for each feature) |
| `risk-based` | Bug fixes | Tests first, then implementation, prioritize high-risk changes |
| `research-based` | **NEW** | Explore unknowns before committing to implementation |

### Strategy Selection Flow

```
Task arrives
     │
     ▼
┌────────────────────────────┐
│  swarm_select_strategy()   │
│                            │
│  1. Query CASS for similar │
│     past decompositions    │
│                            │
│  2. Analyze task type:     │
│     - Contains "refactor"  │
│       → file-based         │
│     - Contains "add" + UI  │
│       → feature-based      │
│     - Contains "fix"/"bug" │
│       → risk-based         │
│     - Unknown domain       │
│       → research-based     │
│                            │
│  3. Return recommendation  │
│     with confidence score  │
└────────────────────────────┘
```

---

## 4. Event Sourcing & Durable Primitives

### Event Types

| Event Type | Description | Fields |
|------------|-------------|--------|
| `agent_registered` | Agent joins swarm | `agent_name`, `task_description`, `timestamp` |
| `message_sent` | Agent-to-agent communication | `from`, `to[]`, `subject`, `body`, `thread_id?` |
| `file_reserved` | Exclusive file lock acquired | `agent_name`, `paths[]`, `ttl_seconds` |
| `file_released` | Lock released | `agent_name`, `paths[]` |
| `swarm_checkpointed` | Progress snapshot saved | `epic_id`, `cell_id`, `progress_percent`, `directives` |
| `decomposition_generated` | Task broken into subtasks | `epic_id`, `strategy`, `subtasks[]` |
| `subtask_outcome` | Worker completion result | `bead_id`, `success`, `duration_ms`, `error_count` |

### Durable Primitives (Effect-TS)

| Primitive | Purpose | Key Features |
|-----------|---------|--------------|
| `DurableCursor` | Positioned event stream consumption | Checkpointing, exactly-once delivery |
| `DurableDeferred` | URL-addressable distributed promises | Async coordination across agents |
| `DurableLock` | CAS-based mutual exclusion | TTL, retry with exponential backoff |
| `DurableMailbox` | Actor inbox with typed envelopes | Sender, replyTo, payload |
| `ask<Req, Res>()` | Request/Response RPC pattern | Creates deferred, waits for response |

### Storage

- **Backend**: PGLite (Embedded Postgres compiled to WASM)
- **Location**: `.swarm-mail/` directory in project root
- **No external dependencies**: Everything runs in-process

---

## 5. Learning System

### Pattern Maturity Lifecycle

```
CANDIDATE (new pattern, low confidence)
    │
    │  validated 3+ times
    ▼
ESTABLISHED (medium confidence)
    │
    │  10+ successes
    ▼
PROVEN (high confidence, 1.5x weight)
    │
    │  >60% failure rate
    ▼
DEPRECATED (auto-inverted to anti-pattern)
```

### Confidence Decay

- **Half-life**: 90 days
- **Effect**: Patterns fade unless revalidated
- **Purpose**: Prevent stale knowledge from dominating

### Outcome Signals

| Signal | Interpretation | Effect |
|--------|----------------|--------|
| Fast + 0 errors | Strong positive | Pattern promoted |
| Slow + retries | Weak negative | Pattern demoted slightly |
| Failed + many errors | Strong negative | Pattern moves toward deprecated |
| >60% failure rate | Critical | Auto-invert to anti-pattern |

---

## 6. External Dependencies

### Required

| Dependency | Purpose | Install |
|------------|---------|---------|
| OpenCode | AI coding agent (plugin runs inside) | See opencode.ai |

### Optional (Highly Recommended)

| Dependency | Purpose | Install |
|------------|---------|---------|
| **CASS** | Historical context - queries past sessions | `pip install -e .` from repo |
| **UBS** | Bug scanning - runs on subtask completion | `pip install -e .` from repo |
| **Ollama** | Embedding model for semantic memory | `brew install ollama && ollama pull mxbai-embed-large` |

### Semantic Memory

- **Embedded in plugin**: No separate installation needed
- **Requires Ollama**: For vector embeddings
- **Fallback**: Full-text search if Ollama unavailable

---

## 7. CLI Commands

| Command | Purpose |
|---------|---------|
| `swarm setup` | Install and configure plugin |
| `swarm doctor` | Check dependency status (CASS, UBS, Ollama) |
| `swarm init` | Initialize hive in project (creates .hive/) |
| `swarm config` | Show config file paths |

---

## 8. NEW Features Since Dec 15, 2025

### 8.1 Hive Rebranding

**Before**: `beads_*` tools  
**After**: `hive_*` tools (with backward-compatible aliases)

This is a cosmetic change - functionality unchanged.

### 8.2 Swarm Mail Rebranding

**Before**: `agentmail_*` or similar  
**After**: `swarmmail_*` tools

### 8.3 Research-Based Decomposition Strategy

A fourth decomposition strategy for handling unknown domains:
- Use when task domain is unfamiliar
- Prioritizes exploration before implementation
- Generates research subtasks first

### 8.4 3-Strike Error System (4 new tools)

New error handling tools that track recurring errors:
- `swarm_accumulate_error` - Increment error count
- `swarm_check_strikes` - Query if threshold reached
- `swarm_get_error_context` - Get accumulated error details
- `swarm_resolve_error` - Clear error state

When 3 strikes accumulate, swarm can:
- Escalate to coordinator
- Change decomposition strategy
- Request human intervention

### 8.5 swarm_delegate_planning

New tool to delegate decomposition planning to a dedicated planner subagent. Useful for complex tasks that benefit from focused planning.

### 8.6 swarm_broadcast

Send messages to all active agents simultaneously. Useful for:
- Coordinator announcements
- Strategy changes
- Shutdown signals

### 8.7 Checkpoint & Recovery Proven

- **9 integration tests** validate checkpoint/recovery
- Auto-checkpoint at 25%, 50%, 75% progress
- Non-fatal failures (work continues if checkpoint fails)
- Full context restoration on recovery

### 8.8 Ollama Integration (Embedded)

Semantic memory now embedded in plugin:
- Uses `mxbai-embed-large` model
- Falls back to full-text search if unavailable
- No separate semantic-memory package needed

---

## 9. Schemas & Validation

### BeadTreeSchema (Task Decomposition Output)

```typescript
{
  epic: {
    title: string;
    description?: string;
  };
  subtasks: Array<{
    title: string;
    files: string[];        // Files this subtask will touch
    priority?: 0 | 1 | 2 | 3;
    description?: string;
  }>;
  shared_context?: string;  // Context shared across all workers
  skills_to_load?: string[]; // Skills workers should load
}
```

### Validation Tools

| Schema | Purpose |
|--------|---------|
| `BeadTreeSchema` | Validate decomposition output |
| `EvaluationSchema` | Validate self-evaluation responses |
| `TaskDecompositionSchema` | Alternative decomposition format |

---

## 10. Source Code Structure

```
packages/opencode-swarm-plugin/src/
├── hive.ts              # Hive integration (work item tracking)
├── agent-mail.ts        # Agent Mail tools (legacy MCP wrapper)
├── swarm-mail.ts        # Swarm Mail tools (new, uses swarm-mail package)
├── swarm.ts             # Swarm orchestration tools
├── swarm-orchestrate.ts # Coordinator logic
├── swarm-decompose.ts   # Decomposition strategies
├── swarm-strategies.ts  # Strategy selection
├── skills.ts            # Skills system
├── learning.ts          # Pattern maturity, outcomes
├── anti-patterns.ts     # Anti-pattern detection
├── structured.ts        # JSON parsing utilities
├── mandates.ts          # Mandate system
└── schemas/             # Zod schemas
```

---

## 11. Comparison Points for Gap Analysis

### Features to Compare Against Our Implementation

| Category | Upstream Has | Notes |
|----------|--------------|-------|
| **Work Items** | hive_* (8 tools) | Git-backed, atomic epic creation |
| **Messaging** | swarmmail_* (6 tools) | Actor model, file reservations |
| **Orchestration** | swarm_* (24 tools) | CASS integration, 4 strategies |
| **Skills** | skills_* (4 tools) | 6 bundled skills |
| **Learning** | Pattern maturity, decay | 90-day half-life |
| **Errors** | 3-strike system | NEW - 4 tools |
| **Recovery** | Checkpoint/restore | 9 integration tests |
| **Semantic** | Ollama embeddings | Embedded, falls back to text |
| **External** | CASS, UBS optional | Requires pip install |

### Key Architectural Differences to Evaluate

1. **PGLite vs Our Storage** - Both use embedded databases
2. **Effect-TS Primitives** - Both use durable patterns
3. **CASS Integration** - Upstream uses external CASS, we use LanceDB
4. **Ollama Requirement** - Upstream needs Ollama for semantic search
5. **3-Strike System** - Upstream has explicit error accumulation
6. **Planner Delegation** - Upstream can delegate to planner subagent

---

## Appendix A: Tool Quick Reference

### All 42 Upstream Tools

**Hive (8)**: `hive_create`, `hive_create_epic`, `hive_query`, `hive_update`, `hive_close`, `hive_start`, `hive_ready`, `hive_sync`

**Swarm Mail (6)**: `swarmmail_init`, `swarmmail_send`, `swarmmail_inbox`, `swarmmail_read_message`, `swarmmail_reserve`, `swarmmail_release`

**Swarm (24)**: `swarm_init`, `swarm_select_strategy`, `swarm_decompose`, `swarm_delegate_planning`, `swarm_validate_decomposition`, `swarm_plan_prompt`, `swarm_subtask_prompt`, `swarm_spawn_subtask`, `swarm_evaluation_prompt`, `swarm_status`, `swarm_progress`, `swarm_complete`, `swarm_record_outcome`, `swarm_learn`, `swarm_checkpoint`, `swarm_recover`, `swarm_broadcast`, `swarm_accumulate_error`, `swarm_check_strikes`, `swarm_get_error_context`, `swarm_resolve_error`, (+ beads_link_thread legacy)

**Skills (4)**: `skills_list`, `skills_use`, `skills_read`, `skills_create`

---

## Appendix B: Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| 0.30.6 | Dec 19, 2025 | Latest (10 hours ago) |
| 0.23.0 | Dec 15, 2025 | Major release (GitHub release) |
| Earlier | - | 81 total versions on npm |

---

**Document Complete**  
**Generated**: December 19, 2025  
**Agent**: BlueMoon  
**Bead**: opencode-swarm-plugin-8zm.1  
**Status**: Ready for Feature Mapping (Subtask 3)
