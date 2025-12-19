# Hive Unique Innovations

**Date**: December 19, 2025  
**Epic**: opencode-swarm-plugin-8zm  
**Bead**: opencode-swarm-plugin-8zm.4  
**Agent**: BoldForest  
**Status**: Complete

---

## Executive Summary

This document catalogs features in our implementation that **do not exist in upstream** (joelhooks/swarm-tools v0.30.6). These represent our unique value-adds and innovations.

**Key Innovations**:
1. LanceDB Vector Storage (vs Ollama dependency)
2. Mandate System (emergent guidelines)
3. Single-Task Tracking (hive_track_single, hive_spawn_child)
4. Design Spec System (human-in-the-loop specifications)
5. Output Guardrails (content validation)
6. Eval Capture (decomposition analytics)
7. Skills Scripts (skills_add_script, skills_execute)
8. Adapter Pattern (testing abstraction)

---

## 1. LanceDB Vector Storage

### What It Does

Provides embedded vector storage for semantic search and pattern matching using LanceDB with Hugging Face transformers for embeddings.

**Location**: `src/storage.ts`, `src/embeddings.ts`

```typescript
// Our approach - zero external dependencies
import { LanceDBStorage } from "./storage";
const storage = await LanceDBStorage.create(".hive/vectors");
await storage.storePattern(pattern);
const similar = await storage.querySimilar(embedding, 5);
```

### Why We Added It

Upstream requires **Ollama** for semantic memory:
- External process that must be installed and running
- Requires `brew install ollama && ollama pull mxbai-embed-large`
- Falls back to full-text search if unavailable

We wanted:
- **Zero external dependencies** - everything runs in-process
- **No setup friction** - works immediately after npm install
- **Consistent behavior** - no fallback needed

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Dependencies | None | Ollama (external) |
| Setup | npm install | brew + ollama pull |
| Fallback | Not needed | Full-text search |
| Consistency | Always vector | Depends on Ollama |
| Storage | `.hive/vectors/` | Ollama service |

**Trade-offs**: 
- Our embeddings may be slightly lower quality than specialized Ollama models
- Hugging Face transformers add ~200MB to node_modules
- But: guaranteed to work in any environment

---

## 2. Mandate System

### What It Does

Automatically promotes observed patterns into enforced guidelines based on success rates. Mandates are "emergent rules" that arise from what works.

**Location**: `src/mandates.ts`, `src/mandate-storage.ts`, `src/mandate-promotion.ts`

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

### Lifecycle

```
CANDIDATE (new pattern, low confidence)
    │
    │  validated 3+ times
    ▼
ESTABLISHED (medium confidence)
    │
    │  10+ successes
    ▼
PROVEN (high confidence, used as guidance)
    │
    │  >60% failure rate
    ▼
DEPRECATED (auto-inverted to anti-pattern)
```

### Why We Added It

Upstream has pattern maturity and learning, but no **promotion to guidelines**. Their patterns inform but don't enforce.

We wanted:
- **Self-improving system** - successful patterns become rules
- **Automatic anti-patterns** - failures get deprecated
- **Confidence decay** - stale patterns fade (90-day half-life)
- **Observable evolution** - watch the system learn

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Pattern storage | LanceDB | Ollama + PGLite |
| Promotion | Automatic to guidelines | Weights only |
| Anti-patterns | Auto-inverted | Manual |
| Decay | 90-day half-life | 90-day half-life |
| Enforcement | Active guidance | Passive weighting |

**Trade-offs**:
- More complex lifecycle management
- Requires careful threshold tuning
- But: system genuinely improves over time

---

## 3. Single-Task Tracking

### What It Does

Provides lightweight tracking for single-agent tasks that don't need full hive decomposition. Supports emergent child tasks discovered during execution.

**Tools**: `hive_track_single`, `hive_spawn_child`

```typescript
// Track single-agent work (no epic, no subtasks)
const track = await hive_track_single({
  project_key: "$PWD",
  task_description: "Fix auth bug",
  files: ["src/auth.ts"],
});

// Discover emergent work during execution
await hive_spawn_child({
  parent_bead_id: track.bead_id,
  title: "Add auth tests",
  description: "Discovered missing coverage",
});
```

### Why We Added It

Upstream assumes every task needs decomposition. But many tasks are:
- Too small to decompose
- Single-agent work
- Exploratory (scope unclear upfront)

We wanted:
- **Lightweight option** - track without ceremony
- **Emergent discovery** - spawn children as needed
- **Full lineage** - parent-child relationships preserved
- **Gradual complexity** - escalate only when needed

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Entry point | hive_track_single | Always decompose |
| Minimum overhead | 1 tool call | Epic + subtasks |
| Emergent work | hive_spawn_child | Manual bead creation |
| Lineage | parent_bead_id tracking | thread_id only |

**Trade-offs**:
- Two tools vs one
- Slightly different mental model
- But: dramatically lower friction for simple tasks

---

## 4. Design Spec System

### What It Does

Human-in-the-loop design specifications with approval workflows. Agents write specs, humans approve before implementation.

**Tools**: `spec_write`, `spec_quick_write`, `spec_read`

**Location**: `src/spec.ts`, `src/schemas/spec.ts`

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

### Features

- **Gherkin-style scenarios** - Given/When/Then format
- **Requirement types** - must, should, could, won't
- **Confidence scoring** - agent's certainty about spec
- **Auto-approve option** - for routine/low-risk tasks
- **Human-in-the-loop** - approval gate before work starts

### Why We Added It

Upstream goes straight from decomposition to implementation. No pause for spec validation.

We wanted:
- **Pre-implementation validation** - catch misunderstandings early
- **Human oversight** - approve risky changes
- **Living documentation** - specs become artifacts
- **Testable requirements** - scenarios map to test cases

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Spec phase | Explicit spec tools | None |
| Human gate | Before implementation | Post-completion review |
| Requirements | Structured (must/should/could) | Free-form context |
| Scenarios | Gherkin format | N/A |
| Confidence | Explicit score | Implicit |

**Trade-offs**:
- Adds friction (intentionally)
- Requires human availability
- But: prevents expensive rework

---

## 5. Output Guardrails

### What It Does

Validates agent outputs before they're written, preventing harmful or low-quality content from reaching the codebase.

**Location**: `src/output-guardrails.ts`

### Validation Types

- **File path validation** - prevent writes outside allowed directories
- **Size limits** - reject overly large outputs
- **Content filtering** - block known problematic patterns
- **Rate limiting** - prevent output storms

### Why We Added It

Upstream trusts agent outputs directly. No validation layer.

We wanted:
- **Safety rails** - prevent accidental damage
- **Quality gates** - reject low-quality output
- **Observability** - log what's being written
- **Defense in depth** - multiple validation layers

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Path validation | Yes | File reservations only |
| Size limits | Configurable | None |
| Content filtering | Pattern-based | None |
| Rate limiting | Configurable | None |

**Trade-offs**:
- Slight performance overhead
- May block legitimate large files
- But: prevents category of failures

---

## 6. Eval Capture

### What It Does

Captures decomposition lifecycle data for analysis. Enables measuring how well decomposition strategies perform.

**Location**: `src/eval-capture.ts`

### Data Captured

- Decomposition inputs (task, strategy, context)
- Subtask definitions
- Execution outcomes per subtask
- Timing data
- Error counts

### Export Format

JSONL files for analysis with tools like:
- Custom Python scripts
- Evalite framework integration
- Data visualization

### Why We Added It

Upstream records outcomes but doesn't export for analysis.

We wanted:
- **Measurable improvement** - track decomposition quality over time
- **Strategy comparison** - which strategies work best for which tasks
- **Eval integration** - feed into evalite for scoring
- **Data-driven decisions** - evidence for strategy selection

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Capture | Full lifecycle | Outcome only |
| Export | JSONL | Database only |
| Analysis | External tools | N/A |
| Eval integration | Evalite | N/A |

**Trade-offs**:
- Storage overhead
- Requires external analysis
- But: enables continuous improvement

---

## 7. Skills Scripts

### What It Does

Allows skills to include executable scripts, not just documentation. Skills become active capabilities.

**Tools**: `skills_add_script`, `skills_execute`

```typescript
// Add a script to a skill
await skills_add_script({
  skill_name: "testing-patterns",
  script_name: "generate-snapshot.sh",
  content: "#!/bin/bash\njest --updateSnapshot",
  executable: true,
});

// Execute it
await skills_execute({
  skill_name: "testing-patterns",
  script_name: "generate-snapshot.sh",
  args: ["--testNamePattern", "MyComponent"],
});
```

### Why We Added It

Upstream skills are documentation-only (SKILL.md + references).

We wanted:
- **Active skills** - skills that do things
- **Reusable automation** - scripts shared across projects
- **Skill evolution** - skills grow beyond docs
- **Composition** - chain skill scripts together

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Skills content | Docs + scripts | Docs only |
| Execution | skills_execute | N/A |
| Script mgmt | skills_add_script | N/A |
| Tool count | 10 tools | 4 tools |

**Trade-offs**:
- Security considerations (running arbitrary scripts)
- More complex skill structure
- But: dramatically more powerful skills

---

## 8. Adapter Pattern

### What It Does

Provides a testing abstraction layer that allows mocking all external dependencies. Enables unit testing without real databases.

**Location**: `src/adapter.ts`, `src/types/adapter.ts`

```typescript
interface HiveAdapter {
  storage: StorageAdapter;
  mail: MailAdapter;
  beads: BeadsAdapter;
  // ...
}

// In tests
const mockAdapter = createMockAdapter();
const result = await someFunction(mockAdapter);

// In production
const realAdapter = createRealAdapter();
const result = await someFunction(realAdapter);
```

### Why We Added It

Upstream tests use real databases (PGLite), making tests:
- Slower
- Less isolated
- Dependent on database state

We wanted:
- **Fast tests** - mock all I/O
- **Isolated tests** - no shared state
- **Flexible tests** - control exact behavior
- **Clean architecture** - dependency injection

### Value Proposition vs Upstream

| Aspect | Our Approach | Upstream Approach |
|--------|--------------|-------------------|
| Test isolation | Full (via mocks) | Partial (real DB) |
| Test speed | Fast | Slower |
| Setup | None | Database setup |
| State | Controlled | Shared |

**Trade-offs**:
- Mock maintenance burden
- Risk of mock/real divergence
- But: faster development cycle

---

## Summary: Our Differentiation

### For Users

| Innovation | User Benefit |
|------------|--------------|
| LanceDB | Works anywhere, no setup |
| Mandates | System improves automatically |
| Single-task | Low friction for simple work |
| Spec system | Catch mistakes before coding |
| Guardrails | Safer agent outputs |

### For Developers

| Innovation | Developer Benefit |
|------------|-------------------|
| Eval capture | Measure and improve |
| Skills scripts | Active, reusable automation |
| Adapter pattern | Fast, isolated tests |

### Strategic Positioning

We're **not trying to replace upstream**. We're exploring innovations that might:
1. Prove valuable and get upstreamed
2. Serve different use cases
3. Validate architectural alternatives

Our unique innovations focus on:
- **Zero-dependency operation** (LanceDB vs Ollama)
- **Emergent behavior** (Mandates, single-task discovery)
- **Human-in-the-loop** (Spec system, guardrails)
- **Developer experience** (Adapter pattern, eval capture)

---

**Document Complete**  
**Generated**: December 19, 2025  
**Agent**: BoldForest  
**Bead**: opencode-swarm-plugin-8zm.4
