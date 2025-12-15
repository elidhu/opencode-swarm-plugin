# Coordinator Patterns

The coordinator is the orchestration layer that manages the swarm. This document covers the coordinator's responsibilities, decision points, and intervention patterns.

## Coordinator Responsibilities

### 1. Knowledge Gathering (BEFORE decomposition)

**MANDATORY**: Before decomposing any task, the coordinator MUST query all available knowledge sources:

```
# 1. Search semantic memory for past learnings
semantic-memory_find(query="<task keywords>", limit=5)

# 2. Search CASS for similar past tasks
cass_search(query="<task description>", limit=5)

# 3. Search pdf-brain for design patterns and prior art
pdf-brain_search(query="<domain concepts>", limit=5)

# 4. List available skills
skills_list()
```

**Why this matters:** From "Patterns for Building AI Agents":

> "AI agents, like people, make better decisions when they understand the full context rather than working from fragments."

The coordinator synthesizes findings into `shared_context` that all workers receive.

### 2. Task Decomposition

After knowledge gathering:

1. Select strategy (auto or explicit)
2. Generate decomposition with `hive_plan_prompt` or `hive_decompose`
3. Validate with `hive_validate_decomposition`
4. Create beads with `beads_create_epic`

### 3. Worker Spawning (with Checkpoint Recovery)

For each subtask:

1. **Check for existing checkpoint** - use `hive_recover` to see if a previous agent crashed
2. **Augment context with directives** - if checkpoint exists, add directives to shared_context
3. Generate worker prompt with `hive_spawn_subtask`
4. Include relevant skills in prompt
5. Spawn worker agent via Task tool
6. Track bead status

**Pattern: Recovery-First Spawning**

```typescript
for (const subtask of subtasks) {
  // 1. Check for checkpoint
  const recovery = await hive_recover({
    project_key: projectPath,
    epic_id: epicId,
    bead_id: subtask.id,
  });

  // 2. Build context with recovery directives
  let workerContext = synthesizedContext;
  
  if (!recovery.fresh_start && recovery.context) {
    console.log(`[coordinator] Resuming ${subtask.id} from ${recovery.context.progress_percent}%`);
    
    // Append directives to shared context
    if (recovery.context.directives?.length > 0) {
      workerContext += `\n\n## Recovery Context\n\n`;
      workerContext += `Previous agent (${recovery.context.agent_name}) left these notes:\n\n`;
      recovery.context.directives.forEach(d => {
        workerContext += `- ${d}\n`;
      });
    }
    
    // Inform about files already touched
    if (recovery.context.files_touched?.length > 0) {
      workerContext += `\nFiles modified so far: ${recovery.context.files_touched.join(', ')}\n`;
    }
  }

  // 3. Spawn with augmented context
  const prompt = await hive_spawn_subtask({
    bead_id: subtask.id,
    epic_id: epicId,
    subtask_title: subtask.title,
    subtask_description: subtask.description,
    files: subtask.files,
    shared_context: workerContext,
  });

  // 4. Spawn worker
  await Task({
    subagent_type: "swarm/worker",
    prompt: prompt.worker_prompt,
  });
}
```

**Why Recovery-First Matters:**

- Workers can crash due to context limits, timeouts, or tool failures
- Directives preserve critical discoveries ("API requires auth header", "DB migration needed")
- Progress tracking prevents duplicate work
- Compound context across attempts improves success rate

### 4. Progress Monitoring (with Checkpoint Visibility)

- Check `beads_query(status="in_progress")` for active work
- Check `hivemail_inbox()` for worker messages
- Intervene on blockers (see Intervention Patterns below)
- **NEW**: Use `hive_status()` to see checkpoint progress across epic

**Pattern: Checkpoint-Aware Monitoring**

```typescript
// Get epic-wide status including checkpoint milestones
const status = await hive_status({
  epic_id: epicId,
  project_key: projectPath,
});

// Check for stalled agents (progress not advancing)
for (const agent of status.agents) {
  if (agent.status === "running") {
    // Check last checkpoint
    const recovery = await hive_recover({
      project_key: projectPath,
      epic_id: epicId,
      bead_id: agent.bead_id,
    });
    
    if (!recovery.fresh_start && recovery.context) {
      const timeSinceCheckpoint = Date.now() - new Date(recovery.context.checkpointed_at).getTime();
      const minutesStalled = timeSinceCheckpoint / (1000 * 60);
      
      if (minutesStalled > 10) {
        console.log(`[coordinator] Agent ${agent.bead_id} may be stalled (${minutesStalled.toFixed(1)} min since checkpoint)`);
        // Consider intervention
      }
    }
  }
}
```

**Monitoring Heuristics:**

- No checkpoint in 10+ minutes → Likely stalled, check inbox
- Progress at same milestone for 15+ minutes → Likely blocked
- Multiple checkpoints with same progress_percent → Retry loop detected

### 5. Completion & Aggregation

- Verify all subtasks completed via bead status
- Aggregate results from worker summaries
- Run final verification (typecheck, tests)
- Close epic bead with summary

---

## Checkpoint & Recovery Patterns

### Auto-Checkpoint (Built-in)

The system **automatically checkpoints at 25%, 50%, and 75% progress** when workers call `hive_progress`. This is:

- **Non-blocking**: Fire-and-forget, doesn't slow down workers
- **Dual-write**: Writes to event stream (audit) + table (fast queries)
- **Milestone-based**: Only triggers when crossing milestone boundaries

**Coordinators don't need to do anything** - auto-checkpoint just works.

### Manual Checkpoint (Directive Sharing)

Workers should use `hive_checkpoint` when they need to share critical context:

```typescript
// Worker discovers important context mid-task
hive_checkpoint({
  project_key: projectPath,
  agent_name: "worker-db",
  epic_id: epicId,
  bead_id: beadId,
  task_description: "Database migration",
  files: ["src/db/migrations/*.ts"],
  strategy: "risk-based",
  progress_percent: 45,
  files_touched: ["src/db/migrations/001_users.ts"],
  directives: [
    "Migration requires DB downtime - coordinate with ops",
    "Foreign key constraints must be added AFTER data migration",
    "Use transaction wrapping - migration can't be partially applied",
  ],
});
```

**Coordinator role**: When spawning a replacement worker, check for checkpoint and inject directives into shared_context.

### Recovery Flow (Crash Handling)

**Scenario**: A worker crashes mid-task (context overflow, timeout, tool failure).

**Coordinator response:**

1. Detect crash (bead still "in_progress" but no recent progress)
2. Spawn replacement worker
3. **Before spawning**, check for checkpoint:

```typescript
const recovery = await hive_recover({
  project_key: projectPath,
  epic_id: epicId,
  bead_id: crashedBeadId,
});

if (!recovery.fresh_start) {
  // Checkpoint exists - augment context with recovery data
  let recoveryNotes = `\n\n## RECOVERY MODE\n\n`;
  recoveryNotes += `Previous agent reached ${recovery.context.progress_percent}% before crashing.\n\n`;
  
  if (recovery.context.directives) {
    recoveryNotes += `**Critical notes from previous agent:**\n\n`;
    recovery.context.directives.forEach(d => {
      recoveryNotes += `- ${d}\n`;
    });
  }
  
  if (recovery.context.files_touched) {
    recoveryNotes += `\n**Files already modified:**\n${recovery.context.files_touched.map(f => `- \`${f}\``).join('\n')}\n`;
  }
  
  sharedContext += recoveryNotes;
}
```

4. Spawn replacement with augmented context
5. New worker reads recovery context and continues from checkpoint

**This pattern compounds knowledge** - each attempt builds on previous failures.

### Directive Propagation

Directives can flow in multiple directions:

**1. Same-bead recovery** (worker crashes, new worker resumes)

```
Worker A (crashed) → Checkpoint with directives → Worker B (resumes)
```

**2. Cross-bead coordination** (coordinator broadcasts directives)

```
Worker A → Checkpoint with directives → Coordinator reads → Broadcasts to Workers B, C, D
```

**3. Dependent-bead handoff** (sequential dependencies)

```
Worker A completes → Checkpoint with directives → Coordinator → Worker B (depends on A) gets directives
```

**Coordinator responsibility**: Actively query checkpoints and propagate relevant directives across related beads.

---

## Decision Points

### When to Hive vs Single Agent

**Hive when:**

- 3+ files need modification
- Task has natural parallel boundaries
- Different specializations needed (frontend/backend/tests)
- Time-to-completion matters

**Single agent when:**

- Task touches 1-2 files
- Heavy sequential dependencies
- Coordination overhead > parallelization benefit
- Task requires tight feedback loop

**Heuristic:** If you can describe the task in one sentence without "and", probably single agent.

### When to Intervene

| Signal                    | Action                                                |
| ------------------------- | ----------------------------------------------------- |
| Worker blocked >5 min     | Check inbox, offer guidance                           |
| File conflict detected    | Mediate, reassign files                               |
| Worker asking questions   | Answer directly, don't spawn new agent                |
| Scope creep detected      | Redirect to original task, create new bead for extras |
| Worker failing repeatedly | Take over subtask or reassign                         |

### When to Abort

- Critical blocker affects all subtasks
- Scope changed fundamentally mid-swarm
- Resource exhaustion (context, time, cost)

On abort: Close all beads with reason, summarize partial progress.

---

## Eval Capture Integration

The `hive_validate_decomposition` tool has optional eval capture for metrics analysis:

```typescript
hive_validate_decomposition({
  response: beadTreeJson,
  capture_eval: true, // Optional: captures for metrics
});
```

**When to use capture_eval:**

- **DO use** when testing new decomposition strategies
- **DO use** for learning/improvement cycles
- **DON'T use** for production swarms (overhead)
- **DON'T use** when you need fast validation

**What gets captured:**

- Decomposition response (BeadTree JSON)
- Validation result (pass/fail)
- Criteria scores (if available)
- Timestamp and metadata

**Coordinator action:** None required. Capture happens automatically if flag is set. Data is stored for later analysis via eval tooling.

**Note:** This is a passive feature - coordinators don't need to interact with captured data during swarm execution.

---

## Context Engineering

From "Patterns for Building AI Agents":

> "Instead of just instructing subagents 'Do this specific task,' you should try to ensure they are able to share context along the way."

### Shared Context Template

```markdown
## Project Context

- Repository: {repo_name}
- Tech stack: {stack}
- Relevant patterns: {patterns from pdf-brain}

## Task Context

- Epic: {epic_title}
- Goal: {what success looks like}
- Constraints: {time, scope, dependencies}

## Prior Art

- Similar past tasks: {from CASS}
- Relevant learnings: {from semantic-memory}

## Coordination

- Other active subtasks: {list}
- Shared files to avoid: {reserved files}
- Communication channel: thread_id={epic_id}
```

### Context Compression

For long-running swarms, compress context periodically:

- Summarize completed subtasks (don't list all details)
- Keep only active blockers and decisions
- Preserve key learnings for remaining work

---

## Failure Modes & Recovery

### Incompatible Parallel Outputs

**Problem:** Two agents produce conflicting results that can't be merged.

**From "Patterns for Building AI Agents":**

> "Subagents can create responses that are in conflict — forcing the final agent to combine two incompatible, intermediate products."

**Prevention:**

- Clear file boundaries (no overlap)
- Explicit interface contracts in shared_context
- Sequential phases for tightly coupled work

**Recovery:**

- Identify conflict source
- Pick one approach, discard other
- Re-run losing subtask with winning approach as constraint

### Worker Drift

**Problem:** Worker goes off-task, implements something different.

**Prevention:**

- Specific, actionable subtask descriptions
- Clear success criteria in prompt
- File list as hard constraint

**Recovery:**

- Revert changes
- Re-run with more explicit instructions
- **NEW**: Check checkpoint for clues about why drift occurred
- Consider taking over manually

**Pattern: Checkpoint-Guided Recovery**

```typescript
// Worker drifted - check checkpoint for context
const recovery = await hive_recover({
  project_key: projectPath,
  epic_id: epicId,
  bead_id: driftedBeadId,
});

if (!recovery.fresh_start && recovery.context) {
  // Analyze directives to understand why drift happened
  const directives = recovery.context.directives || [];
  
  // Did worker discover a blocker and try to work around it?
  const blockerDirectives = directives.filter(d => 
    d.includes("blocked") || d.includes("can't") || d.includes("missing")
  );
  
  if (blockerDirectives.length > 0) {
    console.log("[coordinator] Worker may have drifted due to blocker:");
    blockerDirectives.forEach(d => console.log(`  - ${d}`));
    // Unblock, then respawn with clear constraint
  }
}
```

### Cascade Failure

**Problem:** One failure blocks multiple dependent subtasks.

**Prevention:**

- Minimize dependencies in decomposition
- Front-load risky/uncertain work
- Have fallback plans for critical paths

**Recovery:**

- Unblock manually if possible
- Reassign dependent work
- Partial completion is okay - close what's done
- **NEW**: Use checkpoints to preserve partial progress across dependent beads

**Pattern: Checkpoint-Preserved Partial Progress**

```typescript
// Worker A blocked at 60% - affects Workers B, C
const recoveryA = await hive_recover({
  project_key: projectPath,
  epic_id: epicId,
  bead_id: beadA,
});

if (!recoveryA.fresh_start && recoveryA.context) {
  // Extract what WAS completed before blocker
  const completed = recoveryA.context.files_touched || [];
  const blockerNote = recoveryA.context.directives?.find(d => 
    d.includes("blocked") || d.includes("can't proceed")
  );
  
  // Inform dependent workers about partial state
  const partialContext = `
## Partial Upstream State

Worker A (${beadA}) is blocked but completed:
${completed.map(f => `- ${f}`).join('\n')}

Blocker: ${blockerNote || "Unknown"}

You may need to work around this or wait for resolution.
  `;
  
  // Spawn dependent workers with partial context
  // They can decide if they can proceed or also need to block
}
```

**Key insight:** Checkpoints let you extract useful partial work even from blocked tasks, reducing cascade impact.

---

## Anti-Patterns

### The Mega-Coordinator

**Problem:** Coordinator does too much work itself instead of delegating.

**Symptom:** Coordinator editing files, running tests, debugging.

**Fix:** Coordinator only orchestrates. If you're writing code, you're a worker.

### The Silent Hive

**Problem:** Workers don't communicate, coordinator doesn't monitor.

**Symptom:** Hive runs for 30 minutes, then fails with conflicts.

**Fix:** Require progress updates. Check inbox regularly. Intervene early.

### The Over-Decomposed Task

**Problem:** 10 subtasks for a 20-line change.

**Symptom:** Coordination overhead exceeds actual work.

**Fix:** 2-5 subtasks is the sweet spot. If task is small, don't swarm.

### The Under-Specified Subtask

**Problem:** "Implement the backend" with no details.

**Symptom:** Worker asks questions, guesses wrong, or stalls.

**Fix:** Each subtask needs: clear goal, file list, success criteria, context.
