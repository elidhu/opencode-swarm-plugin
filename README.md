# opencode-hive-plugin

Multi-agent coordination for OpenCode.

```
  / \__/ \__/ \__/ \__/ \
  \__/ \__/ \__/ \__/ \__/
  / \__/ \__/ \__/ \__/ \
  \__/ \__/ \__/ \__/ \__/

 ██╗  ██╗██╗██╗   ██╗███████╗
 ██║  ██║██║██║   ██║██╔════╝
 ███████║██║██║   ██║█████╗  
 ██╔══██║██║╚██╗ ██╔╝██╔══╝  
 ██║  ██║██║ ╚████╔╝ ███████╗
 ╚═╝  ╚═╝╚═╝  ╚═══╝  ╚══════╝
```

## Install

```bash
npm install -g opencode-hive-plugin@latest
hive setup
```

Then in your project:

```bash
cd your-project
hive init
```

## Usage

In OpenCode:

```
/hive "Add user authentication with OAuth"
```

Or invoke the planner directly:

```
@hive-planner "Refactor all components to use hooks"
```

## Features

### Adapter Pattern
**Database abstraction for testing and alternative storage backends**

The adapter pattern provides a clean abstraction layer over database operations, enabling:
- **10x faster tests** with in-memory storage (no disk I/O, no shared state)
- **Alternative backends** (PGLite, SQLite, PostgreSQL, Redis, IndexedDB)
- **Dependency injection** for custom storage implementations

```typescript
import { createSwarmMailAdapter } from 'opencode-hive-plugin';

// Production: PGLite-backed storage
const adapter = await createSwarmMailAdapter({
  projectPath: "/path/to/project"
});

// Testing: In-memory (fast, isolated)
const adapter = await createSwarmMailAdapter({
  inMemory: true
});

// Custom: Bring your own database
const adapter = await createSwarmMailAdapter({
  dbOverride: myCustomDatabaseAdapter
});
```

Key interfaces:
- `DatabaseAdapter` - Low-level SQL abstraction (query, exec, transactions)
- `SwarmMailAdapter` - High-level business operations (messages, reservations, events)

### Checkpoint/Recovery
**Agent crash recovery with progress preservation**

The checkpoint system enables agents to resume work after crashes by saving progress at key milestones:

```typescript
import { saveCheckpoint, loadCheckpoint } from 'opencode-hive-plugin';

// Save checkpoint (auto-triggered at 25%, 50%, 75% progress)
await saveCheckpoint({
  epic_id: "bd-abc123",
  bead_id: "bd-abc123.1",
  agent_name: "worker-1",
  task_description: "Implement authentication",
  files: ["src/auth.ts", "src/middleware.ts"],
  strategy: "file-based",
  progress_percent: 50,
  last_milestone: "half",
  directives: ["Use OAuth 2.0", "Add rate limiting"]
});

// Recover after crash
const result = await loadCheckpoint({
  epic_id: "bd-abc123",
  bead_id: "bd-abc123.1"
});

if (result.success && result.context) {
  console.log(`Resuming from ${result.context.progress_percent}%`);
  console.log(`Last milestone: ${result.context.last_milestone}`);
  console.log(`Files to continue: ${result.context.files.join(', ')}`);
}
```

**Architecture:**
- **Dual-write pattern**: Event stream (audit trail) + Table (fast queries)
- **Auto-checkpointing**: Triggered at 25%, 50%, 75% milestones
- **Point-in-time recovery**: Complete context restoration with directives
- **Schema**: `SwarmBeadContext` stores task state, progress, files, and directives

### Eval Capture
**Data-driven decomposition improvement**

The eval capture system records every decomposition with complete lifecycle tracking for continuous improvement:

```typescript
import { 
  captureDecomposition, 
  captureSubtaskOutcome,
  finalizeEvalRecord,
  getEvalSummary 
} from 'opencode-hive-plugin';

// 1. Capture decomposition plan
const evalId = await captureDecomposition({
  task: "Add user authentication",
  strategy: "feature-based",
  beadTree: generatedBeadTree,
  epicId: "bd-abc123",
  maxSubtasks: 5
});

// 2. Record each subtask outcome
await captureSubtaskOutcome("bd-abc123", {
  bead_id: "bd-abc123.1",
  title: "Implement OAuth client",
  agent_name: "worker-1",
  duration_ms: 120000,
  files_touched: ["src/auth.ts", "src/oauth.ts"],
  success: true,
  error_count: 0,
  retry_count: 0,
  timestamp: new Date().toISOString()
});

// 3. Finalize and compute metrics
await finalizeEvalRecord("bd-abc123");

// 4. Analyze quality over time
const summary = await getEvalSummary();
console.log(`Quality pass rate: ${summary.quality_passed_count / summary.finalized_count}`);
console.log(`Avg scope accuracy: ${summary.avg_scope_accuracy.toFixed(2)}`);
console.log(`Avg time balance: ${summary.avg_time_balance.toFixed(2)}`);
```

**Key Metrics:**
- **Scope Accuracy**: `actual_files / planned_files` (goal: 0.8-1.2)
- **Time Balance**: `max_duration / min_duration` (goal: < 3.0)
- **File Overlap**: Count of files in multiple subtasks (goal: 0)
- **Success Rate**: Percentage of subtasks completed successfully

**Storage:** Append-only JSONL at `.opencode/eval-data.jsonl` for analysis with evalite scorers

## CLI

```
hive setup     Interactive installer
hive doctor    Health check
hive init      Initialize beads in current project
hive config    Show paths to generated config files
hive version   Show version
hive help      Show help
```

## Tools

### Hive Orchestration

| Tool | Description |
|------|-------------|
| `hive_init` | Initialize session |
| `hive_select_strategy` | Analyze task, recommend decomposition strategy |
| `hive_plan_prompt` | Generate strategy-specific planning prompt |
| `hive_decompose` | Generate decomposition prompt |
| `hive_validate_decomposition` | Validate response, detect file conflicts |
| `hive_spawn_subtask` | Generate worker agent prompt |
| `hive_status` | Get progress by epic ID |
| `hive_progress` | Report subtask progress |
| `hive_complete` | Complete subtask, release reservations |

### Hive Mail

| Tool | Description |
|------|-------------|
| `hivemail_init` | Initialize session, register agent |
| `hivemail_send` | Send message to agents |
| `hivemail_inbox` | Fetch inbox (max 5, no bodies) |
| `hivemail_read_message` | Fetch single message body |
| `hivemail_reserve` | Reserve file paths for exclusive editing |
| `hivemail_release` | Release file reservations |
| `hivemail_ack` | Acknowledge message |
| `hivemail_health` | Check database health |

### Beads

| Tool | Description |
|------|-------------|
| `beads_create` | Create bead with type-safe validation |
| `beads_create_epic` | Create epic + subtasks atomically |
| `beads_query` | Query beads with filters |
| `beads_update` | Update status/description/priority |
| `beads_close` | Close bead with reason |
| `beads_start` | Mark bead as in-progress |
| `beads_ready` | Get next unblocked bead |
| `beads_sync` | Sync to git and push |

### Skills

| Tool | Description |
|------|-------------|
| `skills_list` | List available skills |
| `skills_read` | Read skill content |
| `skills_use` | Get skill formatted for context injection |
| `skills_create` | Create new skill |

## Decomposition Strategies

**file-based** - Best for refactoring, migrations. Group files by directory.

**feature-based** - Best for new features. Each subtask is a vertical slice.

**risk-based** - Best for bug fixes. Write tests first, isolate risky changes.

## Dependencies

| Dependency | Required | Description |
|------------|----------|-------------|
| [OpenCode](https://opencode.ai) | Yes | Plugin host |
| [Beads](https://github.com/steveyegge/beads) | Yes | Git-backed issue tracking |

**Storage:** Hive uses embedded LanceDB for learning persistence with zero configuration. Data is stored locally in the `.hive/vectors/` directory using Transformers.js for local embeddings (all-mpnet-base-v2 model, 768-dimensional vectors).

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

MIT
