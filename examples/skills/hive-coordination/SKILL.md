---
name: hive-coordination
description: Multi-agent coordination patterns for OpenCode swarm workflows. Use when working on complex tasks that benefit from parallelization, when coordinating multiple agents, or when managing task decomposition. Do NOT use for simple single-agent tasks.
tags:
  - swarm
  - multi-agent
  - coordination
tools:
  - hive_decompose
  - hive_complete
  - hivemail_init
  - hivemail_send
  - hivemail_inbox
  - hivemail_read_message
  - hivemail_reserve
  - hivemail_release
  - skills_use
  - skills_list
related_skills:
  - testing-patterns
  - system-design
  - cli-builder
---

# Swarm Coordination Skill

This skill provides guidance for effective multi-agent coordination in OpenCode swarm workflows.

**IMPORTANT:** This skill references global skills in `global-skills/`. Workers should load domain-specific skills based on their subtask type.

## MANDATORY: Swarm Mail

**ALL coordination MUST use `hivemail_*` tools.** This is non-negotiable.

Swarm Mail is embedded (no external server needed) and provides:

- File reservations to prevent conflicts
- Message passing between agents
- Thread-based coordination tied to beads

## When to Use Swarm Coordination

Use swarm coordination when:

- A task has multiple independent subtasks that can run in parallel
- The task requires different specializations (e.g., frontend + backend + tests)
- Work can be divided by file/module boundaries
- Time-to-completion matters and parallelization helps

Do NOT use swarm coordination when:

- The task is simple and can be done by one agent
- Subtasks have heavy dependencies on each other
- The overhead of coordination exceeds the benefit

## Task Decomposition Strategy

### 1. Analyze the Task

Before decomposing, understand:

- What are the distinct units of work?
- Which parts can run in parallel vs sequentially?
- What are the file/module boundaries?
- Are there shared resources that need coordination?

### 2. Choose a Decomposition Strategy

**Parallel Strategy** - For independent subtasks:

```text
Parent Task: "Add user authentication"
├── Subtask 1: "Create auth API endpoints" (backend)
├── Subtask 2: "Build login/signup forms" (frontend)
├── Subtask 3: "Write auth integration tests" (testing)
└── Subtask 4: "Add auth documentation" (docs)
```

**Sequential Strategy** - When order matters:

```text
Parent Task: "Migrate database schema"
├── Step 1: "Create migration files"
├── Step 2: "Update model definitions"
├── Step 3: "Run migrations"
└── Step 4: "Verify data integrity"
```

**Hybrid Strategy** - Mixed dependencies:

```text
Parent Task: "Add feature X"
├── Phase 1 (parallel):
│   ├── Subtask A: "Design API"
│   └── Subtask B: "Design UI mockups"
├── Phase 2 (sequential, after Phase 1):
│   └── Subtask C: "Implement based on designs"
└── Phase 3 (parallel):
    ├── Subtask D: "Write tests"
    └── Subtask E: "Update docs"
```

## File Reservation Protocol

When multiple agents work on the same codebase:

1. **Initialize Swarm Mail first** - Use `hivemail_init` before any work
2. **Reserve files before editing** - Use `hivemail_reserve` to claim files
3. **Respect reservations** - Don't edit files reserved by other agents
4. **Release when done** - Use `hivemail_release` or let `hive_complete` handle it
5. **Coordinate on shared files** - If you must edit a reserved file, send a message to the owning agent

```typescript
// Initialize first
await hivemail_init({
  project_path: "$PWD",
  task_description: "Working on auth feature",
});

// Reserve files
await hivemail_reserve({
  paths: ["src/auth/**"],
  reason: "bd-123: Auth implementation",
  ttl_seconds: 3600,
});

// Work...

// Release when done
await hivemail_release();
```

## Communication Patterns

### Broadcasting Updates

```typescript
hivemail_send({
  to: ["*"],
  subject: "API Complete",
  body: "Completed API endpoints, ready for frontend integration",
  thread_id: epic_id,
});
```

### Direct Coordination

```typescript
hivemail_send({
  to: ["frontend-agent"],
  subject: "Auth API Spec",
  body: "Auth API is at /api/auth/*, here's the spec...",
  thread_id: epic_id,
});
```

### Checking for Messages

```typescript
// Check inbox (max 5, no bodies for context safety)
const inbox = await hivemail_inbox();

// Read specific message body
const message = await hivemail_read_message({ message_id: N });
```

### Reporting Blockers

```typescript
hivemail_send({
  to: ["coordinator"],
  subject: "BLOCKED: Need DB schema",
  body: "Can't proceed without users table",
  thread_id: epic_id,
  importance: "urgent",
});
```

## Quick Reference

### Worker Startup Pattern (NEW)
1. **hivemail_init** - Initialize session first
2. **hive_recover** - Check for checkpoint
3. If checkpoint exists, resume from progress_percent
4. If fresh_start, begin from scratch

**Example:**
```typescript
// 1. Initialize
await hivemail_init({ project_path: "$PWD", task_description: "Task X" });

// 2. Check for checkpoint
const recovery = await hive_recover({
  project_key: "$PWD",
  epic_id: "epic-123",
  bead_id: "epic-123.1",
  agent_name: "Worker1"
});

// 3. Resume or start fresh
if (recovery.fresh_start) {
  console.log("Starting fresh");
} else {
  console.log(`Resuming from ${recovery.context.progress_percent}%`);
  // Apply directives from recovery.context.directives
}
```

### Progress Reporting (UPDATED)
- **hive_progress** - Reports progress AND auto-checkpoints at milestones (25%, 50%, 75%)
- **hive_checkpoint** - Manual checkpoint for sharing directives or critical points

**Auto-Checkpoint Behavior:**
```typescript
// This automatically checkpoints at 25%, 50%, 75%
await hive_progress({
  project_key: "$PWD",
  agent_name: "Worker1",
  bead_id: "epic-123.1",
  status: "in_progress",
  progress_percent: 50,  // Triggers auto-checkpoint at milestone
  files_touched: ["src/foo.ts"]
});
```

### Sharing Discoveries
Use directives to pass context to other agents:
```typescript
hive_checkpoint({
  project_key: "$PWD",
  agent_name: "Worker1",
  epic_id: "epic-123",
  bead_id: "epic-123.1",
  task_description: "Implement auth",
  files: ["src/auth/routes.ts"],
  strategy: "feature-based",
  progress_percent: 50,
  directives: [
    "Found: API rate limit is 100/min",
    "Use /v2/ endpoint instead of /v1/",
    "Auth header format: Bearer <token>"
  ]
});
```

## Best Practices

1. **Initialize Swarm Mail first** - Always call `hivemail_init` before any work
2. **Check for recovery** - Use `hive_recover` at startup to resume crashed tasks
3. **Small, focused subtasks** - Each subtask should be completable in one agent session
4. **Clear boundaries** - Define exactly what files/modules each subtask touches
5. **Explicit handoffs** - When one task enables another, communicate clearly
6. **Graceful failures** - If a subtask fails, don't block the whole swarm
7. **Progress updates** - Use `hive_progress` for tracking (auto-checkpoints at milestones)
8. **Share discoveries** - Use directives in `hive_checkpoint` to help other agents
9. **Load relevant skills** - Workers should call `skills_use()` based on their task type:
   - Testing work → `skills_use(name="testing-patterns")`
   - Architecture decisions → `skills_use(name="system-design")`
   - CLI development → `skills_use(name="cli-builder")`
   - Multi-agent coordination → `skills_use(name="hive-coordination")`

## Common Patterns

### Feature Development

```yaml
decomposition:
  strategy: hybrid
  skills: [system-design, hive-coordination]
  phases:
    - name: design
      parallel: true
      subtasks: [api-design, ui-design]
      recommended_skills: [system-design]
    - name: implement
      parallel: true
      subtasks: [backend, frontend]
      recommended_skills: [system-design]
    - name: validate
      parallel: true
      subtasks: [tests, docs, review]
      recommended_skills: [testing-patterns]
```

### Bug Fix Swarm

```yaml
decomposition:
  strategy: sequential
  skills: [testing-patterns]
  subtasks:
    - reproduce-bug
    - identify-root-cause
    - implement-fix
    - add-regression-test
  recommended_skills: [testing-patterns]
```

### Refactoring

```yaml
decomposition:
  strategy: parallel
  skills: [testing-patterns, system-design]
  subtasks:
    - refactor-module-a
    - refactor-module-b
    - update-imports
    - run-full-test-suite
  recommended_skills: [testing-patterns, system-design]
```

## Skill Integration Workflow

**For Coordinators:**

1. Initialize Swarm Mail with `hivemail_init`
2. Load `hive-coordination` skill
3. Analyze task type
4. Load additional skills based on domain (testing, design, CLI)
5. Include skill recommendations in `shared_context` for workers

**For Workers:**

1. Initialize Swarm Mail with `hivemail_init`
2. Read `shared_context` from coordinator
3. Load recommended skills with `skills_use(name="skill-name")`
4. Apply skill knowledge to subtask
5. Report progress via `hivemail_send`
6. Complete with `hive_complete`

**Example shared_context:**

```markdown
## Context from Coordinator

Past similar tasks: [CASS results]
Project learnings: [semantic-memory results]

## Recommended Skills

- skills_use(name="testing-patterns") - for test creation
- skills_use(name="system-design") - for module boundaries

## Task-Specific Notes

[Domain knowledge from coordinator]
```

## Swarm Mail Quick Reference

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
