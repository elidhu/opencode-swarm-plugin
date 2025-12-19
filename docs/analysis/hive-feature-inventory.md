# Hive Implementation Feature Inventory

**Date**: December 19, 2025  
**Epic**: opencode-swarm-plugin-8zm  
**Bead**: opencode-swarm-plugin-8zm.2  
**Status**: Complete

---

## Executive Summary

This document provides a comprehensive inventory of our **opencode-swarm-plugin** (internally rebranded to "hive") implementation. Our implementation extends the original upstream with significant innovations.

**Key Stats**:
- **Total Tools**: 47+ tools
- **Source Files**: 90+ TypeScript files
- **CLI Commands**: 7 commands
- **Bundled Skills**: 7 skills
- **Integration Tests**: 20+ test files

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     HIVE STACK                              │
├─────────────────────────────────────────────────────────────┤
│  TIER 4: ORCHESTRATION                                      │
│  ├── hive_* tools - Task coordination                       │
│  ├── beads_* tools - Work item tracking                     │
│  ├── skills_* tools - Knowledge injection                   │
│  └── spec_* tools - Design specification                    │
│                                                             │
│  TIER 3: LEARNING & MEMORY                                  │
│  ├── LanceDB - Vector storage (embedded, Hugging Face)      │
│  ├── Pattern maturity lifecycle                             │
│  ├── Mandate system - Emergent guidelines                   │
│  └── Specialization - Agent capability profiles             │
│                                                             │
│  TIER 2: COORDINATION                                       │
│  ├── DurableMailbox - Actor inbox with typed envelopes      │
│  ├── DurableLock - CAS-based mutual exclusion               │
│  └── ask<Req, Res>() - Request/Response (RPC-style)         │
│                                                             │
│  TIER 1: PRIMITIVES                                         │
│  ├── DurableCursor - Checkpointed stream reader             │
│  └── DurableDeferred - Distributed promise                  │
│                                                             │
│  STORAGE                                                    │
│  ├── PGLite (Embedded Postgres) - Event sourcing            │
│  └── LanceDB (Embedded) - Vector search & patterns          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Tool Inventory

### 2.1 Beads Tools (Work Item Tracking) - 9 Tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `beads_create` | `title`, `type?`, `description?`, `parent_id?`, `priority?` | Create bead with validation |
| `beads_create_epic` | `epic_title`, `epic_description?`, `subtasks[]` | Atomic epic + subtasks |
| `beads_query` | `status?`, `type?`, `ready?`, `limit?` | Query with filters |
| `beads_update` | `id`, `status?`, `description?`, `priority?` | Update bead |
| `beads_close` | `id`, `reason` | Close with reason |
| `beads_start` | `id` | Mark in-progress |
| `beads_ready` | (none) | Get next unblocked |
| `beads_sync` | `auto_pull?` | Git sync + push |
| `beads_link_thread` | `bead_id`, `thread_id` | Link to mail thread |

---

### 2.2 Hive Mail Tools (Agent Coordination) - 8 Tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `hivemail_init` | `project_path`, `agent_name?`, `task_description?` | Initialize session |
| `hivemail_send` | `to[]`, `subject`, `body`, `thread_id?`, `importance?`, `ack_required?` | Send message |
| `hivemail_inbox` | `limit?`, `urgent_only?` | Fetch inbox (headers only, max 5) |
| `hivemail_read_message` | `message_id` | Read one message body |
| `hivemail_reserve` | `paths[]`, `exclusive?`, `reason?`, `ttl_seconds?` | Reserve files |
| `hivemail_release` | `paths?`, `reservation_ids?` | Release reservations |
| `hivemail_ack` | `message_id` | Acknowledge message |
| `hivemail_health` | (none) | Database health check |

---

### 2.3 Hive Tools (Task Orchestration) - 14 Tools

#### Core Orchestration

| Tool | Parameters | Purpose |
|------|------------|---------|
| `hive_init` | `project_path?` | Initialize session |
| `hive_select_strategy` | `task`, `codebase_context?` | Recommend decomposition strategy |
| `hive_decompose` | `task`, `max_subtasks?`, `query_cass?`, `cass_limit?`, `context?` | Generate decomposition prompt |
| `hive_plan_prompt` | `task`, `strategy?`, `max_subtasks?`, `query_cass?`, `cass_limit?`, `context?` | Strategy-specific decomposition |
| `hive_validate_decomposition` | `response` | Validate against BeadTreeSchema |
| `hive_status` | `epic_id`, `project_key?` | Get hive progress |

#### Worker Management

| Tool | Parameters | Purpose |
|------|------------|---------|
| `hive_subtask_prompt` | `agent_name`, `bead_id`, `epic_id`, `subtask_title`, `files[]`, `subtask_description?`, `shared_context?` | Generate worker prompt |
| `hive_spawn_subtask` | `bead_id`, `epic_id`, `subtask_title`, `files[]`, `subtask_description?`, `shared_context?` | Prepare for Task tool |
| `hive_progress` | `project_key`, `agent_name`, `bead_id`, `status`, `message?`, `progress_percent?`, `files_touched?` | Report progress |
| `hive_complete` | `project_key`, `agent_name`, `bead_id`, `summary`, `files_touched?`, `evaluation?`, `skip_ubs_scan?` | Complete subtask |
| `hive_complete_subtask` | `bead_id`, `task_result`, `files_touched?` | Handle Task agent return |
| `hive_evaluation_prompt` | `bead_id`, `subtask_title`, `files_touched[]` | Self-evaluation prompt |
| `hive_record_outcome` | `bead_id`, `duration_ms`, `success`, `strategy?`, `error_count?`, `retry_count?`, `files_touched?`, `criteria?` | Record outcome |

#### Single-Task Tracking (NEW - Not in upstream)

| Tool | Parameters | Purpose |
|------|------------|---------|
| `hive_track_single` | `project_key`, `task_description`, `files?`, `priority?`, `agent_name?` | Track single-agent work |
| `hive_spawn_child` | `parent_bead_id`, `title`, `description?`, `files?`, `type?`, `priority?` | Create child for emergent work |

---

### 2.4 Checkpoint & Recovery Tools - 2 Tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `hive_checkpoint` | `project_key`, `agent_name`, `cell_id`, `epic_id`, `files_modified[]`, `progress_percent`, `directives?`, `error_context?` | Save progress snapshot |
| `hive_recover` | `project_key`, `epic_id` | Resume from checkpoint |

**Features**:
- Auto-checkpoint at 25%, 50%, 75% progress milestones
- Full context restoration on recovery
- Directives passing between agents

---

### 2.5 Structured Tools (JSON Parsing) - 5 Tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `structured_extract_json` | `text` | Extract JSON from markdown |
| `structured_validate` | `response`, `schema_name`, `max_retries?` | Validate against schema |
| `structured_parse_evaluation` | `response` | Parse evaluation |
| `structured_parse_decomposition` | `response` | Parse decomposition |
| `structured_parse_bead_tree` | `response` | Parse bead tree |

---

### 2.6 Skills Tools - 10 Tools

| Tool | Parameters | Purpose |
|------|------------|---------|
| `skills_list` | `source?` | List available skills |
| `skills_read` | `name` | Read skill content |
| `skills_use` | `name`, `context?` | Load into agent context |
| `skills_create` | `name`, `description`, `scope?`, `tags?` | Create new skill |
| `skills_update` | `name`, `content` | Update skill content |
| `skills_delete` | `name` | Delete skill |
| `skills_init` | `path?` | Initialize skills directory |
| `skills_add_script` | `skill_name`, `script_name`, `content`, `executable?` | Add script to skill |
| `skills_execute` | `skill_name`, `script_name`, `args?` | Execute skill script |

**Bundled Skills (7)**:
- `hive-coordination` - Multi-agent coordination patterns
- `testing-patterns` - Dependency breaking, characterization tests
- `cli-builder` - TypeScript CLI patterns
- `system-design` - Architecture decisions
- `learning-systems` - Pattern maturity, confidence decay
- `skill-creator` - Meta-skill for creating skills
- `beads-workflow` - Example workflow skill

---

### 2.7 Spec Tools (Design Specification) - 3 Tools (NEW - Not in upstream)

| Tool | Parameters | Purpose |
|------|------------|---------|
| `spec_write` | `capability`, `title`, `purpose`, `requirements[]`, `confidence`, `auto_approve?` | Full spec creation |
| `spec_quick_write` | (same as above) | Quick spec creation |
| `spec_read` | `capability` | Read existing spec |

**Features**:
- Human-in-the-loop approval workflow
- Gherkin-style scenarios
- Confidence scoring
- Auto-approve for routine tasks

---

## 3. Unique Features (Not in Upstream)

### 3.1 LanceDB Vector Storage

**Location**: `src/storage.ts`, `src/embeddings.ts`

Instead of requiring external Ollama for semantic search, we use:
- **LanceDB** - Embedded vector database
- **@huggingface/transformers** - Local embedding model
- **Zero external dependencies** - Everything runs in-process

```typescript
// Our approach
import { LanceDBStorage } from "./storage";
const storage = await LanceDBStorage.create(".hive/vectors");
await storage.storePattern(pattern);
const similar = await storage.querySimilar(embedding, 5);
```

### 3.2 Mandate System

**Location**: `src/mandates.ts`, `src/mandate-storage.ts`, `src/mandate-promotion.ts`

Emergent guidelines that arise from repeated patterns:

```typescript
interface Mandate {
  id: string;
  pattern: string;           // What we learned
  confidence: number;        // 0-1, decays over time
  source: "observation" | "explicit";
  validated_count: number;
  failed_count: number;
  status: "candidate" | "established" | "proven" | "deprecated";
}
```

**Lifecycle**:
- `CANDIDATE` → validated 3+ times → `ESTABLISHED`
- `ESTABLISHED` → 10+ successes → `PROVEN`
- Any status → >60% failures → `DEPRECATED`

### 3.3 Single-Task Tracking

**Location**: `src/hive-orchestrate.ts`

For tasks that don't need full hive decomposition:

```typescript
// Track single-agent work
const track = await hive_track_single({
  project_key: "$PWD",
  task_description: "Fix auth bug",
  files: ["src/auth.ts"],
});

// Discover emergent work
await hive_spawn_child({
  parent_bead_id: track.bead_id,
  title: "Add auth tests",
  description: "Discovered missing coverage",
});
```

### 3.4 Design Specification System

**Location**: `src/spec.ts`, `src/schemas/spec.ts`

Human-in-the-loop design specifications:

```typescript
const spec = await spec_write({
  capability: "user-auth",
  title: "User Authentication",
  purpose: "Secure user login",
  requirements: [{
    name: "Password validation",
    type: "must",
    description: "Validate password strength",
    scenarios: [{
      name: "Strong password",
      given: "user enters 'StrongP@ss123'",
      when: "validation runs",
      then: ["validation passes", "no errors shown"],
    }],
  }],
  confidence: 0.85,
});
```

### 3.5 Output Guardrails

**Location**: `src/output-guardrails.ts`

Prevent agents from producing harmful or low-quality output:
- File path validation
- Size limits
- Content filtering
- Rate limiting

### 3.6 Eval Capture

**Location**: `src/eval-capture.ts`

Capture decomposition outcomes for analysis:
- Full decomposition lifecycle tracking
- JSONL export for data analysis
- Connects to evals system

### 3.7 Adapter Pattern

**Location**: `src/adapter.ts`, `src/types/adapter.ts`

Testing abstraction layer:
- Mock implementations for tests
- Dependency injection
- Clean separation of concerns

### 3.8 3-Strike Error System

**Location**: `src/hive-strikes.ts`

Track recurring errors (similar to upstream but different implementation):
- Error accumulation
- Strike checking
- Resolution tracking

---

## 4. CLI Commands

| Command | Purpose |
|---------|---------|
| `hive setup` | Install and configure plugin |
| `hive doctor` | Check dependency status |
| `hive init` | Initialize hive in project |
| `hive config` | Show config paths |
| `hive sync` | Sync configs to global |
| `hive inbox` | Check hive mail inbox |
| `hive spec` | Manage design specifications |

---

## 5. Decomposition Strategies

| Strategy | Use Case | Keywords |
|----------|----------|----------|
| `file-based` | Refactoring | refactor, migrate, rename |
| `feature-based` | New features | add, implement, build |
| `risk-based` | Bug fixes | fix, bug, security |
| `auto` | Let system decide | (default) |

**Note**: Upstream has added `research-based` strategy - we don't have this yet.

---

## 6. Storage Architecture

### PGLite (Event Sourcing)

**Location**: `.opencode/streams/`

Tables:
- `events` - All events (agent_registered, message_sent, etc.)
- `cursors` - Stream positions
- `deferred` - Distributed promises
- `locks` - Mutual exclusion
- `swarm_contexts` - Checkpoint recovery

### LanceDB (Vector Storage)

**Location**: `.hive/vectors/`

Tables:
- `patterns` - Learned patterns with embeddings
- `mandates` - Emergent guidelines

---

## 7. Event Types

| Event Type | Description |
|------------|-------------|
| `agent_registered` | Agent joins hive |
| `message_sent` | Agent-to-agent message |
| `file_reserved` | Exclusive file lock |
| `file_released` | Lock released |
| `hive_checkpointed` | Progress snapshot |
| `decomposition_generated` | Task decomposed |
| `subtask_outcome` | Worker completion |

---

## 8. Testing Coverage

**Integration Tests**:
- `src/beads.integration.test.ts`
- `src/checkpoint.integration.test.ts`
- `src/hive-mail.integration.test.ts`
- `src/hive-orchestrate.integration.test.ts`
- `src/learning.integration.test.ts`
- `src/spec.integration.test.ts`
- `src/storage.integration.test.ts`
- `src/streams/store.integration.test.ts`

**Unit Tests**:
- `src/*.test.ts` - 15+ files
- `src/schemas/index.test.ts`
- `src/streams/*.test.ts`

---

## 9. Comparison Points for Gap Analysis

### Features We Have That Upstream May Not

| Feature | Our Implementation | Upstream Status |
|---------|-------------------|-----------------|
| LanceDB vectors | `src/storage.ts` | Uses Ollama |
| Mandate system | `src/mandates.ts` | Unknown |
| Single-task tracking | `hive_track_single` | Unknown |
| Design specs | `spec_*` tools | Unknown |
| Output guardrails | `src/output-guardrails.ts` | Unknown |
| Eval capture | `src/eval-capture.ts` | Unknown |
| Skills scripts | `skills_add_script`, `skills_execute` | skills_create only |

### Features to Verify Against Upstream

| Category | Our Tools | Upstream Tools |
|----------|-----------|----------------|
| Work items | beads_* (9) | hive_* (8) |
| Messaging | hivemail_* (8) | swarmmail_* (6) |
| Orchestration | hive_* (14+) | swarm_* (24) |
| Skills | skills_* (10) | skills_* (4) |
| Errors | hive-strikes.ts | swarm_*_error (4) |
| Recovery | checkpoint/recover | checkpoint/recover |

---

## 10. Source File Structure

```
src/
├── hive.ts                    # Main hive tools
├── hive-orchestrate.ts        # Coordinator logic
├── hive-decompose.ts          # Decomposition strategies
├── hive-strategies.ts         # Strategy selection
├── hive-prompts.ts            # Prompt generation
├── hive-config.ts             # Shared configuration
├── hive-mail.ts               # Hive mail tools
├── hive-strikes.ts            # 3-strike error system
├── hive-verification.ts       # Verification gates
├── beads.ts                   # Work item tracking
├── skills.ts                  # Skills system
├── spec.ts                    # Design specifications
├── mandates.ts                # Mandate system
├── mandate-storage.ts         # Mandate persistence
├── mandate-promotion.ts       # Mandate lifecycle
├── learning.ts                # Pattern learning
├── pattern-maturity.ts        # Maturity lifecycle
├── checkpoint.ts              # Checkpoint/recovery
├── storage.ts                 # LanceDB storage
├── embeddings.ts              # Hugging Face embeddings
├── structured.ts              # JSON parsing
├── output-guardrails.ts       # Output validation
├── eval-capture.ts            # Eval data capture
├── adapter.ts                 # Testing abstraction
├── schemas/                   # Zod schemas
├── streams/                   # Event sourcing
│   ├── store.ts               # Event store
│   ├── events.ts              # Event types
│   ├── projections.ts         # Event projections
│   ├── hive-mail.ts           # Mail event handling
│   └── effect/                # Durable primitives
└── cli/                       # CLI implementation
    ├── commands/              # Subcommands
    ├── config.ts              # Config management
    └── templates.ts           # Config templates
```

---

**Document Complete**  
**Generated**: December 19, 2025  
**Bead**: opencode-swarm-plugin-8zm.2  
**Status**: Ready for Feature Mapping (Subtask 3)
