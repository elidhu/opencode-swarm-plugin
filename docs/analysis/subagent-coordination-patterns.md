# Subagent Coordination Patterns Analysis

**Source:** obra/superpowers repository  
**Files Analyzed:**

- skills/subagent-driven-development/SKILL.md
- skills/dispatching-parallel-agents/SKILL.md
- skills/requesting-code-review/SKILL.md
- skills/requesting-code-review/code-reviewer.md

---

## 1. Core Principles

1. **Fresh Subagent Per Task** - No context pollution. Each agent starts clean, reads requirements, executes, reports back.

2. **Review Between Tasks** - Code review after EACH task catches issues before they compound. Cheaper than debugging later.

3. **Focused Agent Prompts** - One clear problem domain per agent. Self-contained context. Specific about expected output.

4. **Parallelize Independent Work** - 3+ independent failures/tasks = dispatch concurrent agents. No shared state = parallel safe.

5. **Same Session Execution** - Subagent-driven development stays in current session (vs executing-plans which spawns parallel session).

6. **Quality Gates Over Speed** - More subagent invocations cost tokens, but catching issues early is cheaper than debugging cascading failures.

7. **Never Skip Review** - Even "simple" tasks get reviewed. Critical issues block progress. Important issues fixed before next task.

8. **Explicit Severity Tiers** - Critical (must fix), Important (should fix), Minor (nice to have). Not everything is critical.

---

## 2. When to Use Each Pattern

### Subagent-Driven Development

**Use when:**

- Staying in current session (no context switch)
- Tasks are mostly independent
- Want continuous progress with quality gates
- Have a plan ready to execute

**Don't use when:**

- Need to review plan first → use `executing-plans`
- Tasks are tightly coupled → manual execution better
- Plan needs revision → brainstorm first

**Decision tree:**

```
Have implementation plan?
├─ Yes → Tasks independent?
│  ├─ Yes → Stay in session?
│  │  ├─ Yes → Subagent-Driven Development ✓
│  │  └─ No → Executing Plans (parallel session)
│  └─ No → Manual execution (tight coupling)
└─ No → Write plan first
```

---

### Dispatching Parallel Agents

**Use when:**

- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Each problem can be understood without context from others
- No shared state between investigations

**Don't use when:**

- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere with each other (shared state, editing same files)
- Exploratory debugging (don't know what's broken yet)

**Decision tree:**

```
Multiple failures?
├─ Yes → Are they independent?
│  ├─ Yes → Can work in parallel?
│  │  ├─ Yes → 3+ failures?
│  │  │  ├─ Yes → Parallel Dispatch ✓
│  │  │  └─ No → Sequential agents
│  │  └─ No (shared state) → Sequential agents
│  └─ No (related) → Single agent investigates all
└─ No → Single investigation
```

**Heuristics:**

- Different test files = likely independent
- Different subsystems = likely independent
- Same error across files = likely related
- Cascading failures = investigate root cause first

---

### Requesting Code Review

**Mandatory:**

- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**

- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

**Never skip because:**

- "It's simple" (simple tasks can have subtle issues)
- "I'm confident" (review finds blind spots)
- "Time pressure" (unfixed bugs cost more time later)

---

## 3. Agent Prompt Best Practices

### Anatomy of a Good Prompt

**1. Focused** - One clear problem domain

```markdown
❌ "Fix all the tests"
✓ "Fix agent-tool-abort.test.ts"
```

**2. Self-contained** - All context needed

```markdown
❌ "Fix the race condition"
✓ "Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1.  'should abort tool with partial output capture' - expects 'interrupted at' in message
2.  'should handle mixed completed and aborted tools' - fast tool aborted instead of completed
3.  'should properly track pendingToolCount' - expects 3 results but gets 0"
```

**3. Specific about output** - What should agent return?

```markdown
❌ "Fix it"
✓ "Return: Summary of root cause and what you fixed"
```

**4. Constraints** - Prevent scope creep

```markdown
✓ "Do NOT just increase timeouts - find the real issue"
✓ "Do NOT change production code - fix tests only"
✓ "Don't refactor - minimal changes to make tests pass"
```

---

### Implementation Subagent Template

```markdown
You are implementing Task N from [plan-file].

Read that task carefully. Your job is to:

1. Implement exactly what the task specifies
2. Write tests (following TDD if task says to)
3. Verify implementation works
4. Commit your work
5. Report back

Work from: [directory]

Report: What you implemented, what you tested, test results, files changed, any issues
```

**Key elements:**

- References plan file for context
- Explicit steps to follow
- Specific output format
- Working directory specified

---

### Parallel Investigation Template

```markdown
Fix the 3 failing tests in src/agents/agent-tool-abort.test.ts:

1. "should abort tool with partial output capture" - expects 'interrupted at' in message
2. "should handle mixed completed and aborted tools" - fast tool aborted instead of completed
3. "should properly track pendingToolCount" - expects 3 results but gets 0

These are timing/race condition issues. Your task:

1. Read the test file and understand what each test verifies
2. Identify root cause - timing issues or actual bugs?
3. Fix by:
   - Replacing arbitrary timeouts with event-based waiting
   - Fixing bugs in abort implementation if found
   - Adjusting test expectations if testing changed behavior

Do NOT just increase timeouts - find the real issue.

Return: Summary of what you found and what you fixed.
```

**Key elements:**

- Paste error messages and test names (full context)
- Hypothesis about root cause
- Clear fixing strategy
- Anti-pattern constraint ("Do NOT just increase timeouts")
- Expected return format

---

### Fix Subagent Template

```markdown
Fix issues from code review: [list issues]

Context: [what was just implemented]

Issues to fix:

1. [Issue from reviewer with file:line reference]
2. [Issue from reviewer with file:line reference]

Fix these issues and commit. Report what you changed.
```

**Key elements:**

- Specific issues from code review
- Context of original implementation
- Clear success criteria

---

## 4. Code Review Template Structure

### Dispatcher Side (Requesting Review)

**1. Get git SHAs:**

```bash
BASE_SHA=$(git rev-parse HEAD~1)  # or origin/main
HEAD_SHA=$(git rev-parse HEAD)
```

**2. Fill template placeholders:**

- `{WHAT_WAS_IMPLEMENTED}` - What you just built
- `{PLAN_OR_REQUIREMENTS}` - What it should do (reference plan file/section)
- `{BASE_SHA}` - Starting commit
- `{HEAD_SHA}` - Ending commit
- `{DESCRIPTION}` - Brief summary

**3. Dispatch superpowers:code-reviewer subagent** with filled template

---

### Code Reviewer Side (Template Output)

#### Strengths

[What's well done? Be specific with file:line references]

Example:

```
- Clean database schema with proper migrations (db.ts:15-42)
- Comprehensive test coverage (18 tests, all edge cases)
- Good error handling with fallbacks (summarizer.ts:85-92)
```

---

#### Issues

##### Critical (Must Fix)

[Bugs, security issues, data loss risks, broken functionality]

##### Important (Should Fix)

[Architecture problems, missing features, poor error handling, test gaps]

##### Minor (Nice to Have)

[Code style, optimization opportunities, documentation improvements]

**For each issue:**

- File:line reference
- What's wrong
- Why it matters
- How to fix (if not obvious)

Example:

```
#### Important
1. **Missing help text in CLI wrapper**
   - File: index-conversations:1-31
   - Issue: No --help flag, users won't discover --concurrency
   - Fix: Add --help case with usage examples

2. **Date validation missing**
   - File: search.ts:25-27
   - Issue: Invalid dates silently return no results
   - Fix: Validate ISO format, throw error with example
```

---

#### Recommendations

[Improvements for code quality, architecture, or process]

---

#### Assessment

**Ready to merge?** [Yes/No/With fixes]

**Reasoning:** [Technical assessment in 1-2 sentences]

Example:

```
**Ready to merge: With fixes**

**Reasoning:** Core implementation is solid with good architecture and tests.
Important issues (help text, date validation) are easily fixed and don't affect
core functionality.
```

---

### Review Checklist (Reviewer Uses This)

**Code Quality:**

- Clean separation of concerns?
- Proper error handling?
- Type safety (if applicable)?
- DRY principle followed?
- Edge cases handled?

**Architecture:**

- Sound design decisions?
- Scalability considerations?
- Performance implications?
- Security concerns?

**Testing:**

- Tests actually test logic (not mocks)?
- Edge cases covered?
- Integration tests where needed?
- All tests passing?

**Requirements:**

- All plan requirements met?
- Implementation matches spec?
- No scope creep?
- Breaking changes documented?

**Production Readiness:**

- Migration strategy (if schema changes)?
- Backward compatibility considered?
- Documentation complete?
- No obvious bugs?

---

## 5. Anti-Patterns and Red Flags

### Subagent-Driven Development

**Never:**

- ❌ Skip code review between tasks
- ❌ Proceed with unfixed Critical issues
- ❌ Dispatch multiple implementation subagents in parallel (conflicts)
- ❌ Implement without reading plan task
- ❌ Try to fix subagent failures manually (context pollution)

**If subagent fails task:**

- ✓ Dispatch fix subagent with specific instructions
- ✓ Don't try to fix manually (context pollution)

---

### Dispatching Parallel Agents

**Common mistakes:**

❌ **Too broad:** "Fix all the tests"  
✓ **Specific:** "Fix agent-tool-abort.test.ts"

❌ **No context:** "Fix the race condition"  
✓ **Context:** Paste error messages and test names

❌ **No constraints:** Agent might refactor everything  
✓ **Constraints:** "Do NOT change production code" or "Fix tests only"

❌ **Vague output:** "Fix it"  
✓ **Specific:** "Return summary of root cause and changes"

**When NOT to parallelize:**

- Related failures (fix one might fix others)
- Need full context (understanding requires seeing entire system)
- Exploratory debugging (don't know what's broken yet)
- Shared state (agents would interfere)

---

### Requesting Code Review

**Never:**

- ❌ Skip review because "it's simple"
- ❌ Ignore Critical issues
- ❌ Proceed with unfixed Important issues
- ❌ Argue with valid technical feedback

**If reviewer wrong:**

- ✓ Push back with technical reasoning
- ✓ Show code/tests that prove it works
- ✓ Request clarification

---

### Code Reviewer Anti-Patterns

**DO:**

- ✓ Categorize by actual severity (not everything is Critical)
- ✓ Be specific (file:line, not vague)
- ✓ Explain WHY issues matter
- ✓ Acknowledge strengths
- ✓ Give clear verdict

**DON'T:**

- ❌ Say "looks good" without checking
- ❌ Mark nitpicks as Critical
- ❌ Give feedback on code you didn't review
- ❌ Be vague ("improve error handling")
- ❌ Avoid giving a clear verdict

---

## 6. Integration Between Patterns

### Subagent-Driven Development Workflow

```
1. Load Plan
   └─ Read plan file, create TodoWrite with all tasks

2. For Each Task:
   ├─ Dispatch implementation subagent
   │  └─ Fresh context, follows TDD, commits work
   │
   ├─ Get git SHAs (before task, after task)
   │
   ├─ Dispatch code-reviewer subagent
   │  └─ Reviews against plan requirements
   │
   ├─ Act on review feedback
   │  ├─ Critical issues → Fix immediately
   │  ├─ Important issues → Dispatch fix subagent
   │  └─ Minor issues → Note for later
   │
   └─ Mark task complete in TodoWrite

3. After All Tasks:
   ├─ Dispatch final code-reviewer
   │  └─ Reviews entire implementation
   │
   └─ Use finishing-a-development-branch skill
      └─ Verify tests, present options, execute choice
```

---

### Parallel Investigation Workflow

```
1. Multiple Failures Detected
   └─ Identify independent problem domains

2. Group by Domain
   ├─ File A tests: Tool approval flow
   ├─ File B tests: Batch completion behavior
   └─ File C tests: Abort functionality

3. Dispatch Parallel Agents
   ├─ Agent 1: Fix File A (focused scope, specific errors)
   ├─ Agent 2: Fix File B (focused scope, specific errors)
   └─ Agent 3: Fix File C (focused scope, specific errors)

4. Review and Integrate
   ├─ Read each summary
   ├─ Verify fixes don't conflict
   ├─ Run full test suite
   └─ Integrate all changes
```

---

### Acting on Code Review Feedback

**Severity Tiers:**

**Critical (Must Fix):**

- Bugs, security issues, data loss risks, broken functionality
- **Action:** Fix immediately, re-review, don't proceed without fixing

**Important (Should Fix):**

- Architecture problems, missing features, poor error handling, test gaps
- **Action:** Dispatch fix subagent before next task

**Minor (Nice to Have):**

- Code style, optimization opportunities, documentation improvements
- **Action:** Note for later, don't block on these

**Example flow:**

```
Reviewer returns:
  Critical: None
  Important: Missing progress indicators, Date validation missing
  Minor: Magic number (100) for reporting interval

Action:
1. Dispatch fix subagent: "Fix Important issues from review: [list]"
2. Fix subagent commits changes
3. (Optional) Quick re-review if fixes were complex
4. Mark task complete, proceed to next task
5. Note Minor issues for future cleanup
```

---

## 7. Required Workflow Skills

### Subagent-Driven Development Dependencies

**REQUIRED:**

- `writing-plans` - Creates the plan that this skill executes
- `requesting-code-review` - Review after each task
- `finishing-a-development-branch` - Complete development after all tasks

**Subagents must use:**

- `test-driven-development` - Subagents follow TDD for each task

**Alternative workflow:**

- `executing-plans` - Use for parallel session instead of same-session execution

---

## 8. Real-World Examples

### Parallel Investigation (from Session 2025-10-03)

**Scenario:** 6 test failures across 3 files after major refactoring

**Failures:**

- agent-tool-abort.test.ts: 3 failures (timing issues)
- batch-completion-behavior.test.ts: 2 failures (tools not executing)
- tool-approval-race-conditions.test.ts: 1 failure (execution count = 0)

**Decision:** Independent domains - abort logic separate from batch completion separate from race conditions

**Dispatch:**

```
Agent 1 → Fix agent-tool-abort.test.ts
Agent 2 → Fix batch-completion-behavior.test.ts
Agent 3 → Fix tool-approval-race-conditions.test.ts
```

**Results:**

- Agent 1: Replaced timeouts with event-based waiting
- Agent 2: Fixed event structure bug (threadId in wrong place)
- Agent 3: Added wait for async tool execution to complete

**Integration:** All fixes independent, no conflicts, full suite green

**Time saved:** 3 problems solved in parallel vs sequentially

---

### Subagent-Driven Development Example

```
Coordinator: I'm using Subagent-Driven Development to execute this plan.

[Load plan, create TodoWrite]

Task 1: Hook installation script

[Dispatch implementation subagent]
Subagent: Implemented install-hook with tests, 5/5 passing

[Get git SHAs, dispatch code-reviewer]
Reviewer: Strengths: Good test coverage. Issues: None. Ready.

[Mark Task 1 complete]

Task 2: Recovery modes

[Dispatch implementation subagent]
Subagent: Added verify/repair, 8/8 tests passing

[Dispatch code-reviewer]
Reviewer: Strengths: Solid. Issues (Important): Missing progress reporting

[Dispatch fix subagent]
Fix subagent: Added progress every 100 conversations

[Verify fix, mark Task 2 complete]

...

[After all tasks]
[Dispatch final code-reviewer]
Final reviewer: All requirements met, ready to merge

Done!
```

---

## 9. Key Quotes Worth Preserving

> **"Fresh subagent per task + review between tasks = high quality, fast iteration"**  
> — subagent-driven-development/SKILL.md

> **"Dispatch one agent per independent problem domain. Let them work concurrently."**  
> — dispatching-parallel-agents/SKILL.md

> **"Review early, review often."**  
> — requesting-code-review/SKILL.md

> **"More subagent invocations cost tokens, but catching issues early is cheaper than debugging later."**  
> — subagent-driven-development/SKILL.md (paraphrased from "Cost" section)

> **"Do NOT just increase timeouts - find the real issue."**  
> — dispatching-parallel-agents/SKILL.md (example prompt constraint)

> **"Categorize by actual severity (not everything is Critical)"**  
> — code-reviewer.md

> **"Be specific (file:line, not vague)"**  
> — code-reviewer.md

> **"If subagent fails task: Dispatch fix subagent with specific instructions. Don't try to fix manually (context pollution)."**  
> — subagent-driven-development/SKILL.md

---

## 10. Advantages Summary

### Subagent-Driven Development

**vs. Manual execution:**

- Subagents follow TDD naturally
- Fresh context per task (no confusion)
- Parallel-safe (subagents don't interfere)

**vs. Executing Plans:**

- Same session (no handoff)
- Continuous progress (no waiting)
- Review checkpoints automatic

**Cost tradeoff:**

- More subagent invocations
- But catches issues early (cheaper than debugging later)

---

### Dispatching Parallel Agents

**Benefits:**

1. **Parallelization** - Multiple investigations happen simultaneously
2. **Focus** - Each agent has narrow scope, less context to track
3. **Independence** - Agents don't interfere with each other
4. **Speed** - 3 problems solved in time of 1

**Verification after agents return:**

1. Review each summary - Understand what changed
2. Check for conflicts - Did agents edit same code?
3. Run full suite - Verify all fixes work together
4. Spot check - Agents can make systematic errors

---

### Requesting Code Review

**Benefits:**

- Catches issues before they compound
- Fresh perspective on implementation
- Validates against requirements
- Explicit severity tiers guide priority
- Clear verdict (Yes/No/With fixes)

**Integration:**

- Subagent-Driven Development: Review after EACH task
- Executing Plans: Review after each batch (3 tasks)
- Ad-Hoc Development: Review before merge, when stuck

---

## 11. Decision Tree: Which Pattern to Use?

```
What are you doing?
├─ Executing implementation plan?
│  ├─ Yes → Subagent-Driven Development
│  │  ├─ Fresh subagent per task
│  │  ├─ Code review after each task
│  │  └─ Same session, continuous progress
│  │
│  └─ No → Continue...
│
├─ Multiple independent failures?
│  ├─ Yes (3+) → Dispatching Parallel Agents
│  │  ├─ One agent per problem domain
│  │  ├─ Focused prompts with constraints
│  │  └─ Review and integrate results
│  │
│  └─ No → Continue...
│
└─ Completed task/feature?
   └─ Yes → Requesting Code Review
      ├─ Get git SHAs
      ├─ Dispatch code-reviewer subagent
      ├─ Fix Critical/Important issues
      └─ Proceed or merge
```

---

## 12. Prompt Templates Quick Reference

### Implementation Subagent

```
You are implementing Task N from [plan-file].
Read that task carefully. Your job is to:
1. Implement exactly what the task specifies
2. Write tests (following TDD if task says to)
3. Verify implementation works
4. Commit your work
5. Report back

Work from: [directory]
Report: What you implemented, what you tested, test results, files changed, any issues
```

### Parallel Investigation Subagent

```
Fix the 3 failing tests in [test-file]:
[Paste test names and error messages]

Your task:
1. Read the test file and understand what each test verifies
2. Identify root cause
3. Fix by: [strategy]

Do NOT [anti-pattern constraint]
Return: Summary of what you found and what you fixed.
```

### Fix Subagent

```
Fix issues from code review: [list issues]
Context: [what was just implemented]
Issues to fix:
1. [Issue with file:line]
2. [Issue with file:line]

Fix these issues and commit. Report what you changed.
```

### Code Reviewer Subagent

```
Review {WHAT_WAS_IMPLEMENTED}
Compare against {PLAN_OR_REQUIREMENTS}
Git range: {BASE_SHA}..{HEAD_SHA}

Output:
- Strengths (specific, with file:line)
- Issues (Critical/Important/Minor with file:line, why, how to fix)
- Recommendations
- Assessment (Ready to merge? Yes/No/With fixes + reasoning)
```

---

## 13. Context Pollution Prevention

**Problem:** Coordinator tries to fix subagent failures manually, polluting context with failed attempts.

**Solution:** Always dispatch fix subagent instead.

**Pattern:**

```
Subagent fails task → Review failure report → Dispatch fix subagent with:
  - What failed
  - Why it failed (from report)
  - Specific fix instructions
  - Constraints to prevent same failure
```

**Why it works:**

- Fix subagent has fresh context
- Coordinator maintains high-level coordination role
- No accumulated debugging cruft in coordinator context
- Parallel-safe (fix subagent doesn't interfere with other work)

---

## 14. File Reservation (Not in Source Docs)

**Note:** The analyzed skills don't mention file reservation, but this is a common coordination primitive for multi-agent systems.

**When it would apply:**

- Parallel agents editing potentially overlapping files
- Prevention of merge conflicts
- Coordination of shared state mutations

**Integration point:**

- Would fit in "Dispatching Parallel Agents" when agents might touch overlapping code
- Verification step: "Check for conflicts - Did agents edit same code?"

**For opencode-swarm-plugin:** Agent Mail has file reservation (`agentmail_reserve`, `agentmail_release`). This pattern could enhance parallel dispatch safety.

---

## END ANALYSIS

**Key takeaways for opencode-swarm-plugin:**

1. **Adopt fresh subagent per task** - Prevents context pollution, enables TDD naturally
2. **Mandatory code review between tasks** - Catches issues early, explicit severity tiers
3. **Parallelize at 3+ independent failures** - Clear heuristic for when to dispatch concurrent agents
4. **Focused agent prompts** - Self-contained, specific output, constraints prevent scope creep
5. **Never skip review because "it's simple"** - Simple tasks can have subtle issues
6. **Fix subagents instead of manual fixes** - Preserves coordinator context clarity
7. **Explicit severity tiers guide priority** - Critical blocks, Important before next task, Minor noted
8. **Same session vs parallel session** - Subagent-driven stays in session, executing-plans spawns parallel

**Patterns to integrate:**

- ✓ Fresh subagent per task (already in swarm worker pattern)
- ✓ Code review after each task (add to swarm_complete?)
- ✓ Parallel dispatch at 3+ failures (add to debug-plus command)
- ✓ Severity-based issue triage (integrate with UBS scan results)
- ✓ Fix subagent pattern (add to swarm toolkit)

---

# Part II: Guardian Worker Patterns

**Design Status:** Draft v1  
**Author:** Hive Agent (GoldMoon)  
**Date:** 2025-12-15

## Executive Summary

Guardian workers are **non-work subagents** that coordinators spawn alongside task workers to handle meta-concerns during hive execution. Unlike task workers that implement features or fix bugs, guardians monitor health, cleanup resources, prioritize work, and enforce quality standards.

**Key principles:**
- **Zero-Config**: Guardians use only existing tools - no new infrastructure needed
- **Report via Hive Mail**: Guardians observe and report, coordinators decide actions
- **Spawn as Needed**: Coordinators spawn guardians based on hive state (size, duration, detected issues)
- **Async Operation**: Guardians work independently, don't block task workers

## The Guardian Pattern

### Why Guardians?

**Problem**: Coordinators managing large swarms face context exhaustion:
- Tracking 5+ workers simultaneously
- Monitoring for stalls, blockers, resource leaks
- Maintaining quality standards across parallel work
- Handling cleanup when agents crash or abandon work

**Solution**: Delegate meta-concerns to specialized guardian workers.

**Benefits**:
1. **Reduced Coordinator Load**: Coordinator focuses on work distribution, guardians handle monitoring
2. **Async Monitoring**: Guardians check health without blocking coordination flow
3. **Early Detection**: Status guardians catch stalls before they cascade
4. **Automatic Cleanup**: Cleanup guardians handle resource leaks without manual intervention

### The Zero-Config Principle

Guardians are **NOT** a new infrastructure layer. They are:
- Regular Task tool spawns with specialized prompts
- Using only existing tools (hive_status, hivemail_*, beads_*, etc.)
- Reporting via standard Hive Mail channels
- Terminable like any other agent

**Any hive can spawn guardians immediately** - no setup, no new tables, no new APIs.

## Guardian Catalog

### 1. Status Guardian

**Purpose**: Detect stalled workers and alert coordinator

**When to spawn**:
- At hive start (spawn alongside first workers)
- When coordinator hasn't heard from workers in >5 minutes
- On large swarms (5+ workers) as continuous monitor

**What it does**:
1. Polls `hive_status(epic_id)` every 2-3 minutes
2. Checks for workers with no progress updates >5 minutes
3. Queries `hivemail_inbox()` to see if workers are communicating
4. Reports stalled workers to coordinator with context

**Tools used**:
- `hive_status(epic_id, project_key)` - Get worker progress
- `hivemail_inbox()` - Check recent worker messages
- `hivemail_send(to=["coordinator"], ...)` - Report findings

**Reports**:
- Subject: `[STATUS] Worker {agent_name} appears stalled`
- Body: Last known progress, time since update, suggested action

**Example prompt**:
```markdown
You are a Status Guardian monitoring hive execution.

## Your Role
Monitor worker progress and detect stalls. You are NOT a task worker - you don't implement features.

## Epic to Monitor
Epic ID: {epic_id}
Project: {project_key}

## Instructions
1. Poll hive_status(epic_id, project_key) every 2-3 minutes
2. Check for workers with:
   - status="in_progress" but no updates >5 min
   - status="blocked" but coordinator hasn't acknowledged
3. Cross-reference hivemail_inbox() - are they communicating?
4. Report stalled workers to coordinator via hivemail_send

## Report Format
Subject: [STATUS] Worker {name} appears stalled
Body:
- Worker: {agent_name}
- Bead: {bead_id}
- Last update: {timestamp}
- Status: {status}
- Suggested action: Check if agent crashed, needs unblocking, or is waiting

## When to Stop
- Coordinator sends "terminate" message
- All workers complete
- Hive duration >60 minutes (self-terminate, report)

Begin monitoring now.
```

### 2. Cleanup Guardian

**Purpose**: Release abandoned resources and close orphaned beads

**When to spawn**:
- At hive end (after all task workers report complete)
- On coordinator crash recovery
- When coordinator detects orphaned reservations (via hivemail health check)

**What it does**:
1. Queries `hivemail_inbox()` for unreleased file reservations
2. Queries `beads_query(status="in_progress")` for unclosed beads from terminated agents
3. Releases abandoned reservations via `hivemail_release(reservation_ids=[...])`
4. Closes orphan beads with status="closed" and summary="Cleanup: Agent terminated without completion"
5. Reports cleanup actions to coordinator

**Tools used**:
- `hivemail_inbox()` - Find unreleased reservations
- `hivemail_release(reservation_ids)` - Release abandoned locks
- `beads_query(status="in_progress")` - Find orphan beads
- `beads_close(id, reason)` - Close orphan beads
- `hivemail_send(to=["coordinator"], ...)` - Report cleanup

**Reports**:
- Subject: `[CLEANUP] Released {n} reservations, closed {m} beads`
- Body: List of released files, closed beads, and reasons

**Example prompt**:
```markdown
You are a Cleanup Guardian handling resource cleanup.

## Your Role
Release abandoned file reservations and close orphaned beads. You are NOT a task worker.

## Epic Context
Epic ID: {epic_id}
Project: {project_key}

## Instructions
1. Query hivemail_inbox() for messages about unreleased reservations
2. Query beads_query(status="in_progress") for beads from terminated agents
3. For each orphan:
   - If reservation: hivemail_release(reservation_ids=[...])
   - If bead: beads_close(id, reason="Cleanup: Agent terminated")
4. Report cleanup summary to coordinator

## Report Format
Subject: [CLEANUP] Released {n} reservations, closed {m} beads
Body:
- Reservations released: {count}
  - Files: {file_paths}
- Beads closed: {count}
  - Bead IDs: {bead_ids}
- Reason: {why these were orphaned}

## When to Stop
After cleanup complete, send report and self-terminate.

Begin cleanup now.
```

### 3. Priority Guardian

**Purpose**: Re-prioritize task queue based on blockers and dependencies

**When to spawn**:
- When coordinator detects BLOCKED messages from workers
- Mid-hive when dependencies shift
- On large swarms (5+ workers) as continuous monitor

**What it does**:
1. Monitors `hivemail_inbox()` for BLOCKED messages from workers
2. Queries `beads_query(status="blocked")` for blocked tasks
3. Identifies unblocking dependencies (what needs to finish first?)
4. Suggests priority changes to coordinator via hivemail_send
5. Optionally uses `beads_update(id, priority=N)` if coordinator delegates authority

**Tools used**:
- `hivemail_inbox()` - Detect BLOCKED messages
- `beads_query(status="blocked")` - Find blocked tasks
- `beads_query(status="open")` - See task queue
- `beads_update(id, priority)` - Adjust priorities (if authorized)
- `hivemail_send(to=["coordinator"], ...)` - Report findings

**Reports**:
- Subject: `[PRIORITY] {n} blocked tasks detected`
- Body: Blocked tasks, dependencies, suggested priority changes

**Example prompt**:
```markdown
You are a Priority Guardian monitoring task dependencies.

## Your Role
Detect blocked workers and suggest priority adjustments. You are NOT a task worker.

## Epic Context
Epic ID: {epic_id}
Project: {project_key}

## Instructions
1. Monitor hivemail_inbox() for BLOCKED messages
2. Query beads_query(status="blocked") every 3-5 minutes
3. For each blocked task:
   - Identify blocking dependency (what's it waiting for?)
   - Check if blocker is in progress or not yet started
   - Suggest priority increase for blockers
4. Report findings to coordinator

## Report Format
Subject: [PRIORITY] {n} blocked tasks detected
Body:
- Blocked tasks: {bead_ids}
- Blockers: {dependency_bead_ids}
- Suggested actions:
  - Increase priority of {blocker_bead_id}
  - Spawn additional worker if blocker not started
  - Reassign if blocker stalled

## Authority
You REPORT ONLY. Do not update priorities without coordinator approval.

## When to Stop
- Coordinator sends "terminate"
- No blocked tasks for >10 minutes

Begin monitoring now.
```

### 4. Quality Guardian

**Purpose**: Monitor for code quality issues and broadcast alerts

**When to spawn**:
- Mid-hive on large swarms (5+ workers)
- When coordinator detects high failure rate (>30% of workers retrying)
- On critical features requiring extra scrutiny

**What it does**:
1. Monitors worker completion messages for patterns (via hivemail_inbox())
2. Looks for common issues (e.g., multiple agents hitting same TypeScript error)
3. Checks for consistency violations (e.g., agents using different API patterns)
4. Broadcasts quality alerts via hivemail_send to all workers
5. Reports quality trends to coordinator

**Tools used**:
- `hivemail_inbox()` - Monitor worker completion messages
- `hivemail_send(to=["all_workers"], ...)` - Broadcast alerts
- `hivemail_send(to=["coordinator"], ...)` - Report trends
- `beads_query()` - See overall task success/failure rates

**Reports**:
- Subject: `[QUALITY] {n} workers hitting {issue_pattern}`
- Body: Issue description, affected workers, suggested fix

**Example prompt**:
```markdown
You are a Quality Guardian monitoring code quality.

## Your Role
Detect quality issues across workers and broadcast alerts. You are NOT a task worker.

## Epic Context
Epic ID: {epic_id}
Project: {project_key}

## Instructions
1. Monitor hivemail_inbox() for worker completion messages
2. Look for patterns:
   - Multiple agents hitting same TypeScript error
   - Inconsistent API usage across agents
   - High retry rates (>30% of workers failing first attempt)
3. When pattern detected:
   - Broadcast alert to all workers via hivemail_send
   - Report trend to coordinator
4. Run every 5 minutes

## Report Format (to workers)
Subject: [QUALITY ALERT] {issue_pattern} detected
Body:
- Issue: {description}
- Affected workers: {agent_names}
- Recommended fix: {solution}

## Report Format (to coordinator)
Subject: [QUALITY] {n} workers affected by {issue}
Body:
- Pattern: {description}
- Impact: {worker_count} workers
- Suggested action: {coordinator_action}

## When to Stop
- Coordinator sends "terminate"
- Hive nearing completion

Begin monitoring now.
```

## Spawning Guardians

### Coordinator Pattern

Coordinators spawn guardians using the same Task tool used for task workers:

```typescript
// Spawn status guardian alongside workers
Task({
  description: "Status Guardian - monitor worker progress",
  prompt: STATUS_GUARDIAN_PROMPT.replace('{epic_id}', epic_id)
                                 .replace('{project_key}', project_key)
});

// Spawn task workers
for (const subtask of subtasks) {
  Task({
    description: `Task Worker - ${subtask.title}`,
    prompt: formatSubtaskPromptV2({...})
  });
}
```

**Key points**:
- Guardians spawn BEFORE task workers (so monitoring starts immediately)
- Guardians receive epic context but NO file reservations
- Guardians have "guardian" or "monitor" in description for tracking
- Coordinator can spawn multiple guardian types simultaneously

### Timing Recommendations

| Guardian Type | When to Spawn | Duration |
|--------------|---------------|----------|
| Status | Hive start | Until hive complete |
| Cleanup | Hive end or crash recovery | One-shot |
| Priority | On first BLOCKED message | Until no blocks for 10 min |
| Quality | Mid-hive on large swarms | Until hive 80% complete |

**Heuristics**:
- Small hive (≤3 workers): Status guardian only
- Medium hive (4-6 workers): Status + Priority guardians
- Large hive (7+ workers): All guardian types
- Critical features: Add Quality guardian regardless of size

### Guardian Lifecycle

**Status Guardian**:
```
Spawn → Monitor (loop) → Detect stall → Report → Continue monitoring → Terminate on hive complete
```

**Cleanup Guardian**:
```
Spawn → Scan for orphans → Release/close → Report → Self-terminate
```

**Priority Guardian**:
```
Spawn → Monitor blocks → Detect blocker → Report → Wait for resolution → Continue monitoring → Self-terminate after 10 min no blocks
```

**Quality Guardian**:
```
Spawn → Monitor completions → Detect pattern → Broadcast + Report → Continue monitoring → Terminate at 80% hive completion
```

## Prompt Templates

### Status Guardian Full Prompt

```markdown
You are a Status Guardian monitoring hive execution.

## [IDENTITY]
Agent: (assigned at spawn)
Role: Status Guardian (non-task worker)
Epic: {epic_id}

## [MISSION]
Monitor task worker progress and detect stalls. You do NOT implement features.

## [TOOLS]
- hive_status(epic_id, project_key) - Get worker status
- hivemail_inbox() - Check worker communications
- hivemail_send(to, subject, body, thread_id) - Report findings

## [MONITORING PROTOCOL]
1. Initialize: hivemail_init(project_path="$PWD", task_description="Status Guardian")
2. Every 2-3 minutes:
   - Call hive_status("{epic_id}", "{project_key}")
   - Check for workers with status="in_progress" but no progress_update >5 min
   - Check hivemail_inbox() for recent worker messages
3. If stall detected:
   - Report via hivemail_send(
       to=["coordinator"],
       subject="[STATUS] Worker {name} appears stalled",
       body="<details>",
       thread_id="{epic_id}"
     )
4. Continue until:
   - Coordinator sends "terminate" message
   - All workers status="closed"
   - Hive duration >60 min (self-terminate with report)

## [REPORT FORMAT]
Subject: [STATUS] Worker {agent_name} appears stalled
Body:
- Worker: {agent_name}
- Bead: {bead_id}
- Status: {status}
- Last update: {timestamp}
- Last message: {inbox_check}
- Suggested action: {check_crash|unblock|wait}

## [CONSTRAINTS]
- Do NOT spawn other agents
- Do NOT modify beads
- Do NOT attempt to fix issues yourself
- ONLY observe and report

Begin monitoring now.
```

### Cleanup Guardian Full Prompt

```markdown
You are a Cleanup Guardian handling post-hive resource cleanup.

## [IDENTITY]
Agent: (assigned at spawn)
Role: Cleanup Guardian (non-task worker)
Epic: {epic_id}

## [MISSION]
Release abandoned file reservations and close orphaned beads.

## [TOOLS]
- hivemail_inbox() - Find unreleased reservations
- hivemail_release(reservation_ids) - Release locks
- beads_query(status="in_progress") - Find orphan beads
- beads_close(id, reason) - Close orphans
- hivemail_send(to, subject, body, thread_id) - Report cleanup

## [CLEANUP PROTOCOL]
1. Initialize: hivemail_init(project_path="$PWD", task_description="Cleanup Guardian")
2. Scan for orphans:
   - Check hivemail_inbox() for unreleased reservations
   - Query beads_query(status="in_progress") for unclosed beads from epic
3. For each orphan:
   - If reservation: hivemail_release(reservation_ids=[...])
   - If bead: beads_close(id="{bead_id}", reason="Cleanup: Agent terminated without completion")
4. Report summary:
   - hivemail_send(
       to=["coordinator"],
       subject="[CLEANUP] Released {n} reservations, closed {m} beads",
       body="<details>",
       thread_id="{epic_id}"
     )
5. Self-terminate

## [REPORT FORMAT]
Subject: [CLEANUP] Released {n} reservations, closed {m} beads
Body:
- Reservations released: {count}
  - Files: [{paths}]
  - Original owners: [{agents}]
- Beads closed: {count}
  - Bead IDs: [{ids}]
  - Reason: Agent terminated without hive_complete
- Timestamp: {now}

## [CONSTRAINTS]
- Do NOT release reservations <5 min old (agent might still be working)
- Do NOT close beads with status="blocked" (coordinator might be resolving)
- ONLY clean up from this epic ({epic_id})

Begin cleanup now.
```

### Priority Guardian Full Prompt

```markdown
You are a Priority Guardian monitoring task dependencies.

## [IDENTITY]
Agent: (assigned at spawn)
Role: Priority Guardian (non-task worker)
Epic: {epic_id}

## [MISSION]
Detect blocked workers and suggest priority adjustments to coordinator.

## [TOOLS]
- hivemail_inbox() - Monitor for BLOCKED messages
- beads_query(status="blocked") - Find blocked tasks
- beads_query(status="open") - See task queue
- hivemail_send(to, subject, body, thread_id) - Report findings

## [MONITORING PROTOCOL]
1. Initialize: hivemail_init(project_path="$PWD", task_description="Priority Guardian")
2. Every 3-5 minutes:
   - Check hivemail_inbox() for messages with subject containing "BLOCKED"
   - Query beads_query(status="blocked") for blocked beads
3. For each blocked task:
   - Identify blocking dependency (read bead description)
   - Check if blocker is in_progress, open, or not started
   - Determine suggested priority change
4. Report to coordinator:
   - hivemail_send(
       to=["coordinator"],
       subject="[PRIORITY] {n} blocked tasks detected",
       body="<analysis>",
       thread_id="{epic_id}"
     )
5. Continue until:
   - No blocked tasks for >10 min
   - Coordinator sends "terminate"

## [REPORT FORMAT]
Subject: [PRIORITY] {n} blocked tasks detected
Body:
- Blocked tasks:
  - {bead_id}: {title} - waiting on {blocker_bead_id}
- Blockers status:
  - {blocker_bead_id}: status={status}, last_update={time}
- Suggested actions:
  - Increase priority of {blocker_bead_id} to unblock {n} tasks
  - Spawn additional worker if {blocker_bead_id} not started
  - Investigate if {blocker_bead_id} stalled

## [CONSTRAINTS]
- You REPORT ONLY - do not update bead priorities yourself
- Do NOT suggest changes unless blocker is clearly the bottleneck
- ONLY monitor beads from this epic ({epic_id})

Begin monitoring now.
```

### Quality Guardian Full Prompt

```markdown
You are a Quality Guardian monitoring code quality across workers.

## [IDENTITY]
Agent: (assigned at spawn)
Role: Quality Guardian (non-task worker)
Epic: {epic_id}

## [MISSION]
Detect quality issues across workers and broadcast alerts to prevent cascading failures.

## [TOOLS]
- hivemail_inbox() - Monitor worker messages
- hivemail_send(to=["coordinator"], ...) - Report trends
- hivemail_send(to=["all_workers"], ...) - Broadcast alerts
- beads_query() - See task success/failure rates

## [MONITORING PROTOCOL]
1. Initialize: hivemail_init(project_path="$PWD", task_description="Quality Guardian")
2. Every 5 minutes:
   - Read hivemail_inbox() for worker completion messages
   - Look for patterns:
     - Multiple agents hitting same error (e.g., TypeScript compilation)
     - Inconsistent patterns (e.g., some use API v1, some v2)
     - High retry rate (check if >30% of workers had retries)
3. When pattern detected:
   - Broadcast to all workers:
     hivemail_send(
       to=["all_workers"],
       subject="[QUALITY ALERT] {issue_pattern}",
       body="<fix_guidance>",
       importance="high",
       thread_id="{epic_id}"
     )
   - Report to coordinator:
     hivemail_send(
       to=["coordinator"],
       subject="[QUALITY] {n} workers affected by {issue}",
       body="<trend_analysis>",
       thread_id="{epic_id}"
     )
4. Continue until:
   - Hive 80% complete (check via beads_query)
   - Coordinator sends "terminate"

## [ALERT FORMAT] (to workers)
Subject: [QUALITY ALERT] {issue_pattern} detected
Body:
- Issue: {description}
- Affected workers: {agent_names}
- Root cause: {likely_cause}
- Recommended fix: {solution}
- Coordinator notified: Yes

## [REPORT FORMAT] (to coordinator)
Subject: [QUALITY] {n} workers affected by {issue}
Body:
- Pattern: {description}
- Affected workers: {count} ({names})
- Impact: {severity}
- Suggested coordinator action:
  - {action1}
  - {action2}
- Alert broadcasted to workers: Yes

## [PATTERNS TO DETECT]
- Compilation errors (TypeScript, build failures)
- Test failures (same test failing across workers)
- API misuse (workers using deprecated patterns)
- Performance issues (workers taking >expected time)

## [CONSTRAINTS]
- Do NOT halt worker execution
- Do NOT modify code yourself
- ONLY broadcast when pattern affects 2+ workers
- Keep alerts actionable (include fix guidance)

Begin monitoring now.
```

## Integration with Existing Tools

### Required Tools for Each Guardian

| Guardian | Required Tools | Optional Tools |
|----------|---------------|----------------|
| Status | hive_status, hivemail_inbox, hivemail_send | beads_query |
| Cleanup | hivemail_inbox, hivemail_release, beads_query, beads_close | beads_update |
| Priority | hivemail_inbox, beads_query, hivemail_send | beads_update |
| Quality | hivemail_inbox, hivemail_send, beads_query | (none) |

**All guardians require**:
- `hivemail_init` (initialize at spawn)
- `hivemail_send` (report findings)

### Tool Usage Patterns

**Status Guardian**:
```typescript
// Poll worker status
hive_status(epic_id, project_key)
// Returns: { workers: [{ agent_name, bead_id, status, progress_percent, last_update }] }

// Check communications
hivemail_inbox()
// Returns: { messages: [...] }

// Report stall
hivemail_send({
  to: ["coordinator"],
  subject: "[STATUS] Worker AgentX stalled",
  body: "Last update 8 min ago...",
  thread_id: epic_id
})
```

**Cleanup Guardian**:
```typescript
// Find orphan beads
beads_query({ status: "in_progress" })
// Returns: { beads: [...] }

// Close orphan
beads_close({
  id: "bead-123",
  reason: "Cleanup: Agent terminated without completion"
})

// Release reservations
hivemail_release({
  reservation_ids: [1, 2, 3]
})
```

**Priority Guardian**:
```typescript
// Find blocked tasks
beads_query({ status: "blocked" })
// Returns: { beads: [...] }

// Report priority suggestion
hivemail_send({
  to: ["coordinator"],
  subject: "[PRIORITY] 2 blocked tasks detected",
  body: "Task X waiting on Task Y...",
  thread_id: epic_id
})
```

**Quality Guardian**:
```typescript
// Check worker messages for patterns
hivemail_inbox()
// Analyze message bodies for common errors

// Broadcast alert
hivemail_send({
  to: ["all_workers"],
  subject: "[QUALITY ALERT] TypeScript error in schema imports",
  body: "Multiple agents hitting: Cannot find module '@/schemas'...",
  importance: "high",
  thread_id: epic_id
})
```

## Example: Full Hive with Guardians

### Scenario: Medium Swarm (5 workers)

**Task**: Refactor API layer across 5 endpoints

**Coordinator spawns**:
1. Status Guardian (monitors all workers)
2. 5 Task Workers (one per endpoint)
3. Priority Guardian (spawns on first BLOCKED message)

```typescript
// Coordinator orchestration
const epicId = "epic-api-refactor";
const projectKey = "/path/to/project";

// 1. Spawn Status Guardian FIRST
Task({
  description: "Status Guardian - monitor API refactor workers",
  prompt: STATUS_GUARDIAN_PROMPT
    .replace(/{epic_id}/g, epicId)
    .replace(/{project_key}/g, projectKey)
});

// 2. Spawn task workers
for (const subtask of subtasks) {
  Task({
    description: `Worker: ${subtask.title}`,
    prompt: formatSubtaskPromptV2({
      bead_id: subtask.bead_id,
      epic_id: epicId,
      subtask_title: subtask.title,
      subtask_description: subtask.description,
      files: subtask.files,
      shared_context: "Refactor to use new API v2 patterns..."
    })
  });
}

// Status Guardian monitors in background
// If worker blocks, coordinator spawns Priority Guardian
// If coordinator detects quality issues, spawns Quality Guardian
// At end, spawns Cleanup Guardian
```

### Timeline

```
T+0 min: Status Guardian spawns, begins monitoring
T+1 min: 5 Task Workers spawn, begin work
T+5 min: Status Guardian reports "All workers progressing normally"
T+10 min: Worker 3 sends BLOCKED message to coordinator
T+11 min: Coordinator spawns Priority Guardian
T+12 min: Priority Guardian reports "Worker 3 blocked on Worker 1 completing shared types"
T+15 min: Worker 1 completes, Worker 3 unblocks
T+20 min: Status Guardian reports "Worker 5 appears stalled (no update 8 min)"
T+21 min: Coordinator checks Worker 5, finds it crashed, respawns
T+30 min: Priority Guardian self-terminates (no blocks 10+ min)
T+35 min: All workers complete
T+36 min: Coordinator spawns Cleanup Guardian
T+37 min: Cleanup Guardian reports "Released 0 reservations, closed 0 beads"
T+38 min: Status Guardian terminates (all workers closed)
T+40 min: Coordinator marks epic complete
```

### Messages Flow

**Status Guardian → Coordinator**:
```
T+5:  [STATUS] All workers progressing normally
T+20: [STATUS] Worker 5 appears stalled (no update 8 min)
```

**Priority Guardian → Coordinator**:
```
T+12: [PRIORITY] 1 blocked task detected
      Worker 3 blocked on Worker 1 (shared types)
```

**Workers → Coordinator**:
```
T+10: [BLOCKED] Worker 3 - waiting on shared types from Worker 1
T+15: [PROGRESS] Worker 1 completed shared types
T+35: [COMPLETE] All workers report completion
```

**Cleanup Guardian → Coordinator**:
```
T+37: [CLEANUP] Released 0 reservations, closed 0 beads
      (No orphans found, hive terminated cleanly)
```

## Guardian Coordination Rules

### Guardians Do Not Interfere With Task Workers

**Strict separation**:
- Guardians NEVER modify files
- Guardians NEVER reserve files
- Guardians NEVER call hive_complete (they're not task workers)
- Guardians REPORT, coordinators ACT

### Guardians Can Communicate With Each Other

**Example**: Priority Guardian detects Quality Guardian's broadcast
```
Quality Guardian broadcasts: "[QUALITY ALERT] TypeScript error in imports"
Priority Guardian reads alert, adjusts priority suggestions accordingly
```

**Protocol**:
- Guardians check hivemail_inbox() for messages from other guardians
- Subject prefix `[GUARDIAN]` marks guardian-to-guardian messages
- Coordinator also sees these messages (transparency)

### Coordinator Manages Guardian Lifecycle

**Spawn**:
```typescript
// Coordinator decides when to spawn
if (workerCount >= 5) {
  spawnStatusGuardian();
  spawnPriorityGuardian();
}
```

**Terminate**:
```typescript
// Coordinator sends terminate message
hivemail_send({
  to: ["status_guardian_agent_name"],
  subject: "Terminate",
  body: "Hive complete, cleanup finished. Thank you.",
  thread_id: epicId
});
```

**Authority delegation** (optional):
```typescript
// Coordinator can authorize guardians to take action
hivemail_send({
  to: ["priority_guardian"],
  subject: "Authority Granted",
  body: "You may update bead priorities directly for blocked tasks.",
  thread_id: epicId
});
```

## Anti-Patterns and Gotchas

### Don't Spawn Guardians Too Early

**Anti-pattern**: Spawn all guardians immediately on every hive
```typescript
// ❌ Bad: Wastes resources on small hives
spawnStatusGuardian();
spawnCleanupGuardian();  // Why cleanup before work starts?
spawnPriorityGuardian(); // No tasks blocked yet
spawnQualityGuardian();
```

**Best practice**: Spawn based on hive state
```typescript
// ✓ Good: Status guardian on all hives
spawnStatusGuardian();

// ✓ Good: Cleanup only at end or on crash
if (hiveComplete || crashDetected) {
  spawnCleanupGuardian();
}

// ✓ Good: Priority only when needed
if (blockedTasksDetected) {
  spawnPriorityGuardian();
}

// ✓ Good: Quality on large/critical hives
if (workerCount > 5 || criticalFeature) {
  spawnQualityGuardian();
}
```

### Don't Let Guardians Take Action Without Coordinator

**Anti-pattern**: Guardian modifies beads/reservations directly
```typescript
// ❌ Bad: Guardian closes bead without coordinator knowledge
beads_close(id, reason="Guardian determined this is stale");
```

**Best practice**: Guardian reports, coordinator decides
```typescript
// ✓ Good: Guardian reports finding
hivemail_send({
  to: ["coordinator"],
  subject: "[STATUS] Bead X appears abandoned",
  body: "Suggest closing: no activity 15 min, agent offline",
  thread_id: epicId
});

// Coordinator then decides: close, reassign, or wait
```

**Exception**: Cleanup Guardian has implicit authority for cleanup operations (since it's spawned specifically for that purpose).

### Don't Spawn Multiple Guardians of Same Type

**Anti-pattern**: Spawn 3 Status Guardians "for redundancy"
```typescript
// ❌ Bad: Redundant monitoring
spawnStatusGuardian(); // Agent 1
spawnStatusGuardian(); // Agent 2
spawnStatusGuardian(); // Agent 3
// Result: 3x the messages, no added value
```

**Best practice**: One guardian per type, per epic
```typescript
// ✓ Good: Single Status Guardian
if (!statusGuardianSpawned) {
  spawnStatusGuardian();
  statusGuardianSpawned = true;
}
```

### Don't Let Guardians Run Forever

**Anti-pattern**: No termination condition
```typescript
// ❌ Bad: Guardian loops forever
while (true) {
  checkStatus();
  sleep(2 minutes);
}
```

**Best practice**: Guardian has termination conditions
```typescript
// ✓ Good: Self-terminate when done
while (!shouldTerminate) {
  checkStatus();
  sleep(2 minutes);
  
  // Check termination conditions
  if (allWorkersClosed || duration > 60 min) {
    shouldTerminate = true;
  }
  
  // Check for coordinator terminate message
  const inbox = hivemail_inbox();
  if (inbox.messages.some(m => m.subject === "Terminate")) {
    shouldTerminate = true;
  }
}

// Send final report and exit
```

## Advanced Patterns

### Hierarchical Guardians

**Concept**: Status Guardian spawns Cleanup Guardian when it detects crashed worker

```markdown
# Status Guardian Prompt (Enhanced)

## Additional Authority
If you detect a crashed worker (no response >10 min, offline status):
1. Report to coordinator
2. Spawn Cleanup Guardian to release that worker's reservations
3. Use hivemail_send to instruct Cleanup Guardian which reservations to target
```

**Use case**: Faster cleanup without waiting for coordinator to notice

**Risk**: Guardians spawning guardians can get out of control. Recommend limiting to 1 level deep.

### Guardian Consensus

**Concept**: Multiple guardians agree before reporting critical issues

```markdown
# Priority Guardian + Quality Guardian Consensus

Priority Guardian detects blocked task.
Quality Guardian detects quality issue in blocker.
Both report to coordinator with cross-reference:
  "[PRIORITY+QUALITY] Task X blocked AND blocker has quality issues"
```

**Use case**: Higher confidence in critical decisions

**Implementation**: Guardians read each other's messages via hivemail_inbox()

### Guardian Handoff

**Concept**: Status Guardian hands off to Recovery Guardian when issue persists

```markdown
# Status Guardian Prompt

If same worker stalled >3 reports:
1. Spawn Recovery Guardian
2. Send context: worker name, bead ID, last known state
3. Recovery Guardian investigates: Check logs, attempt recovery, report
4. Status Guardian continues monitoring others
```

**Use case**: Specialized recovery without loading Status Guardian with recovery logic

## Future Enhancements

### 1. Guardian Skills

Create reusable skills for guardian patterns:
```
global-skills/
  status-guardian/
    SKILL.md
    references/
      stall-detection-heuristics.md
```

**Benefit**: Guardians become smarter over time as learnings accumulate

### 2. Guardian Telemetry

Track guardian effectiveness:
- How many stalls did Status Guardian catch?
- How many resources did Cleanup Guardian release?
- How many blockers did Priority Guardian resolve?

**Benefit**: Measure ROI of guardian patterns

### 3. Adaptive Guardian Spawning

Coordinator learns when to spawn guardians based on task type:
```typescript
// Learned pattern: "API refactors always have blockers"
if (taskType === "api-refactor") {
  spawnPriorityGuardian(); // Don't wait for first BLOCKED message
}
```

**Benefit**: Proactive rather than reactive guardian deployment

## Summary

Guardian workers are **non-work subagents** that coordinators spawn to handle meta-concerns:

| Guardian | Purpose | When to Spawn | Tools |
|----------|---------|--------------|-------|
| Status | Detect stalls | Hive start | hive_status, hivemail_* |
| Cleanup | Release resources | Hive end/crash | beads_*, hivemail_release |
| Priority | Unblock tasks | On BLOCKED | beads_query, hivemail_* |
| Quality | Enforce standards | Large hives | hivemail_*, beads_query |

**Key principles**:
- Zero-config (use existing tools only)
- Report via Hive Mail (coordinator decides actions)
- Spawn as needed (don't over-deploy)
- Terminate when done (don't run forever)

**Next steps**:
1. Add guardian patterns to hive-coordination skill
2. Create guardian prompt templates in hive-prompts.ts
3. Update coordinator logic to spawn guardians based on heuristics
4. Add guardian effectiveness tracking to learning system
