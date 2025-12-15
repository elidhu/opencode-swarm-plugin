# Migration Guide

## Version 0.20.0

### What's New

This release introduces three major features focused on reliability, testing, and continuous improvement:

#### 1. Adapter Pattern
Database abstraction layer enabling:
- **In-memory testing** - 10x faster tests with isolated state
- **Alternative storage backends** - Swap PGLite for SQLite, PostgreSQL, Redis, etc.
- **Dependency injection** - Custom storage implementations for specialized use cases

**Key Files:**
- `src/types/database.ts` - `DatabaseAdapter` interface
- `src/types/adapter.ts` - `SwarmMailAdapter` interface
- `src/adapter.ts` - Factory functions and implementations

#### 2. Checkpoint/Recovery System
Agent crash recovery with progress preservation:
- **Auto-checkpointing** at 25%, 50%, 75% progress milestones
- **Point-in-time recovery** with complete task context
- **Dual-write pattern** - Event stream for audit + Table for fast queries
- **Directive preservation** - Task-specific instructions survive crashes

**Key Files:**
- `src/schemas/checkpoint.ts` - `SwarmBeadContext`, `ProgressMilestone` schemas
- `src/checkpoint.ts` - `saveCheckpoint()`, `loadCheckpoint()`, `listCheckpoints()`

#### 3. Eval Capture System
Data-driven decomposition improvement:
- **Lifecycle tracking** - Input → Planning → Execution → Metrics
- **Quality metrics** - Scope accuracy, time balance, file overlap
- **Continuous learning** - JSONL storage for analysis with evalite
- **31-field schema** - Complete decomposition quality tracking

**Key Files:**
- `src/eval-capture.ts` - Capture functions and metric calculations
- `.opencode/eval-data.jsonl` - Append-only storage (auto-created)

---

### Breaking Changes

**None** - All new features are backward compatible.

Existing code continues to work without modifications. New features are opt-in.

---

### Automatic Migrations

The plugin includes automatic database migrations that run on first use:

#### Migration 4: Checkpoint Storage
Adds `swarm_contexts` table for checkpoint/recovery:

```sql
CREATE TABLE IF NOT EXISTS swarm_contexts (
  id SERIAL PRIMARY KEY,
  epic_id TEXT NOT NULL,
  bead_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  context JSONB NOT NULL,
  progress_percent INTEGER DEFAULT 0,
  milestone TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(epic_id, bead_id, agent_name)
);
```

**What happens:**
- Migration runs automatically on first plugin initialization
- No manual database changes required
- Safe to run multiple times (idempotent)
- Logs migration progress to console

**Verification:**
```bash
# Check migration status
hive doctor

# Verify database health
# In OpenCode:
hivemail_health()
```

---

### Opt-In Features

#### Using the Adapter Pattern

**For Testing:**
```typescript
import { createSwarmMailAdapter } from 'opencode-hive-plugin';

// In your test setup
const adapter = await createSwarmMailAdapter({ inMemory: true });

// Use adapter in tests
const stats = await adapter.getStats();
await adapter.close(); // Cleanup
```

**For Production:**
```typescript
// Default behavior (PGLite) - no changes needed
const adapter = await createSwarmMailAdapter({
  projectPath: process.cwd()
});

// Custom database adapter
import { MyCustomAdapter } from './my-adapter';
const adapter = await createSwarmMailAdapter({
  dbOverride: new MyCustomAdapter()
});
```

#### Enabling Checkpoint/Recovery

**Automatic Checkpointing:**

The system auto-saves at progress milestones when using `hive_progress`:

```typescript
// In worker agents - progress reporting auto-triggers checkpoints
hive_progress({
  project_key: projectPath,
  agent_name: "worker-1",
  bead_id: "bd-abc123.1",
  status: "in_progress",
  progress_percent: 50,  // Checkpoint saved at 25, 50, 75
  message: "Halfway through implementation"
});
```

**Manual Checkpointing:**

For fine-grained control:

```typescript
import { saveCheckpoint, getMilestone } from 'opencode-hive-plugin';

await saveCheckpoint({
  epic_id: "bd-abc123",
  bead_id: "bd-abc123.1",
  agent_name: "worker-1",
  task_description: "Implement authentication",
  files: ["src/auth.ts"],
  strategy: "feature-based",
  progress_percent: 65,
  last_milestone: getMilestone(65), // "half"
  directives: ["Use OAuth 2.0", "Add rate limiting"],
  files_touched: ["src/auth.ts"]
});
```

**Recovery After Crash:**

Coordinator agents should check for checkpoints before spawning workers:

```typescript
import { loadCheckpoint } from 'opencode-hive-plugin';

// Check for existing checkpoint
const recovery = await loadCheckpoint({
  epic_id: "bd-abc123",
  bead_id: "bd-abc123.1"
});

if (recovery.success && recovery.context) {
  // Resume from checkpoint
  console.log(`Recovered: ${recovery.context.progress_percent}% complete`);
  
  // Include recovery context in worker prompt
  const prompt = hive_subtask_prompt({
    agent_name: "worker-1",
    bead_id: recovery.context.bead_id,
    epic_id: recovery.context.epic_id,
    subtask_title: recovery.context.task_description,
    files: recovery.context.files,
    shared_context: `RECOVERY MODE: Resume from ${recovery.context.last_milestone} milestone.
Files already touched: ${recovery.context.files_touched.join(', ')}
Directives: ${recovery.context.directives?.join('; ')}`
  });
} else if (recovery.fresh_start) {
  // No checkpoint found - start fresh
  console.log("Starting new subtask from scratch");
}
```

#### Enabling Eval Capture

**Integration with Decomposition:**

Enable capture by passing `capture_eval: true` to validation:

```typescript
// In coordinator workflow
const validated = await hive_validate_decomposition({
  response: llmResponse,
  capture_eval: true  // Enable eval capture
});

if (validated.success) {
  console.log(`Eval record created: ${validated.eval_id}`);
}
```

**Recording Subtask Outcomes:**

Worker agents or coordinator should record outcomes:

```typescript
import { captureSubtaskOutcome } from 'opencode-hive-plugin';

// After subtask completes
await captureSubtaskOutcome(epicId, {
  bead_id: "bd-abc123.1",
  title: "Implement OAuth client",
  agent_name: "worker-1",
  duration_ms: Date.now() - startTime,
  files_touched: ["src/auth.ts", "src/oauth.ts"],
  success: true,
  error_count: 0,
  retry_count: 0,
  timestamp: new Date().toISOString()
});
```

**Finalizing Eval Records:**

When epic is complete:

```typescript
import { finalizeEvalRecord } from 'opencode-hive-plugin';

// Mark eval record as finalized and compute final metrics
await finalizeEvalRecord(epicId);
```

**Analyzing Quality:**

```typescript
import { getEvalSummary, queryEvalRecords } from 'opencode-hive-plugin';

// Get overall statistics
const summary = await getEvalSummary();
console.log(`
Total decompositions: ${summary.total_decompositions}
Quality pass rate: ${(summary.quality_passed_count / summary.finalized_count * 100).toFixed(1)}%
Avg scope accuracy: ${(summary.avg_scope_accuracy * 100).toFixed(1)}%
Avg time balance: ${summary.avg_time_balance.toFixed(2)}x
Strategies used: ${Object.entries(summary.by_strategy).map(([k, v]) => `${k}: ${v}`).join(', ')}
`);

// Query specific records
const fileBasedEvals = await queryEvalRecords({
  strategy: "file-based",
  finalized: true,
  qualityPassed: false
});

console.log(`Found ${fileBasedEvals.length} file-based decompositions with quality issues`);
for (const eval of fileBasedEvals) {
  console.log(`- ${eval.epic_title}: ${eval.quality_issues?.join(', ')}`);
}
```

---

### Required Actions

**None** - Existing projects continue to work without changes.

The plugin is fully backward compatible:
- Existing Swarm Mail operations work as before
- Database migrations run automatically
- New features are disabled by default

---

### Recommended Actions

While no actions are required, consider these improvements:

#### 1. Update Skills
Add new feature workflows to project or global skills:

**Checkpoint/Recovery Skill:**
```bash
# Create skill for checkpoint best practices
skills_create({
  name: "checkpoint-recovery",
  scope: "project",
  description: "Best practices for agent checkpoint and recovery"
})
```

**Eval Capture Skill:**
```bash
# Create skill for eval capture workflow
skills_create({
  name: "eval-capture",
  scope: "project",
  description: "Workflow for capturing and analyzing decomposition quality"
})
```

#### 2. Enable Eval Capture for Insights
Start collecting decomposition quality data:

```typescript
// In coordinator workflows
const validated = await hive_validate_decomposition({
  response: llmResponse,
  capture_eval: true  // Enable data collection
});
```

After a few decompositions, analyze patterns:
```bash
# View eval data
cat .opencode/eval-data.jsonl | jq .

# Analyze in OpenCode or scripts
const summary = await getEvalSummary();
```

#### 3. Use Adapter Pattern for Faster Tests
Speed up test suites by using in-memory adapters:

```typescript
// test-setup.ts
import { createSwarmMailAdapter } from 'opencode-hive-plugin';

export async function setupTestAdapter() {
  return await createSwarmMailAdapter({ inMemory: true });
}

// your-test.test.ts
import { setupTestAdapter } from './test-setup';

describe('My Feature', () => {
  let adapter;
  
  beforeEach(async () => {
    adapter = await setupTestAdapter();
  });
  
  afterEach(async () => {
    await adapter.close();
  });
  
  test('works with in-memory storage', async () => {
    // 10x faster than PGLite!
    const stats = await adapter.getStats();
    expect(stats.events).toBe(0);
  });
});
```

---

### Verification

After upgrading to v0.20.0, verify the migration:

#### 1. Check Version
```bash
hive version
# Should show: 0.20.0 or higher
```

#### 2. Verify Database Health
```bash
# CLI health check
hive doctor

# Or in OpenCode:
hivemail_health()
```

**Expected output:**
```json
{
  "success": true,
  "healthy": true,
  "database": "connected",
  "migrations": "up to date",
  "version": 4
}
```

#### 3. Test Checkpoint Storage
```typescript
// In OpenCode
import { saveCheckpoint, loadCheckpoint } from 'opencode-hive-plugin';

// Save test checkpoint
await saveCheckpoint({
  epic_id: "test-epic",
  bead_id: "test-bead",
  agent_name: "test-agent",
  task_description: "Test checkpoint",
  files: ["test.ts"],
  strategy: "file-based",
  progress_percent: 50,
  last_milestone: "half"
});

// Verify recovery
const result = await loadCheckpoint({
  epic_id: "test-epic",
  bead_id: "test-bead"
});

console.log(result.success ? "✓ Checkpoint system working" : "✗ Checkpoint system failed");
```

#### 4. Check Eval Capture
```typescript
// In OpenCode
import { getEvalSummary } from 'opencode-hive-plugin';

const summary = await getEvalSummary();
console.log(`Eval capture initialized: ${summary.total_decompositions} records`);
// Should show: Eval capture initialized: 0 records (for fresh installs)
```

---

### Troubleshooting

#### Migration Fails

**Error:** `Migration failed: table swarm_contexts already exists`

**Solution:** This is safe to ignore - the table was created by a previous run. The plugin uses `IF NOT EXISTS` clauses.

#### Checkpoint Save Fails

**Error:** `Failed to save checkpoint: table swarm_contexts does not exist`

**Solution:** Force migration to run:
```bash
# Delete database to trigger fresh migration
rm -rf .hive/swarm-mail.db

# Restart plugin - migration will run automatically
hive doctor
```

#### Eval Capture Not Working

**Error:** `ENOENT: no such file or directory, open '.opencode/eval-data.jsonl'`

**Solution:** The directory is auto-created on first capture. If you see this error, check file permissions:
```bash
# Ensure .opencode directory exists and is writable
mkdir -p .opencode
chmod 755 .opencode
```

#### In-Memory Adapter Issues

**Error:** `In-memory adapter doesn't support complex queries`

**Solution:** The in-memory adapter is simplified for testing. It doesn't support:
- JOINs
- Subqueries
- Complex WHERE clauses with OR
- Aggregate functions

For full SQL support, use PGLite:
```typescript
const adapter = await createSwarmMailAdapter({
  projectPath: process.cwd()  // Use PGLite
});
```

---

### Rollback

If you need to revert to v0.19.x:

```bash
# Downgrade plugin
npm install opencode-hive-plugin@0.19.0

# Database is forward-compatible - no changes needed
# Checkpoints will be ignored by older versions (safe)
```

**Note:** Checkpoints and eval data are stored separately and won't interfere with older versions. You can safely downgrade and upgrade without data loss.

---

### Support

For issues or questions:

- **GitHub Issues**: https://github.com/elidhu/opencode-hive-plugin/issues
- **Documentation**: See README.md for API examples
- **Skills**: Browse `examples/skills/` for usage patterns

---

### Changelog

See full changelog at [GitHub Releases](https://github.com/elidhu/opencode-hive-plugin/releases).
