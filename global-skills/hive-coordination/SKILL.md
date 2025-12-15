---
name: hive-coordination
description: Multi-agent coordination patterns for OpenCode swarm workflows. Use when working on complex tasks that benefit from parallelization, when coordinating multiple agents, or when managing task decomposition. Do NOT use for simple single-agent tasks.
tags:
  - swarm
  - multi-agent
  - coordination
tools:
  - hive_plan_prompt
  - hive_decompose
  - hive_validate_decomposition
  - hive_spawn_subtask
  - hive_complete
  - hive_status
  - hive_progress
  - hive_checkpoint
  - hive_recover
  - beads_create_epic
  - beads_query
  - hivemail_init
  - hivemail_send
  - hivemail_inbox
  - hivemail_read_message
  - hivemail_reserve
  - hivemail_release
  - hivemail_health
  - cass_search
  - pdf-brain_search
  - skills_list
references:
  - references/strategies.md
  - references/coordinator-patterns.md
---

# Hive Coordination

Multi-agent orchestration for parallel task execution. The coordinator breaks work into subtasks, spawns worker agents, monitors progress, and aggregates results.

## MANDATORY: Hive Mail

**ALL coordination MUST use `hivemail_*` tools.** This is non-negotiable.

Hive Mail is embedded (no external server needed) and provides:

- File reservations to prevent conflicts
- Message passing between agents
- Thread-based coordination tied to beads

## When to Hive

**DO swarm when:**

- Task touches 3+ files
- Natural parallel boundaries exist (frontend/backend/tests)
- Different specializations needed
- Time-to-completion matters

**DON'T swarm when:**

- Task is 1-2 files
- Heavy sequential dependencies
- Coordination overhead > benefit
- Tight feedback loop needed

**Heuristic:** If you can describe the task in one sentence without "and", don't swarm.

## Task Clarity Check (BEFORE Decomposing)

**Before decomposing, ask: Is this task clear enough to parallelize?**

### Vague Task Signals (ASK QUESTIONS FIRST)

| Signal                   | Example                        | Problem                          |
| ------------------------ | ------------------------------ | -------------------------------- |
| No files mentioned       | "improve performance"          | Where? Which files?              |
| Vague verbs              | "fix", "update", "make better" | What specifically?               |
| Large undefined scope    | "refactor the codebase"        | Which parts? What pattern?       |
| Missing success criteria | "add auth"                     | OAuth? JWT? Session? What flows? |
| Ambiguous boundaries     | "handle errors"                | Which errors? Where? How?        |

### How to Clarify

```markdown
The task "<task>" needs clarification before I can decompose it.

**Question:** [Specific question about scope/files/approach]

Options:
a) [Option A] - [trade-off]
b) [Option B] - [trade-off]
c) [Option C] - [trade-off]

I'd recommend (a) because [reason]. Which approach?
```

**Rules:**

- ONE question at a time (don't overwhelm)
- Offer 2-3 concrete options when possible
- Lead with your recommendation and why
- Wait for answer before asking next question

### Clear Task Signals (PROCEED to decompose)

| Signal             | Example                        | Why it's clear   |
| ------------------ | ------------------------------ | ---------------- |
| Specific files     | "update src/auth/\*.ts"        | Scope defined    |
| Concrete verbs     | "migrate from X to Y"          | Action defined   |
| Defined scope      | "the payment module"           | Boundaries clear |
| Measurable outcome | "tests pass", "no type errors" | Success criteria |

**When in doubt, ask.** A 30-second clarification beats a 30-minute wrong decomposition.

## Coordinator Workflow

### Phase 1: Initialize Hive Mail (FIRST)

```typescript
// ALWAYS initialize first - registers you as coordinator
await hivemail_init({
  project_path: "$PWD",
  task_description: "Hive: <task summary>",
});
```

### Phase 2: Knowledge Gathering (MANDATORY)

Before decomposing, query external knowledge sources and let semantic memory work automatically:

```typescript
// 1. Past learnings from this project (AUTOMATIC)
// Semantic memory queries happen automatically during hive_plan_prompt
// LanceDB queries .hive/vectors/patterns.lance for similar tasks
// No manual semantic_memory_find calls needed

// 2. How similar tasks were solved before
cass_search({ query: "<task description>", limit: 5 });

// 3. Design patterns and prior art
pdf_brain_search({ query: "<domain concepts>", limit: 5 });

// 4. Available skills to inject into workers
skills_list();
```

**Semantic Memory is ALWAYS Active:** The `hive_plan_prompt` tool automatically:
- Queries LanceDB for similar past tasks
- Includes proven patterns in context
- Excludes anti-patterns (3-strike failures)
- Returns `memory_queried: true, patterns_found: N` in response

Synthesize external findings (CASS, PDF Brain) into `shared_context` for workers.

### Phase 3: Decomposition (DELEGATE TO SUBAGENT)

> **⚠️ CRITICAL: Context Preservation Pattern**
>
> **NEVER do planning inline in the coordinator thread.** Decomposition work (file reading, CASS searching, reasoning about task breakdown) consumes massive amounts of context and will exhaust your token budget on long swarms.
>
> **ALWAYS delegate planning to a `swarm/planner` subagent** and receive only the structured BeadTree JSON result back.

**❌ Anti-Pattern (Context-Heavy):**

```typescript
// DON'T DO THIS - pollutes main thread context
const plan = await hive_plan_prompt({ task, ... });
// ... agent reasons about decomposition inline ...
// ... context fills with file contents, analysis ...
const validation = await hive_validate_decomposition({ ... });
```

**✅ Correct Pattern (Context-Lean):**

```typescript
// 1. Create planning bead with full context
await beads_create({
  title: `Plan: ${taskTitle}`,
  type: "task",
  description: `Decompose into subtasks. Context: ${synthesizedContext}`,
});

// 2. Delegate to swarm/planner subagent
const planningResult = await Task({
  subagent_type: "swarm/planner",
  description: `Decompose task: ${taskTitle}`,
  prompt: `
You are a swarm planner. Generate a BeadTree for this task.

## Task
${taskDescription}

## Synthesized Context
${synthesizedContext}

## Instructions
1. Use hive_plan_prompt(task="...", max_subtasks=5, query_cass=true)
2. Reason about decomposition strategy
3. Generate BeadTree JSON
4. Validate with hive_validate_decomposition
5. Return ONLY the validated BeadTree JSON (no analysis, no file contents)

Output format: Valid BeadTree JSON only.
  `,
});

// 3. Parse result (subagent already validated)
const beadTree = JSON.parse(planningResult);

// 4. Create epic + subtasks atomically
await beads_create_epic({
  epic_title: beadTree.epic.title,
  epic_description: beadTree.epic.description,
  subtasks: beadTree.subtasks,
});
```

**Why This Matters:**

- **Main thread context stays clean** - only receives final JSON, not reasoning
- **Subagent context is disposable** - gets garbage collected after planning
- **Scales to long swarms** - coordinator can manage 10+ workers without exhaustion
- **Faster coordination** - less context = faster responses when monitoring workers

### Phase 4: Reserve Files (via Hive Mail)

```typescript
// Reserve files for each subtask BEFORE spawning workers
await hivemail_reserve({
  paths: ["src/auth/**"],
  reason: "bd-123: Auth service implementation",
  ttl_seconds: 3600,
  exclusive: true,
});
```

**Rules:**

- No file overlap between subtasks
- Coordinator mediates conflicts
- `hive_complete` auto-releases

### Phase 5: Spawn Workers (with Recovery Support)

```typescript
for (const subtask of subtasks) {
  // Check if checkpoint exists for this bead (crashed worker scenario)
  const recovery = await hive_recover({
    project_key: "$PWD",
    epic_id: epic.id,
    bead_id: subtask.id,
  });

  let workerContext = synthesizedContext;
  
  // If checkpoint exists, augment context with directives
  if (!recovery.fresh_start && recovery.context) {
    console.log(`[coordinator] Found checkpoint for ${subtask.id} - resuming from ${recovery.context.progress_percent}%`);
    
    if (recovery.context.directives && recovery.context.directives.length > 0) {
      workerContext += `\n\n## Recovery Context\n\nPrevious agent left these directives:\n${recovery.context.directives.map(d => `- ${d}`).join('\n')}`;
    }
  }

  const prompt = await hive_spawn_subtask({
    bead_id: subtask.id,
    epic_id: epic.id,
    subtask_title: subtask.title,
    subtask_description: subtask.description,
    files: subtask.files,
    shared_context: workerContext, // Augmented with recovery directives
  });

  // Spawn via Task tool
  Task({
    subagent_type: "swarm/worker",
    prompt: prompt.worker_prompt,
  });
}
```

**Checkpoint-aware spawning ensures:**

- Crashed workers can be resumed
- Directives propagate from failed agent to new agent
- Progress isn't lost on crashes
- Context compounds across attempts

### Phase 6: Monitor & Intervene

```typescript
// Check progress
const status = await hive_status({ epic_id, project_key });

// Check for messages from workers
const inbox = await hivemail_inbox({ limit: 5 });

// Read specific message if needed
const message = await hivemail_read_message({ message_id: N });

// Intervene if needed (see Intervention Patterns)
```

### Phase 7: Aggregate & Complete

- Verify all subtasks completed
- Run final verification (typecheck, tests)
- Close epic with summary
- Release any remaining reservations
- Record outcomes for learning (automatic)

```typescript
await hive_complete({
  project_key: "$PWD",
  agent_name: "coordinator",
  bead_id: epic_id,
  summary: "All subtasks complete. Split by feature into 4 parallel tasks.",
  files_touched: [...],
});
// Tool automatically:
// - Extracts patterns from summary ("Split by feature", "4 parallel tasks")
// - Generates embeddings with Transformers.js
// - Stores to LanceDB at .hive/vectors/patterns.lance
// - Returns: { ...result, memory_stored: true }

await hivemail_release(); // Release any remaining reservations
await beads_sync();
```

**Automatic Pattern Learning:** When workers call `hive_complete`:
- Successful patterns automatically stored to semantic memory
- Failed patterns tracked with failure counts
- 3rd failure triggers automatic anti-pattern creation
- Anti-patterns stored with `is_negative: true` flag
- Future decompositions automatically exclude anti-patterns

## Worker Best Practices

Workers execute subtasks assigned by the coordinator. Follow this pattern:

### Worker Initialization (MANDATORY)

```typescript
// 1. Initialize Hive Mail FIRST
hivemail_init({ 
  project_path: "$PWD", 
  agent_name: "worker-auth-service" 
});

// 2. Check for recovery context IMMEDIATELY
const recovery = hive_recover({
  project_key: "$PWD",
  epic_id: "<epic_id from prompt>",
  bead_id: "<bead_id from prompt>",
});

// 3. Resume or start fresh
if (recovery.fresh_start) {
  // No checkpoint - start normally
  console.log("Starting fresh");
} else {
  // Checkpoint exists - resume
  console.log(`Resuming from ${recovery.context.progress_percent}%`);
  
  // Read directives from previous attempt
  if (recovery.context.directives) {
    console.log("Previous agent's notes:");
    recovery.context.directives.forEach(d => console.log(`- ${d}`));
  }
  
  // Use files_touched to understand what's done
  const alreadyDone = recovery.context.files_touched || [];
}
```

### Progress Reporting

**Use `hive_progress` for regular updates** (auto-checkpoints at milestones):

```typescript
// Report progress (auto-checkpoint at 25/50/75%)
hive_progress({
  project_key: "$PWD",
  agent_name: "worker-auth-service",
  bead_id: "bd-abc123.1",
  status: "in_progress",
  progress_percent: 50,
  message: "Completed service implementation, starting middleware",
  files_touched: ["src/auth/service.ts"],
});
```

**Use `hive_checkpoint` for critical moments**:

```typescript
// Before risky operation
hive_checkpoint({
  project_key: "$PWD",
  agent_name: "worker-auth-service",
  epic_id: "bd-abc123",
  bead_id: "bd-abc123.1",
  task_description: "Auth service implementation",
  files: ["src/auth/*.ts"],
  strategy: "feature-based",
  progress_percent: 60,
  files_touched: ["src/auth/service.ts", "src/auth/middleware.ts"],
  directives: [
    "JWT secret must be 32+ chars",
    "Token expiry is configurable via AUTH_TOKEN_TTL env var",
  ],
});

// ... risky operation ...
```

### Communication

```typescript
// Report blocker
hivemail_send({
  to: ["coordinator"],
  subject: "BLOCKED: Need DB schema",
  body: "Can't proceed without users table migration",
  thread_id: epic_id,
  importance: "urgent",
});

// Broadcast discovery to other workers
hive_broadcast({
  project_path: "$PWD",
  agent_name: "worker-auth-service",
  epic_id: epic_id,
  message: "Found rate limiting on auth endpoint - use exponential backoff",
  importance: "warning",
  files_affected: ["src/auth/client.ts"],
});
```

### Completion

```typescript
// Complete with verification
hive_complete({
  project_key: "$PWD",
  agent_name: "worker-auth-service",
  bead_id: "bd-abc123.1",
  summary: "Auth service complete with JWT validation middleware",
  files_touched: [
    "src/auth/service.ts",
    "src/auth/middleware.ts",
    "src/auth/types.ts",
  ],
  // Verification Gate runs: typecheck + tests
  // Set skip_verification: true only if absolutely needed
});
```

**Worker mantra**: Check recovery → Report progress → Checkpoint discoveries → Complete with verification.

## Decomposition Strategies

Four strategies, auto-selected by task keywords:

| Strategy           | Best For                      | Keywords                              |
| ------------------ | ----------------------------- | ------------------------------------- |
| **file-based**     | Refactoring, migrations       | refactor, migrate, rename, update all |
| **feature-based**  | New features, vertical slices | add, implement, build, create         |
| **risk-based**     | Bug fixes, security           | fix, bug, security, critical          |
| **research-based** | Investigation, discovery      | research, investigate, explore        |

See `references/strategies.md` for full details.

## Communication Protocol

Workers communicate via Hive Mail with epic ID as thread:

```typescript
// Progress update
hivemail_send({
  to: ["coordinator"],
  subject: "Auth API complete",
  body: "Endpoints ready at /api/auth/*",
  thread_id: epic_id,
});

// Blocker
hivemail_send({
  to: ["coordinator"],
  subject: "BLOCKED: Need DB schema",
  body: "Can't proceed without users table",
  thread_id: epic_id,
  importance: "urgent",
});
```

**Coordinator checks inbox regularly** - don't let workers spin.

## Intervention Patterns

| Signal                  | Action                               |
| ----------------------- | ------------------------------------ |
| Worker blocked >5 min   | Check inbox, offer guidance          |
| File conflict           | Mediate, reassign files              |
| Worker asking questions | Answer directly                      |
| Scope creep             | Redirect, create new bead for extras |
| Repeated failures       | Take over or reassign                |

## Failure Recovery

### Incompatible Outputs

Two workers produce conflicting results.

**Fix:** Pick one approach, re-run other with constraint.

### Worker Drift

Worker implements something different than asked.

**Fix:** Revert, re-run with explicit instructions.

### Cascade Failure

One blocker affects multiple subtasks.

**Fix:** Unblock manually, reassign dependent work, accept partial completion.

## Anti-Patterns

| Anti-Pattern                | Symptom                                    | Fix                                  |
| --------------------------- | ------------------------------------------ | ------------------------------------ |
| **Decomposing Vague Tasks** | Wrong subtasks, wasted agent cycles        | Ask clarifying questions FIRST       |
| **Mega-Coordinator**        | Coordinator editing files                  | Coordinator only orchestrates        |
| **Silent Hive**            | No communication, late conflicts           | Require updates, check inbox         |
| **Over-Decomposed**         | 10 subtasks for 20 lines                   | 2-5 subtasks max                     |
| **Under-Specified**         | "Implement backend"                        | Clear goal, files, criteria          |
| **Inline Planning** ⚠️      | Context pollution, exhaustion on long runs | Delegate planning to subagent        |
| **Heavy File Reading**      | Coordinator reading 10+ files              | Subagent reads, returns summary only |
| **Deep CASS Drilling**      | Multiple cass_search calls inline          | Subagent searches, summarizes        |
| **Manual Decomposition**    | Hand-crafting subtasks without validation  | Use hive_plan_prompt + validation   |
| **Checkpoint Spam** ⚠️      | Manual checkpoint every 5 minutes          | Trust auto-checkpoint at milestones  |
| **Recovery Amnesia**        | Starting fresh without checking recovery   | ALWAYS hive_recover before starting  |
| **Empty Directives**        | Checkpoints with no useful context         | Only checkpoint with valuable notes  |

## Shared Context Template

```markdown
## Project Context

- Repository: {repo}
- Stack: {tech stack}
- Patterns: {from pdf-brain}

## Task Context

- Epic: {title}
- Goal: {success criteria}
- Constraints: {scope, time}

## Prior Art

- Similar tasks: {from CASS}
- Learnings: {from semantic-memory}

## Coordination

- Active subtasks: {list}
- Reserved files: {list}
- Thread: {epic_id}
```

## Checkpoint & Recovery

**Auto-checkpointing is ALWAYS enabled.** The system automatically saves your progress at 25%, 50%, and 75% completion milestones via `hive_progress`. You don't need to checkpoint manually unless you have specific context to share.

### When to Manual Checkpoint

Use `hive_checkpoint` when:

- **Before risky operations**: Database migrations, large refactors, external API calls
- **Sharing discoveries**: Found an API gotcha, identified a critical pattern
- **Cross-agent coordination**: Discovered something other agents need to know

**Don't checkpoint for**: Regular progress updates (use `hive_progress`), routine file saves, or normal task flow.

### Using hive_checkpoint

```typescript
// Manual checkpoint with directives for other agents
hive_checkpoint({
  project_key: "$PWD",
  agent_name: "worker-1",
  epic_id: "bd-abc123",
  bead_id: "bd-abc123.1",
  task_description: "Implement auth service",
  files: ["src/auth/*.ts"],
  strategy: "feature-based",
  progress_percent: 60,
  files_touched: ["src/auth/service.ts", "src/auth/middleware.ts"],
  directives: [
    "API requires Bearer token in Authorization header",
    "JWT validation happens in middleware, not service layer",
    "Don't use bcrypt directly - use auth.hashPassword() helper",
  ],
});
```

**Directives are gold**: Use them to pass critical context to agents who resume your work or pick up related tasks.

### Recovery After Crash

**ALWAYS check for recovery first** when starting work on a bead:

```typescript
// Step 1: Try to recover
const recovery = hive_recover({
  project_key: "$PWD",
  epic_id: "bd-abc123",
  bead_id: "bd-abc123.1",
});

// Step 2: Handle result
if (recovery.fresh_start) {
  // No checkpoint - start from scratch
  console.log("Starting fresh - no previous checkpoint");
} else if (recovery.context) {
  // Checkpoint found - resume from there
  console.log(`Resuming from ${recovery.context.progress_percent}%`);
  console.log(`Last milestone: ${recovery.context.last_milestone}`);
  
  // Read directives from previous agent
  if (recovery.context.directives?.length > 0) {
    console.log("Previous agent left these notes:");
    recovery.context.directives.forEach(d => console.log(`- ${d}`));
  }
  
  // Resume work with context
  const filesToucheSoFar = recovery.context.files_touched || [];
  // Continue from where they left off...
}
```

### Sharing Directives Between Agents

Directives let you pass knowledge to future agents working on:

- **Same bead** (after crash/reassignment)
- **Related beads** (coordinator can propagate)
- **Dependent beads** (via coordinator)

**Good directives:**

- ✅ "Database requires transaction wrapping for bulk updates"
- ✅ "API rate limit is 100 req/min - use exponential backoff"
- ✅ "Tests require TEST_API_KEY env var to be set"

**Bad directives:**

- ❌ "Made progress" (too vague)
- ❌ "Fixed some stuff" (no actionable info)
- ❌ "Check the code" (defeats the purpose)

**Rule of thumb**: If you crashed right now, what would you want the next agent to know?

## Hive Mail Quick Reference

| Tool                     | Purpose                             |
| ------------------------ | ----------------------------------- |
| `hivemail_init`         | Initialize session (REQUIRED FIRST) |
| `hivemail_send`         | Send message to agents              |
| `hivemail_inbox`        | Check inbox (max 5, no bodies)      |
| `hivemail_read_message` | Read specific message body          |
| `hivemail_reserve`      | Reserve files for exclusive editing |
| `hivemail_release`      | Release file reservations           |
| `hivemail_ack`          | Acknowledge message                 |
| `hivemail_health`       | Check database health               |

## Checkpoint Quick Reference

| Tool                | Purpose                                           |
| ------------------- | ------------------------------------------------- |
| `hive_checkpoint`   | Manual checkpoint (for directives or risky work)  |
| `hive_recover`      | Check for previous checkpoint, resume from there  |
| Auto-checkpoint     | Happens automatically at 25%, 50%, 75% milestones |

## Full Hive Flow (Coordinator)

```typescript
// 1. Initialize Hive Mail FIRST
hivemail_init({ project_path: "$PWD", task_description: "..." });

// 2. Gather knowledge (semantic memory automatic)
// NO semantic_memory_find needed - hive_plan_prompt queries automatically
cass_search({ query });
pdf_brain_search({ query });
skills_list();

// 3. Decompose (queries semantic memory automatically)
const plan = hive_plan_prompt({ task });
// Returns: { ...prompt, memory_queried: true, patterns_found: 5 }
hive_validate_decomposition();
beads_create_epic();

// 4. Reserve files
hivemail_reserve({ paths, reason, ttl_seconds });

// 5. Spawn workers (with recovery support)
for (const subtask of subtasks) {
  // Check for checkpoint (crashed worker scenario)
  const recovery = hive_recover({ 
    project_key: "$PWD", 
    epic_id, 
    bead_id: subtask.id 
  });
  
  // Augment context with recovery directives if present
  let context = synthesizedContext;
  if (!recovery.fresh_start && recovery.context?.directives) {
    context += `\n\n## Recovery: ${recovery.context.directives.join('; ')}`;
  }
  
  hive_spawn_subtask({ ..., shared_context: context });
}

// 6. Monitor
hive_status();
hivemail_inbox();
hivemail_read_message({ message_id });

// 7. Complete (stores to semantic memory automatically)
const result = hive_complete();
// Returns: { ...result, memory_stored: true }
hivemail_release();
beads_sync();

// Checkpoint operations:
// - Auto-checkpoint: Happens at 25/50/75% via hive_progress
// - Manual checkpoint: Use hive_checkpoint for directives
// - Recovery: Always check hive_recover when spawning workers
```

## Full Worker Flow

```typescript
// 1. Initialize
hivemail_init({ project_path: "$PWD", agent_name: "worker-X" });

// 2. Check for recovery FIRST
const recovery = hive_recover({ 
  project_key: "$PWD", 
  epic_id, 
  bead_id 
});

if (!recovery.fresh_start) {
  // Resume from checkpoint
  console.log(`Resuming from ${recovery.context.progress_percent}%`);
  // Read directives, files_touched, etc.
}

// 3. Execute work
// ... do the task ...

// 4. Report progress (auto-checkpoint at milestones)
hive_progress({ 
  ..., 
  progress_percent: 50, 
  files_touched: [...] 
});

// 5. Manual checkpoint if needed
hive_checkpoint({ 
  ..., 
  directives: ["Important context for next agent"] 
});

// 6. Complete with verification
hive_complete({ 
  ..., 
  files_touched: [...] 
  // Verification Gate runs automatically
});

// Semantic memory operations:
// - During decomposition: Queries .hive/vectors/patterns.lance
// - During completion: Stores successful patterns with embeddings
// - 3-strike failures: Auto-creates anti-patterns
// - All via LanceDB + Transformers.js (bundled, no external deps)
```

See `references/coordinator-patterns.md` for detailed patterns.

## ASCII Art, Whimsy & Diagrams (MANDATORY)

**We fucking LOVE visual flair.** Every swarm session should include:

### Session Summaries

When completing a swarm, output a beautiful summary with:

- ASCII art banner (figlet-style or custom)
- Box-drawing characters for structure
- Architecture diagrams showing what was built
- Stats (files modified, subtasks completed, etc.)
- A memorable quote or cow saying "ship it"

### During Coordination

- Use tables for status updates
- Draw dependency trees with box characters
- Show progress with visual indicators

### Examples

**Session Complete Banner:**

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃         🐝 SWARM COMPLETE 🐝                 ┃
┃                                              ┃
┃   Epic: Add Authentication                   ┃
┃   Subtasks: 4/4 ✓                            ┃
┃   Files: 12 modified                         ┃
┃                                              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

**Architecture Diagram:**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   INPUT     │────▶│  PROCESS    │────▶│   OUTPUT    │
└─────────────┘     └─────────────┘     └─────────────┘
```

**Dependency Tree:**

```
epic-123
├── epic-123.1 ✓ Auth service
├── epic-123.2 ✓ Database schema
├── epic-123.3 ◐ API routes (in progress)
└── epic-123.4 ○ Tests (pending)
```

**Ship It:**

```
    \   ^__^
     \  (oo)\_______
        (__)\       )\/\
            ||----w |
            ||     ||

    moo. ship it.
```

**This is not optional.** PRs get shared on Twitter. Session summaries get screenshot. Make them memorable. Make them beautiful. Make them fun.

Box-drawing characters: `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ━ ┃ ┏ ┓ ┗ ┛`
Progress indicators: `✓ ✗ ◐ ○ ● ▶ ▷ ★ ☆ 🐝`
