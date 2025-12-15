# Discovery Queue System Design

**Status**: Revised for Zero-Config + Existing Infrastructure  
**Original Author**: BlueMountain (Hive Agent)  
**Revised By**: BrightDusk (Hive Agent)  
**Date**: 2025-12-15  
**Related Beads**: opencode-swarm-plugin-rxu.1, opencode-swarm-plugin-mmx.2

## Revision Summary

This document has been revised to leverage **existing infrastructure** and ensure **zero-config operation**:

- **Storage**: Changed from `.hive/discoveries.jsonl` to existing LanceDB at `.hive/vectors`
- **Semantic Search**: Changed from "Future: LanceDB" to "Immediate: via storage.ts"
- **Tools**: Clarified use of existing `beads_create()`, `hivemail_send()`, storage methods
- **Migration**: Simplified from 4 phases to 2 (no storage implementation needed)
- **Added**: Zero-Config Verification section
- **Added**: Quality Guardian Integration section

**Key Insight**: Discovery Queue can be implemented as a thin wrapper over existing storage, with `kind="discovery"` as the only new concept.

## Executive Summary

The Discovery Queue system provides a "parking lot" mechanism for agents to log out-of-scope findings during task execution without breaking focus. This addresses a common pattern where agents encounter bugs, technical debt, or opportunities while working on their assigned subtasks.

**Key Innovation**: Agents can quickly log discoveries with minimal context switching, while coordinators/humans handle triage asynchronously.

## Problem Statement

### Current Pain Points

1. **Focus Disruption**: Agents get distracted investigating interesting but out-of-scope findings
2. **Lost Knowledge**: Valuable discoveries are forgotten if not immediately acted upon
3. **Incomplete Reporting**: Summary mentions "found some bugs" without actionable details
4. **No Triage Path**: No structured way to evaluate discovered work against priorities

### Real-World Scenarios

```typescript
// Agent working on: "Add auth middleware"
// Discovers: SQL injection in unrelated file
// Current behavior: Either ignore (lost) or investigate (derailed)
// Desired: Log to queue, continue with auth work
```

```typescript
// Agent working on: "Fix bug in checkout flow"
// Discovers: Entire payment module has no tests
// Current behavior: Mention in summary, promptly forgotten
// Desired: Logged with effort estimate, triaged by coordinator
```

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     HIVE AGENT                          │
│                                                         │
│  Working on:                                           │
│  subtask-123 "Implement feature X"                     │
│                                                         │
│  ┌────────────────────────────────────┐               │
│  │ DISCOVERS: Security issue in Y     │               │
│  │                                     │               │
│  │ Action: discovery_log()             │               │
│  │  ↓                                  │               │
│  │  type: "security"                   │               │
│  │  urgency: "high"                    │               │
│  │  title: "SQL injection in auth.ts" │               │
│  │  files: ["src/auth.ts"]            │               │
│  │  discovered_during: "subtask-123"   │               │
│  │                                     │               │
│  │ Result: Discovery disc-x7y created │               │
│  │         Agent continues with X      │               │
│  └────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              DISCOVERY QUEUE STORAGE                    │
│                                                         │
│  Storage: LanceDB at .hive/vectors (zero-config)       │
│  Search: Semantic search via existing storage.ts       │
│                                                         │
│  Entry:                                                 │
│  {                                                      │
│    id: "disc-x7y",                                     │
│    type: "security",                                   │
│    status: "open",                                     │
│    urgency: "high",                                    │
│    title: "SQL injection in auth.ts",                 │
│    discovered_by: "agent-BlueMountain",               │
│    discovered_during: "subtask-123",                   │
│    related_files: ["src/auth.ts"],                    │
│    created_at: "2025-12-15T10:30:00Z"                 │
│  }                                                     │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              COORDINATOR / TRIAGE                       │
│                                                         │
│  Commands:                                              │
│  - discovery_query(urgency: "high")                    │
│  - discovery_promote(id: "disc-x7y")                   │
│  - discovery_update(id: "disc-x7y", status: "deferred")│
│                                                         │
│  Workflow:                                              │
│  1. Review discoveries in queue                         │
│  2. Evaluate against current priorities                 │
│  3. Promote urgent items to beads                       │
│  4. Defer or reject low-priority items                  │
│  5. Link promoted beads back to discovery               │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   BEADS SYSTEM                          │
��                                                         │
│  Created:                                               │
│  bead-abc (type: bug, priority: 1)                     │
│  "Fix SQL injection in auth.ts"                        │
│                                                         │
│  metadata: {                                            │
│    discovery_id: "disc-x7y",                           │
│    discovered_by: "agent-BlueMountain"                 │
│  }                                                     │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
[Agent Work] → [Discovery Event] → [Queue Storage] → [Coordinator Triage] → [Bead Creation]
     ↓                                                          ↓
[Continues Task]                                      [Status Updates]
```

## Schema Design

See `src/schemas/discovery.ts` for full TypeScript definitions.

### Core Types

```typescript
// Discovery categorization
type DiscoveryType = 
  | "bug"           // Functional defect
  | "debt"          // Technical debt
  | "security"      // Security concern
  | "performance"   // Performance issue
  | "idea"          // Feature enhancement
  | "question"      // Needs clarification
  | "documentation" // Docs issue
  | "test"          // Missing tests
  | "dependency"    // Dependency issue
  | "other";        // Uncategorized

// Triage urgency (not the same as bead priority)
type DiscoveryUrgency = 
  | "critical"  // Blocks work or production issue
  | "high"      // Should address this sprint
  | "medium"    // Triage within a week
  | "low"       // Nice to have
  | "info";     // Informational only

// Lifecycle status
type DiscoveryStatus = 
  | "open"      // Awaiting triage
  | "triaged"   // Reviewed by coordinator
  | "promoted"  // Converted to bead
  | "deferred"  // Postponed
  | "duplicate" // Already tracked
  | "rejected"  // Not actionable
  | "resolved"; // Fixed without bead
```

### Core Entry

```typescript
interface DiscoveryEntry {
  // Identity
  id: string;
  type: DiscoveryType;
  urgency: DiscoveryUrgency;
  status: DiscoveryStatus;
  
  // Content
  title: string;                    // One-line summary
  description: string;              // Full explanation
  related_files: string[];          // Affected files
  code_context?: string;            // Snippets/errors
  suggested_action?: string;        // Agent's recommendation
  estimated_effort?: 1..5;          // Effort scale
  
  // Attribution
  discovered_by: string;            // Agent name
  discovered_during: BeadId;        // Parent bead
  thread_id?: string;               // Hive mail thread
  
  // Integration
  promoted_to_bead?: BeadId;        // If promoted
  tags: string[];                   // For filtering
  
  // Timestamps
  created_at: string;               // ISO-8601
  updated_at: string;               // ISO-8601
  
  // Extensibility
  metadata?: Record<string, unknown>;
}
```

## API Surface

**Note**: The tool API surface remains unchanged. Implementation uses existing LanceDB storage instead of JSONL.

### Agent Operations

```typescript
// Log a discovery without breaking focus
discovery_log(args: DiscoveryCreateArgs): DiscoveryEntry

// Implementation: Stores to LanceDB via storage.storePattern()
// with kind="discovery", zero setup required

interface DiscoveryCreateArgs {
  type: DiscoveryType;
  urgency: DiscoveryUrgency;
  title: string;
  description: string;
  related_files?: string[];
  code_context?: string;
  suggested_action?: string;
  estimated_effort?: 1..5;
  tags?: string[];
}
```

**Agent Workflow**:
```typescript
// Agent discovers security issue while working on feature
const discovery = await discovery_log({
  type: "security",
  urgency: "high",
  title: "SQL injection vulnerability in auth.ts",
  description: "Found raw string concatenation in login query...",
  related_files: ["src/auth.ts", "src/db/queries.ts"],
  code_context: "```typescript\nconst query = `SELECT * FROM users WHERE email='${email}'`\n```",
  suggested_action: "Use parameterized queries or ORM",
  estimated_effort: 2,
  tags: ["security", "auth", "database"]
});

// Agent continues with original task
// No context switch required
```

### Coordinator Operations

```typescript
// Query discoveries for triage
discovery_query(args: DiscoveryQueryArgs): DiscoveryEntry[]
// Implementation: Filters storage.getAllPatterns() by kind="discovery"

// Update discovery status
discovery_update(args: DiscoveryUpdateArgs): DiscoveryEntry
// Implementation: Updates pattern in LanceDB, preserves embeddings

// Promote discovery to bead
discovery_promote(args: DiscoveryPromoteArgs): DiscoveryPromoteResult
// Implementation: Wraps beads_create() with "discovered-from" dependency

// Get queue statistics
discovery_stats(): DiscoveryStats
// Implementation: Aggregates from LanceDB patterns with kind="discovery"
```

**Coordinator Workflow**:
```typescript
// 1. Check high-urgency discoveries
const urgent = await discovery_query({ 
  urgency: "high", 
  status: "open" 
});

// 2. Review and promote to bead
for (const disc of urgent) {
  if (shouldAddress(disc)) {
    const result = await discovery_promote({
      discovery_id: disc.id,
      bead_priority: 1, // High priority bead
      parent_bead_id: currentEpic.id
    });
    
    // Result:
    // - Discovery status → "promoted"
    // - Bead created with discovery context
    // - Link preserved: discovery.promoted_to_bead
  } else {
    await discovery_update({
      id: disc.id,
      status: "deferred",
      metadata: { deferred_reason: "Low priority vs sprint goals" }
    });
  }
}
```

## Storage Implementation

### LanceDB Backend (Zero-Config)

Discoveries use the **existing** LanceDB storage at `.hive/vectors` with zero configuration required.

```typescript
// Leverage existing storage.ts infrastructure
import { getStorage } from "./storage";

// Store discovery as a pattern with kind="discovery"
await storage.storePattern({
  id: discovery.id,
  content: `${discovery.title}\n\n${discovery.description}\n\nFiles: ${discovery.related_files.join(", ")}`,
  kind: "discovery" as PatternKind, // New kind value
  is_negative: false,
  tags: [...discovery.tags, discovery.type, discovery.urgency],
  created_at: discovery.created_at,
  updated_at: discovery.updated_at,
  // Discovery-specific metadata stored in pattern fields
  success_count: 0, // unused for discoveries
  failure_count: 0, // unused for discoveries
  example_beads: [discovery.discovered_during],
  reason: discovery.suggested_action,
});
```

### Schema Extension

Extend `PatternKindSchema` to support discoveries:

```typescript
// In src/pattern-maturity.ts
export const PatternKindSchema = z.enum([
  "pattern", 
  "anti_pattern",
  "discovery" // NEW: for discovery queue entries
]);
```

### Immediate Semantic Search

LanceDB provides semantic search **out of the box** via existing `findSimilarPatterns`:

```typescript
// Find similar discoveries using existing API
const similar = await storage.findSimilarPatterns(
  "authentication security issues",
  10
);

// Filter to discoveries only
const discoveries = similar.filter(p => p.kind === "discovery");
```

### Query Operations

```typescript
// Get all open discoveries
const allPatterns = await storage.getAllPatterns();
const discoveries = allPatterns.filter(p => p.kind === "discovery");

// Query by tags (type, urgency, status stored as tags)
const highUrgency = await storage.getPatternsByTag("high");
const securityIssues = await storage.getPatternsByTag("security");

// Semantic search for similar discoveries
const similar = await storage.findSimilarPatterns(
  "authentication issues",
  10
);
const authDiscoveries = similar.filter(p => p.kind === "discovery");
```

### Discovery Query Implementation

```typescript
// src/discovery.ts
export async function discovery_query(
  args: DiscoveryQueryArgs
): Promise<DiscoveryEntry[]> {
  const storage = getStorage();
  
  // Start with all patterns
  let patterns = await storage.getAllPatterns();
  
  // Filter to discoveries only
  patterns = patterns.filter(p => p.kind === "discovery");
  
  // Apply filters using tags
  if (args.type) {
    patterns = patterns.filter(p => p.tags.includes(args.type!));
  }
  
  if (args.urgency) {
    patterns = patterns.filter(p => p.tags.includes(args.urgency!));
  }
  
  if (args.status) {
    patterns = patterns.filter(p => p.tags.includes(args.status!));
  }
  
  // Load full discovery metadata for matched patterns
  const discoveries = await Promise.all(
    patterns.map(p => loadDiscoveryMetadata(p.id))
  );
  
  return discoveries;
}

// Alternative: Semantic search
export async function discovery_search(
  query: string,
  args?: DiscoveryQueryArgs
): Promise<DiscoveryEntry[]> {
  const storage = getStorage();
  
  // Use existing semantic search
  const similar = await storage.findSimilarPatterns(query, args?.limit ?? 10);
  
  // Filter to discoveries
  const discoveryPatterns = similar.filter(p => p.kind === "discovery");
  
  // Apply additional filters and load metadata
  let discoveries = await Promise.all(
    discoveryPatterns.map(p => loadDiscoveryMetadata(p.id))
  );
  
  if (args?.type) {
    discoveries = discoveries.filter(d => d.type === args.type);
  }
  
  if (args?.urgency) {
    discoveries = discoveries.filter(d => d.urgency === args.urgency);
  }
  
  return discoveries;
}
```

### Why This Works

1. **Zero Config**: `.hive/vectors` is automatically created by existing storage
2. **Semantic Search**: Embedding generation already implemented
3. **Persistence**: LanceDB handles durability
4. **No New Files**: Reuses existing infrastructure
5. **Type Safe**: Leverages existing schemas

### Implementation Example

```typescript
// src/discovery.ts (new file)
import { getStorage } from "./storage";
import type { DiscoveryEntry, DiscoveryCreateArgs } from "./schemas/discovery";

export async function discovery_log(
  args: DiscoveryCreateArgs,
  context: { agent_name: string; bead_id: string }
): Promise<DiscoveryEntry> {
  const storage = getStorage(); // Zero-config, creates .hive/vectors if needed
  
  // Create discovery entry
  const discovery: DiscoveryEntry = {
    id: `disc-${generateId()}`,
    type: args.type,
    urgency: args.urgency,
    status: "open",
    title: args.title,
    description: args.description,
    related_files: args.related_files ?? [],
    code_context: args.code_context,
    suggested_action: args.suggested_action,
    estimated_effort: args.estimated_effort,
    discovered_by: context.agent_name,
    discovered_during: context.bead_id,
    tags: args.tags ?? [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  
  // Store as pattern with kind="discovery"
  // This automatically generates embeddings and indexes content
  await storage.storePattern({
    id: discovery.id,
    content: formatDiscoveryContent(discovery), // title + description + files
    kind: "discovery" as PatternKind,
    is_negative: false,
    tags: [
      ...discovery.tags,
      discovery.type,      // e.g., "security"
      discovery.urgency,   // e.g., "high"
      discovery.status,    // e.g., "open"
    ],
    success_count: 0,
    failure_count: 0,
    created_at: discovery.created_at,
    updated_at: discovery.updated_at,
    example_beads: [discovery.discovered_during],
    reason: discovery.suggested_action,
  });
  
  // Discovery metadata stored in separate map for full fidelity
  await storeDiscoveryMetadata(discovery);
  
  return discovery;
}

function formatDiscoveryContent(discovery: DiscoveryEntry): string {
  return `
${discovery.title}

${discovery.description}

Type: ${discovery.type}
Urgency: ${discovery.urgency}
Files: ${discovery.related_files.join(", ")}

${discovery.code_context ? `\nCode Context:\n${discovery.code_context}` : ""}
${discovery.suggested_action ? `\nSuggested Action:\n${discovery.suggested_action}` : ""}
  `.trim();
}
```

## Integration Points

### 1. Hive Mail (Existing Infrastructure)

**Thread Linking**:
```typescript
// Discovery inherits thread_id from agent's current task
const discovery = await discovery_log({
  ...args,
  thread_id: currentTask.thread_id // Auto-captured
});

// Coordinator can reply in thread using existing hivemail_send
await hivemail_send({
  to: [discovery.discovered_by],
  subject: `Re: Discovery ${discovery.id}`,
  body: "I've promoted your security finding to a bead...",
  thread_id: discovery.thread_id
});
```

**Broadcasting Discoveries**:
```typescript
// Use existing hivemail_send to share discoveries with team
await hivemail_send({
  to: ["coordinator", "agent-team"], // Explicit recipients
  subject: "Critical Discovery: SQL injection found",
  body: `
    Discovery ID: ${discovery.id}
    Type: ${discovery.type}
    Urgency: ${discovery.urgency}
    
    ${discovery.description}
    
    Files: ${discovery.related_files.join(", ")}
    Suggested Action: ${discovery.suggested_action}
  `,
  importance: "urgent",
  thread_id: discovery.thread_id
});

// Note: No separate "broadcast" tool needed - hivemail_send handles it
```

### 2. Beads System (Existing Infrastructure)

**Promotion Flow** uses existing `beads_create`:
```typescript
// Discovery promote internally calls beads_create
async function discovery_promote(args: DiscoveryPromoteArgs) {
  const discovery = await getDiscovery(args.discovery_id);
  
  // Use existing beads_create with "discovered-from" dependency
  const bead = await beads_create({
    title: discovery.title,
    description: `
      Discovered by: ${discovery.discovered_by}
      During: ${discovery.discovered_during}
      
      ${discovery.description}
      
      Suggested Action:
      ${discovery.suggested_action}
    `,
    type: mapDiscoveryTypeToBead(discovery.type), // bug, task, etc.
    priority: args.bead_priority ?? 2,
    parent_id: args.parent_bead_id,
    metadata: {
      discovery_id: discovery.id,
      discovered_by: discovery.discovered_by,
      related_files: discovery.related_files,
      urgency: discovery.urgency,
    }
  });
  
  // Update discovery with promoted status (stored in LanceDB)
  await updateDiscoveryStatus(discovery.id, "promoted", {
    promoted_to_bead: bead.id
  });
  
  return { bead, updated_discovery: discovery };
}
```

**Dependency Tracking** uses existing `BeadDependencySchema`:
```typescript
// The "discovered-from" type already exists in BeadDependencySchema!
const bead = await beads_create({
  title: "Fix SQL injection",
  type: "bug",
  dependencies: [{
    id: originalTaskBead.id,
    type: "discovered-from" // ✅ Already supported
  }]
});

// This creates a link: new_bead → discovered_from → original_task
// Preserves full audit trail of how issues were found
```

**Type Mapping**:
```typescript
function mapDiscoveryTypeToBead(type: DiscoveryType): BeadType {
  const mapping: Record<DiscoveryType, BeadType> = {
    bug: "bug",
    security: "bug", // High-priority bug
    debt: "chore",
    performance: "bug",
    idea: "feature",
    question: "task",
    documentation: "chore",
    test: "chore",
    dependency: "task",
    other: "task",
  };
  return mapping[type];
}
```

### 3. Checkpoint System

**Recovery Context**:
```typescript
interface SwarmBeadContext {
  // Existing fields...
  
  // Add discoveries
  discoveries: {
    logged: string[];        // Discovery IDs logged during this task
    promoted: string[];      // Discovery IDs promoted to beads
  };
}

// On recovery, agent sees their discoveries
const checkpoint = await checkpoint_recover({ bead_id });
console.log("Your discoveries:", checkpoint.discoveries.logged);
```

### 4. Learning System

**Implicit Feedback**:
```typescript
// Track discovery quality signals
interface DiscoveryOutcomeSignals {
  was_promoted: boolean;        // Was it promoted to bead?
  promotion_speed: number;      // How quickly triaged?
  discovered_type: DiscoveryType;
  actual_effort: number;        // vs estimated_effort
  resolved_externally: boolean; // Fixed without bead?
}

// Learn which types of discoveries are valuable
// Improve agent guidance over time
```

## Usage Patterns

### Pattern 1: Quick Bug Report

```typescript
// Agent finds obvious bug
await discovery_log({
  type: "bug",
  urgency: "high",
  title: "Null pointer in checkout flow",
  description: "Line 42 doesn't check if user.cart is null",
  related_files: ["src/checkout.ts"],
  code_context: "const total = user.cart.items.reduce(...)", // ← crashes
  suggested_action: "Add null check before accessing cart.items",
  estimated_effort: 1 // trivial fix
});

// Continue with original task
```

### Pattern 2: Technical Debt Note

```typescript
// Agent notices code smell but can't fix now
await discovery_log({
  type: "debt",
  urgency: "low",
  title: "Payment module has 500-line function",
  description: "processPayment() in src/payment.ts is unmaintainable",
  related_files: ["src/payment.ts"],
  suggested_action: "Refactor into smaller functions: validate, charge, notify",
  estimated_effort: 4 // significant refactor
});
```

### Pattern 3: Security Concern

```typescript
// Agent spots potential vulnerability
await discovery_log({
  type: "security",
  urgency: "critical",
  title: "API keys in version control",
  description: "Found .env file checked into git with production keys",
  related_files: [".env", ".gitignore"],
  code_context: "AWS_SECRET_KEY=abc123...",
  suggested_action: "1. Rotate keys immediately, 2. Add .env to .gitignore, 3. Use secret manager",
  estimated_effort: 2,
  tags: ["security", "credentials", "urgent"]
});

// This should probably interrupt current work!
// Urgency: critical signals coordinator to act immediately
```

### Pattern 4: Feature Idea

```typescript
// Agent has enhancement idea while implementing
await discovery_log({
  type: "idea",
  urgency: "low",
  title: "Add dark mode support",
  description: "While working on UI, noticed dark mode would be easy to add with CSS variables",
  related_files: ["src/styles/theme.css"],
  suggested_action: "Replace hardcoded colors with CSS custom properties",
  estimated_effort: 3,
  tags: ["ux", "enhancement"]
});
```

### Pattern 5: Question for Human

```typescript
// Agent needs architectural guidance
await discovery_log({
  type: "question",
  urgency: "medium",
  title: "Should we use REST or GraphQL for new API?",
  description: "Implementing data layer, both approaches feasible. Trade-offs unclear.",
  suggested_action: "Schedule architecture discussion",
  estimated_effort: 5, // could affect many files
  tags: ["architecture", "decision-needed"]
});
```

## Coordinator Triage Workflows

### Daily Triage Session

```typescript
// 1. Get overview
const stats = await discovery_stats();
console.log(`Open discoveries: ${stats.total}`);
console.log(`Critical: ${stats.by_urgency.critical}`);
console.log(`High: ${stats.by_urgency.high}`);

// 2. Address critical first
const critical = await discovery_query({ 
  urgency: "critical", 
  status: "open" 
});

for (const disc of critical) {
  // Immediate action required
  await discovery_promote({
    discovery_id: disc.id,
    bead_priority: 0 // Highest priority
  });
}

// 3. Review high-urgency
const high = await discovery_query({ 
  urgency: "high", 
  status: "open" 
});

for (const disc of high) {
  // Evaluate against sprint goals
  if (alignsWithGoals(disc)) {
    await discovery_promote({ discovery_id: disc.id });
  } else {
    await discovery_update({ 
      id: disc.id, 
      status: "deferred" 
    });
  }
}

// 4. Mark duplicates
const bugs = await discovery_query({ 
  type: "bug", 
  status: "open" 
});

for (const disc of bugs) {
  if (isDuplicate(disc, existingBeads)) {
    await discovery_update({
      id: disc.id,
      status: "duplicate",
      metadata: { duplicate_of: existingBead.id }
    });
  }
}
```

### Sprint Planning Integration

```typescript
// Export discoveries for sprint planning
const deferred = await discovery_query({ status: "deferred" });
const ideas = await discovery_query({ type: "idea" });

// Generate report
const report = {
  technical_debt: deferred.filter(d => d.type === "debt"),
  enhancements: ideas,
  estimated_total_effort: sum(deferred.map(d => d.estimated_effort))
};

// Promote selected items to sprint backlog
for (const disc of selectedForSprint) {
  await discovery_promote({
    discovery_id: disc.id,
    parent_bead_id: currentSprintEpic.id
  });
}
```

## Quality Guardian Integration

The Discovery Queue integrates with the Quality Guardian pattern to prevent bad changes from being merged.

### Guardian Discovery Queries

```typescript
// Quality Guardian checks discoveries before allowing merge
async function guardianCheckDiscoveries(files: string[]): Promise<{
  critical_discoveries: DiscoveryEntry[],
  blocking: boolean,
  message: string
}> {
  const storage = getStorage();
  
  // Query discoveries related to files being changed
  const allDiscoveries = await storage.getAllPatterns();
  const critical = allDiscoveries
    .filter(p => p.kind === "discovery")
    .filter(p => p.tags.includes("critical") || p.tags.includes("security"))
    .filter(p => {
      // Check if discovery relates to any of the files
      const discoveryFiles = parseFilesFromContent(p.content);
      return discoveryFiles.some(f => files.includes(f));
    });
  
  if (critical.length > 0) {
    return {
      critical_discoveries: critical,
      blocking: true,
      message: `Cannot merge: ${critical.length} critical discoveries affect these files. Resolve discoveries first.`
    };
  }
  
  return { critical_discoveries: [], blocking: false, message: "OK" };
}
```

### Guardian Workflow

```
[Agent completes subtask]
         ↓
[Quality Guardian runs]
         ↓
[Check for critical discoveries in affected files]
         ↓
    ┌────────┐
    │ Any?   │
    └────────┘
      ↙    ↘
   YES     NO
    ↓       ↓
 BLOCK   ALLOW
  MERGE   MERGE
```

### Example Guardian Message

```typescript
// Guardian blocks merge due to discovery
{
  status: "blocked",
  reason: "critical_discovery",
  details: {
    discoveries: [
      {
        id: "disc-x7y",
        type: "security",
        urgency: "critical",
        title: "SQL injection in auth.ts",
        message: "This file has an unresolved critical security discovery"
      }
    ],
    action_required: "Promote discovery disc-x7y to bead and resolve, or mark as deferred with reason"
  }
}
```

## Future Enhancements

### Phase 2: Auto-Triage Suggestions

```typescript
// ML-based triage suggestions (future)
discovery_suggest_triage(id: string): {
  recommended_status: DiscoveryStatus,
  recommended_priority: number,
  similar_past_discoveries: DiscoveryEntry[],
  confidence: number
}

// Learn from historical triage decisions
// Uses existing LanceDB semantic search to find similar past discoveries
// Analyzes outcomes to recommend triage actions
```

### Phase 3: Discovery Clustering

```typescript
// Group related discoveries (future)
discovery_cluster(ids: string[]): {
  clusters: Array<{
    theme: string,
    discoveries: DiscoveryEntry[],
    suggested_epic_title: string
  }>,
  singletons: DiscoveryEntry[]
}

// Example: 5 separate auth discoveries → 1 epic "Auth Security Hardening"
// Uses LanceDB embeddings to cluster semantically similar discoveries
```

## Testing Strategy

### Unit Tests

```typescript
// Schema validation
test("discovery entry validates correctly", () => {
  const entry = {
    id: "disc-123",
    type: "bug",
    urgency: "high",
    status: "open",
    title: "Test bug",
    description: "Found a bug",
    related_files: ["test.ts"],
    discovered_by: "agent-1",
    discovered_during: "bead-abc",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  expect(() => DiscoveryEntrySchema.parse(entry)).not.toThrow();
});

// LanceDB persistence
test("discovery log persists to LanceDB", async () => {
  const storage = getStorage();
  
  await discovery_log({
    type: "bug",
    urgency: "high",
    title: "Test bug",
    description: "Found a bug",
    related_files: ["test.ts"]
  });
  
  // Verify stored as pattern with kind="discovery"
  const patterns = await storage.getAllPatterns();
  const discoveries = patterns.filter(p => p.kind === "discovery");
  
  expect(discoveries.length).toBe(1);
  expect(discoveries[0].tags).toContain("bug");
  expect(discoveries[0].tags).toContain("high");
});

// Query operations
test("discovery query filters by type and urgency", async () => {
  await discovery_log({ type: "bug", urgency: "high", ... });
  await discovery_log({ type: "security", urgency: "critical", ... });
  await discovery_log({ type: "bug", urgency: "low", ... });
  
  const highBugs = await discovery_query({ type: "bug", urgency: "high" });
  expect(highBugs.length).toBe(1);
  
  const allBugs = await discovery_query({ type: "bug" });
  expect(allBugs.length).toBe(2);
});

// Semantic search
test("discovery semantic search finds similar", async () => {
  await discovery_log({
    type: "security",
    urgency: "high",
    title: "SQL injection in login",
    description: "User input not sanitized in authentication query"
  });
  
  // Search for similar security issues
  const similar = await discovery_search("authentication security problems");
  
  expect(similar.length).toBeGreaterThan(0);
  expect(similar[0].type).toBe("security");
});
```

### Integration Tests

```typescript
// End-to-end promotion flow
test("discovery promotes to bead with context", async () => {
  // 1. Agent logs discovery
  const disc = await discovery_log({
    type: "bug",
    urgency: "high",
    title: "Test bug",
    description: "Bug description",
    related_files: ["src/test.ts"],
    discovered_during: "task-123"
  });
  
  // 2. Coordinator promotes
  const result = await discovery_promote({
    discovery_id: disc.id,
    bead_priority: 1
  });
  
  // 3. Verify bead created
  const bead = await beads_query({ id: result.bead_id });
  expect(bead.title).toBe("Test bug");
  expect(bead.metadata.discovery_id).toBe(disc.id);
  
  // 4. Verify discovery updated
  const updated = await discovery_query({ id: disc.id });
  expect(updated.status).toBe("promoted");
  expect(updated.promoted_to_bead).toBe(result.bead_id);
});

// Hive mail integration
test("discovery links to hive mail thread", async () => {
  // Agent working on task with thread
  const task = { id: "task-123", thread_id: "thread-456" };
  
  // Log discovery
  const disc = await discovery_log({
    ...args,
    discovered_during: task.id,
    thread_id: task.thread_id
  });
  
  // Verify thread linkage
  expect(disc.thread_id).toBe("thread-456");
  
  // Coordinator can reply in thread
  await hivemail_send({
    thread_id: disc.thread_id,
    subject: "Re: Your discovery",
    body: "Thanks, I've promoted it to a bead"
  });
});
```

### Evaluation Criteria

```typescript
// Self-evaluation for discovery tool usage
const criteria = {
  "discovery_logged": {
    description: "Agent successfully logged discovery without derailing",
    passing: "Discovery created, agent continued with original task"
  },
  "sufficient_context": {
    description: "Discovery has enough information for triage",
    passing: "Title, description, files, and suggested action present"
  },
  "appropriate_urgency": {
    description: "Urgency matches severity of finding",
    passing: "Critical issues marked critical, ideas marked low"
  }
};
```

## Zero-Config Verification

Discovery Queue achieves **zero-config operation** by leveraging existing infrastructure:

### ✅ No Setup Required

| Component | Status | Evidence |
|-----------|--------|----------|
| Storage | ✅ Zero-config | LanceDB at `.hive/vectors` auto-created by storage.ts |
| Embeddings | ✅ Zero-config | `embed()` function already initialized |
| Semantic Search | ✅ Zero-config | `findSimilarPatterns()` works out-of-box |
| Mail System | ✅ Zero-config | `hivemail_send()` auto-initializes session |
| Bead System | ✅ Zero-config | `beads_create()` works immediately |

### ✅ No Config Files

- No `.discoveryrc` needed
- No `discovery.config.ts` needed
- No environment variables required
- No initialization commands needed

### ✅ No Manual Steps

```typescript
// Agent can use immediately
await discovery_log({ ... }); // Just works

// Coordinator can query immediately
await discovery_query({ ... }); // Just works

// Storage is automatically created on first use
```

### How It Works

1. **First `discovery_log` call**:
   - `getStorage()` creates `.hive/vectors` if needed
   - Discovery stored as pattern with `kind="discovery"`
   - Embedding generated automatically
   - No setup required

2. **First `discovery_query` call**:
   - Reads from existing LanceDB
   - Filters patterns by `kind="discovery"`
   - Returns results immediately

3. **First `discovery_promote` call**:
   - Uses existing `beads_create()`
   - Creates dependency with `type="discovered-from"`
   - Updates discovery status in LanceDB

## Migration Path

### Phase 1: Tool Integration (Immediate)
- [x] Define schemas in `src/schemas/discovery.ts`
- [ ] Add `discovery_log` tool (stores to LanceDB via existing `storePattern`)
- [ ] Add `discovery_query` tool (queries LanceDB via existing `getAllPatterns`)
- [ ] Add `discovery_update` tool (updates pattern in LanceDB)
- [ ] Add `discovery_promote` tool (wraps existing `beads_create`)
- [ ] Add `discovery_stats` tool (aggregates from LanceDB)

**No storage implementation needed** - LanceDB already exists!

### Phase 2: Integration & Polish
- [ ] Link discoveries to hive mail threads (use existing `thread_id` field)
- [ ] Add discovery context to checkpoints (extend `SwarmBeadContext`)
- [ ] Track discovery outcomes in learning system (existing feedback mechanism)
- [ ] Add Quality Guardian checks (query discoveries before merge)
- [ ] Add discovery stats to coordinator dashboard

## Success Metrics

### Agent Efficiency
- **Focus preservation**: Time spent on primary task vs investigations
- **Discovery rate**: Findings per task (should increase, not decrease)
- **Context quality**: Percentage of discoveries with all recommended fields

### Coordinator Efficiency
- **Triage time**: Time to review and act on discoveries
- **Promotion rate**: Percentage of discoveries that become beads
- **Duplicate rate**: Percentage marked as duplicates (should decrease over time)

### System Quality
- **Discovery age**: Time from creation to resolution
- **Accuracy**: Promoted discoveries that actually needed fixing
- **Coverage**: Important issues caught vs missed

## Conclusion

The Discovery Queue system provides a structured, low-friction way for agents to capture valuable findings without derailing from their primary work. By separating discovery (agent concern) from triage (coordinator concern), we maintain focus while preserving knowledge.

**Key Design Decisions**:

1. **Zero-Config**: Leverages existing LanceDB storage - no setup required
2. **Existing Infrastructure**: Uses `storePattern()`, `beads_create()`, `hivemail_send()`
3. **Semantic Search**: Available immediately via LanceDB embeddings
4. **Type Safety**: Extends existing `PatternKind` schema
5. **Quality Guardian**: Discoveries can block merges to prevent known issues

**Architecture Benefits**:

- ✅ No new storage format (reuses LanceDB)
- ✅ No new files to manage (uses `.hive/vectors`)
- ✅ No configuration required (works out-of-box)
- ✅ Semantic search included (via embeddings)
- ✅ Integrates with existing tools (beads, mail, checkpoints)

**Next Steps**:
1. ✅ Schema definition (`src/schemas/discovery.ts`)
2. ✅ Design documentation (this document)
3. ✅ Zero-config verification (uses existing storage)
4. Implement tool wrappers (`discovery_log`, `discovery_query`, etc.)
5. Add Quality Guardian integration
6. Write integration tests

---

## Appendix A: Example Discovery Storage

### LanceDB Pattern Entry

```typescript
// Discovery stored as pattern in LanceDB
{
  id: "disc-x7y",
  kind: "discovery",
  content: `SQL injection in auth.ts

Found raw string concatenation in login query. User input is directly 
interpolated into SQL query without sanitization.

Type: security
Urgency: high
Files: src/auth.ts

Code Context:
const query = \`SELECT * FROM users WHERE email='\${email}'\`

Suggested Action:
Use parameterized queries or ORM`,
  
  is_negative: false,
  tags: ["security", "auth", "high", "open"], // Type, urgency, status as tags
  success_count: 0,
  failure_count: 0,
  created_at: "2025-12-15T10:30:00Z",
  updated_at: "2025-12-15T10:30:00Z",
  example_beads: ["task-123"], // discovered_during
  reason: "Use parameterized queries", // suggested_action
  
  // Embedding auto-generated by storage.storePattern()
  vector: [0.123, -0.456, ...], // 1536 dimensions
}
```

### Discovery Metadata (Separate Store)

```typescript
// Full discovery metadata stored separately for rich queries
{
  id: "disc-x7y",
  type: "security",
  urgency: "high",
  status: "open",
  title: "SQL injection in auth.ts",
  description: "Found raw string concatenation...",
  related_files: ["src/auth.ts"],
  code_context: "const query = `SELECT * FROM users WHERE email='${email}'`",
  suggested_action: "Use parameterized queries",
  estimated_effort: 2,
  discovered_by: "agent-BlueMountain",
  discovered_during: "task-123",
  thread_id: "thread-456",
  tags: ["security", "auth"],
  created_at: "2025-12-15T10:30:00Z",
  updated_at: "2025-12-15T10:30:00Z",
  
  // Status updates
  promoted_to_bead: "bug-abc", // Set when promoted
}
```

### Lifecycle Updates

```typescript
// Update 1: Coordinator triages discovery
await discovery_update({
  id: "disc-x7y",
  status: "triaged"
});
// Updates tags in LanceDB: ["security", "auth", "high", "triaged"]

// Update 2: Coordinator promotes to bead
await discovery_promote({
  discovery_id: "disc-x7y",
  bead_priority: 1
});
// Creates bead with discovered-from dependency
// Updates discovery: status="promoted", promoted_to_bead="bug-abc"
// Updates tags: ["security", "auth", "high", "promoted"]
```

## Appendix B: Schema Reference

See `src/schemas/discovery.ts` for complete TypeScript definitions:

- `DiscoveryTypeSchema`: 10 predefined types
- `DiscoveryUrgencySchema`: 5 urgency levels
- `DiscoveryStatusSchema`: 7 lifecycle states
- `DiscoveryEntrySchema`: Core entry structure
- `DiscoveryCreateArgsSchema`: Agent input
- `DiscoveryUpdateArgsSchema`: Coordinator updates
- `DiscoveryQueryArgsSchema`: Query filters
- `DiscoveryPromoteArgsSchema`: Promotion parameters
- `DiscoveryStatsSchema`: Queue metrics

## Appendix C: Related Systems

### Similar Patterns in Industry

- **Jira Discovery**: Quick-create issues from Slack/IDE
- **GitHub Draft Issues**: Lightweight issue templates
- **Notion Quick Capture**: Fast note-taking with later organization
- **GTD Inbox**: Capture everything, process later

### Academic References

- "Interruption Science" - Gloria Mark (UC Irvine)
- "Deep Work" - Cal Newport (focus preservation)
- "Getting Things Done" - David Allen (capture & process)
