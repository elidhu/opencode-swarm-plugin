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
| [semantic-memory](https://github.com/joelhooks/semantic-memory) | No | Learning persistence |

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

MIT
