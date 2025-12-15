# Design Specification Management Strategy

**Status**: Design Specification (Under Review)  
**Author**: CoolStorm (Hive Coordinator)  
**Reviewer**: CoolStorm (Hive Coordinator)  
**Date**: 2025-12-15  
**Last Review**: 2025-12-15  
**Related**: beads.ts, schemas/discovery.ts, mandates.ts, learning.ts, OpenSpec

---

## Review Notes (2025-12-15)

### Summary
The design is **fundamentally sound** with good integration patterns. Key improvements needed:
1. **UX Simplification** - Too many tools, merge into fewer with sensible defaults
2. **CLI Naming** - Align with existing `hive` CLI patterns (currently `sync`, `doctor`, `init`)
3. **Missing PatternKind** - Need to extend `PatternKindSchema` to include "spec"
4. **Human Notification Gap** - No clear mechanism for humans to receive hivemail

### Recommended Changes

#### 1. Tool Consolidation (UX)
**Problem**: 6 agent tools is cognitive overhead
**Solution**: Merge into 3 tools with clear workflows

| Current (6 tools) | Proposed (3 tools) |
|-------------------|-------------------|
| `spec_draft` | `spec_write` (create or update) |
| `spec_request_review` | `spec_submit` (submit for review) |
| `spec_respond_to_review` | (merged into spec_write) |
| `spec_query` | `spec_query` (unchanged) |
| `spec_create_implementation_beads` | `spec_implement` (create beads) |

#### 2. CLI Command Naming
**Problem**: Proposed `hive spec` doesn't follow existing pattern
**Existing commands**: `sync`, `doctor`, `init`, `setup`
**Solution**: Add `spec.ts` to `src/cli/commands/` following same patterns

#### 3. Schema Extension Required
**Problem**: `PatternKindSchema` in `pattern-maturity.ts` doesn't include "spec"
**Solution**: Add before implementing:
```typescript
export const PatternKindSchema = z.enum([
  "pattern",
  "anti_pattern", 
  "discovery",
  "spec"  // NEW
]);
```

#### 4. Human Notification UX
**Problem**: How do humans actually receive hivemail notifications?
**Current**: No mechanism defined
**Solution**: Add to design:
- CLI command: `hive inbox` to check messages
- Optional: Desktop notifications via `node-notifier`
- Optional: Webhook integration for Slack/email

#### 5. Progressive Complexity
**Problem**: Full workflow is complex for simple specs
**Solution**: Already partially addressed with "Progressive Adoption" section
**Enhancement**: Add "Quick Spec" mode that skips review for internal docs

---

## Integration Checklist

Before implementation, ensure these integration points are addressed:

| Integration | Status | Action Required |
|-------------|--------|-----------------|
| **LanceDB Storage** | ✅ Ready | Uses existing `storage.ts` infrastructure |
| **PatternKindSchema** | ⚠️ Needs Extension | Add "spec" to `pattern-maturity.ts` |
| **Beads System** | ✅ Ready | Uses existing `beads_create`, `beads_update` |
| **Hivemail** | ✅ Ready | Uses existing `hivemail_send` |
| **CLI Commands** | ⚠️ Needs Creation | Add `src/cli/commands/spec.ts` |
| **Human Inbox** | ⚠️ Needs Design | Add `hive inbox` command or similar |
| **Discovery Promote** | ⚠️ Needs Extension | Add "create-spec" action type |
| **Mandates Query** | ✅ Ready | Uses existing semantic search |

---

## Executive Summary

This document defines how Hive should manage design specifications through multi-step collaborative processes with human review. The strategy addresses:

1. **Output Location**: Where specs live (`openspec/specs/` directory structure)
2. **Standards**: OpenSpec-compatible format with Hive extensions
3. **Tracking**: Sequence numbers, bead integration, and lifecycle states
4. **Commit Strategy**: Atomic commits with spec deltas
5. **Human Review**: Explicit review gates and clarification workflows

**Core Thesis**: Design specifications should be first-class citizens in Hive, tracked like beads, stored for semantic search, and evolved through a collaborative human-agent process.

## Problem Statement

### Current Pain Points

1. **Ad-hoc Documentation**: Design docs in `docs/analysis/` have no standard lifecycle
2. **No Review Gates**: Agents produce specs without explicit human validation
3. **No Versioning**: Changes to requirements aren't tracked systematically
4. **Disconnected from Work**: Specs aren't linked to beads or implementation tasks
5. **No Clarification Path**: When specs need refinement, there's no structured process

### Desired State

```
[Idea] → [Draft Spec] → [Human Review] → [Approved Spec] → [Implementation Beads]
   ↓           ↓              ↓                ↓                     ↓
[disc-*]  [spec-draft-*]  [review gate]  [spec-approved-*]    [epic + subtasks]
```

## Design Goals

1. **Zero-Config**: Works out-of-box with existing hive infrastructure
2. **Human-in-the-Loop**: Explicit review gates before implementation
3. **Traceable**: Specs linked to beads, discoveries, and implementation
4. **Searchable**: Semantic search over spec content via LanceDB
5. **Compatible**: OpenSpec-compatible format for industry alignment
6. **Versioned**: Track spec evolution with sequence numbers

## Architecture Overview

### Directory Structure

```
project/
├── openspec/                    # Design specifications root
│   ├── specs/                   # Approved specifications
│   │   ├── {capability}/        # One directory per capability
│   │   │   ├── spec.md          # Current specification
│   │   │   └── history/         # Historical versions
│   │   │       ├── spec.v1.md
│   │   │       └── spec.v2.md
│   │   └── ...
│   │
│   ├── changes/                 # Proposed changes (PRs for specs)
│   │   ├── {change-id}/         # One directory per change proposal
│   │   │   ├── proposal.md      # Why this change?
│   │   │   ├── design.md        # Technical decisions
│   │   │   ├── tasks.md         # Implementation breakdown
│   │   │   └── specs/           # Spec deltas
│   │   │       └── {capability}/
│   │   │           └── spec.md  # New version of spec
│   │   └── ...
│   │
│   └── drafts/                  # Work-in-progress (not yet proposed)
│       └── {draft-id}/
│           ├── spec.md          # Draft specification
│           └── notes.md         # Open questions, clarifications needed
│
├── .hive/
│   └── vectors/                 # LanceDB (existing)
│       └── (specs indexed here with kind="spec")
│
└── .beads/                      # Beads issue tracking (existing)
    └── issues.jsonl
```

### Spec Lifecycle

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SPEC LIFECYCLE                                      ���
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   [Discovery/Idea]                                                            │
│         │                                                                     │
│         ▼                                                                     │
│   ┌─────────────┐     ┌─────────────────────────────────────────────────┐   │
│   │   draft     │ ──► │  Draft spec created in openspec/drafts/         │   │
│   │  (bead:     │     │  - Agent writes initial spec                    │   │
│   │   spec-     │     │  - notes.md captures open questions            │   │
│   │   draft-*)  │     │  - NOT ready for implementation                 │   │
│   └─────────────┘     └─────────────────────────────────────────────────┘   │
│         │                                                                     │
│         │ spec_request_review()                                              │
│         ▼                                                                     │
│   ┌─────────────┐     ┌─────────────────────────────────────────────────┐   │
│   │   review    │ ──► │  Proposal created in openspec/changes/          │   │
│   │  (bead:     │     │  - Human notified via hivemail                  │   │
│   │   spec-     │     │  - Bead status: "blocked" (awaiting review)     │   │
│   │   review-*) │     │  - May require multiple review cycles           │   │
│   └─────────────┘     └─────────────────────────────────────────────────┘   │
│         │                                                                     │
│         │ Human: approve / request-changes / reject                          │
│         ▼                                                                     │
│   ┌─────────────┐     ┌─────────────────────────────────────────────────┐   │
│   │  approved   │ ──► │  Spec moved to openspec/specs/{capability}/     │   │
│   │  (bead:     │     │  - Old version archived to history/             │   │
│   │   spec-*)   │     │  - Sequence number incremented                  │   │
│   │             │     │  - Implementation beads can now be created      │   │
│   └─────────────┘     └─────────────────────────────────────────────────┘   │
│         │                                                                     │
│         │ spec_create_implementation_beads()                                 │
│         ▼                                                                     │
│   ┌─────────────┐     ┌─────────────────────────────────────────────────┐   │
│   │ implemented │ ──► │  Epic bead created from spec tasks.md           │   │
│   │  (bead:     │     │  - Subtask beads linked to spec                 │   │
│   │   epic-*)   │     │  - Progress tracked through beads system        │   │
│   └─────────────┘     └─────────────────────────────────────────────────┘   │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Specification Format

### OpenSpec-Compatible Structure

```markdown
# {Capability Name} Specification

**Version**: {sequence-number}
**Status**: draft | review | approved | deprecated
**Author**: {agent-name or human}
**Created**: {ISO-8601 timestamp}
**Updated**: {ISO-8601 timestamp}
**Bead**: {spec-bead-id}  <!-- Links to tracking -->

## Purpose

{20+ character description of what this capability does and why it exists}

## Requirements

### Requirement: {Requirement Name}

The system SHALL/MUST {describe the core behavior}.

#### Scenario: {Scenario Name}

- **GIVEN** {precondition}
- **WHEN** {action or event}
- **THEN** {expected outcome}
- **AND** {additional outcome}

#### Scenario: {Another Scenario}

- **GIVEN** {precondition}
- **WHEN** {action}
- **THEN** {outcome}

### Requirement: {Another Requirement}

The system MUST {behavior}.

<!-- Continue with more requirements and scenarios -->

## Non-Functional Requirements

### Performance
- {Latency, throughput expectations}

### Security
- {Security considerations}

## Dependencies

- {List of other specs this depends on}

## Open Questions

<!-- Move to notes.md in draft phase -->

## Change History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1 | 2025-12-15 | CoolStorm | Initial specification |
```

### Hive Extensions to OpenSpec

In addition to standard OpenSpec format, Hive adds:

1. **Bead Linkage**: `Bead: spec-{id}` header for tracking
2. **Status Field**: Explicit lifecycle state
3. **Version Sequence**: Integer sequence numbers for ordering
4. **Related Sections**: Links to discoveries, mandates, and implementation beads

## Schema Design

### Spec Entry Schema

```typescript
// src/schemas/spec.ts

import { z } from "zod";
import { AnyBeadIdSchema, RequiredTimestampSchema } from "./common";

/**
 * Specification status lifecycle
 */
export const SpecStatusSchema = z.enum([
  "draft",       // Work-in-progress, not ready for review
  "review",      // Submitted for human review
  "approved",    // Human-approved, ready for implementation
  "implemented", // Implementation complete
  "deprecated",  // Superseded or no longer relevant
]);
export type SpecStatus = z.infer<typeof SpecStatusSchema>;

/**
 * Requirement type (normative language)
 */
export const RequirementTypeSchema = z.enum([
  "shall",       // Mandatory (absolute requirement)
  "must",        // Mandatory (emphatic)
  "should",      // Recommended
  "may",         // Optional
]);
export type RequirementType = z.infer<typeof RequirementTypeSchema>;

/**
 * A single requirement within a spec
 */
export const SpecRequirementSchema = z.object({
  id: z.string(),
  name: z.string().max(50),
  type: RequirementTypeSchema,
  description: z.string(),
  scenarios: z.array(z.object({
    name: z.string(),
    given: z.string(),
    when: z.string(),
    then: z.array(z.string()),
  })),
  tags: z.array(z.string()).default([]),
});
export type SpecRequirement = z.infer<typeof SpecRequirementSchema>;

/**
 * Core specification entry
 */
export const SpecEntrySchema = z.object({
  /** Unique identifier: spec-{capability}-{version} */
  id: z.string().regex(/^spec-[a-z0-9-]+-v\d+$/),
  
  /** Capability name (directory name) */
  capability: z.string().regex(/^[a-z0-9-]+$/),
  
  /** Sequence version number */
  version: z.number().int().min(1),
  
  /** Current lifecycle status */
  status: SpecStatusSchema,
  
  /** Display title */
  title: z.string().min(1).max(100),
  
  /** Purpose statement (min 20 chars per OpenSpec) */
  purpose: z.string().min(20),
  
  /** Structured requirements */
  requirements: z.array(SpecRequirementSchema),
  
  /** Non-functional requirements (free-form) */
  nfr: z.object({
    performance: z.string().optional(),
    security: z.string().optional(),
    scalability: z.string().optional(),
  }).optional(),
  
  /** Dependencies on other specs */
  dependencies: z.array(z.string()).default([]),
  
  /** Linked bead for tracking */
  bead_id: AnyBeadIdSchema.optional(),
  
  /** Discovery that spawned this spec */
  discovery_id: z.string().optional(),
  
  /** Original author */
  author: z.string(),
  
  /** Timestamps */
  created_at: RequiredTimestampSchema,
  updated_at: RequiredTimestampSchema,
  approved_at: RequiredTimestampSchema.optional(),
  
  /** Human reviewer (for approved specs) */
  approved_by: z.string().optional(),
  
  /** Open questions (cleared on approval) */
  open_questions: z.array(z.string()).default([]),
  
  /** Tags for categorization */
  tags: z.array(z.string()).default([]),
  
  /** File path relative to project root */
  file_path: z.string(),
});
export type SpecEntry = z.infer<typeof SpecEntrySchema>;

/**
 * Change proposal for an existing spec
 */
export const SpecChangeProposalSchema = z.object({
  id: z.string(),
  spec_capability: z.string(),
  current_version: z.number().int(),
  proposed_version: z.number().int(),
  
  /** Why this change? */
  proposal: z.string(),
  
  /** Technical design decisions */
  design: z.string().optional(),
  
  /** Implementation task breakdown */
  tasks: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
    estimated_effort: z.number().int().min(1).max(5),
  })),
  
  /** Status */
  status: z.enum(["draft", "review", "approved", "rejected"]),
  
  /** Linkage */
  bead_id: AnyBeadIdSchema.optional(),
  author: z.string(),
  created_at: RequiredTimestampSchema,
  updated_at: RequiredTimestampSchema,
});
export type SpecChangeProposal = z.infer<typeof SpecChangeProposalSchema>;
```

### Storage Integration

Specs are stored in LanceDB for semantic search, using `kind="spec"`:

```typescript
// Storage implementation in storage.ts

async function storeSpec(spec: SpecEntry): Promise<void> {
  const storage = getStorage();
  
  // Format content for embedding
  const content = formatSpecForEmbedding(spec);
  
  // Store as pattern with kind="spec"
  await storage.storePattern({
    id: spec.id,
    content,
    kind: "spec" as PatternKind,
    is_negative: false,
    tags: [
      spec.status,
      spec.capability,
      `v${spec.version}`,
      ...spec.tags,
    ],
    success_count: 0,
    failure_count: 0,
    created_at: spec.created_at,
    updated_at: spec.updated_at,
    example_beads: spec.bead_id ? [spec.bead_id] : [],
    reason: spec.purpose,
  });
}

function formatSpecForEmbedding(spec: SpecEntry): string {
  const requirements = spec.requirements
    .map(r => `### ${r.name}\n${r.description}\n${r.scenarios.map(s => 
      `- GIVEN ${s.given}\n- WHEN ${s.when}\n- THEN ${s.then.join("\n- AND ")}`
    ).join("\n")}`)
    .join("\n\n");
  
  return `
# ${spec.title}

${spec.purpose}

## Requirements

${requirements}
  `.trim();
}
```

## Tool API (Simplified)

> **Design Principle**: Fewer tools with sensible defaults > many specialized tools
> 
> The original design had 6 agent tools. This simplified version has 3 core tools
> that cover 95% of workflows with less cognitive overhead.

### Simplified Tool Summary

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `spec_write` | Create or update a spec | Starting new capability design |
| `spec_submit` | Submit for human review | Spec is ready for approval |
| `spec_implement` | Create implementation beads | After human approval |
| `spec_query` | Search existing specs | Finding prior art |

### Agent Operations

#### spec_write - Create or Update Specification

> **Replaces**: `spec_draft`, `spec_respond_to_review`
> 
> Single tool for all spec authoring. Mode auto-detected from spec status.

```typescript
export const spec_write = tool({
  description: "Create or update a design specification. Auto-detects whether creating new or updating existing.",
  args: {
    // If provided, updates existing spec. If omitted, creates new.
    spec_id: tool.schema.string().optional()
      .describe("Existing spec ID to update, or omit to create new"),
    capability: tool.schema.string()
      .regex(/^[a-z0-9-]+$/)
      .describe("Capability slug (e.g., 'user-authentication')"),
    title: tool.schema.string()
      .describe("Human-readable title"),
    purpose: tool.schema.string().min(20)
      .describe("Why this capability exists (min 20 chars)"),
    requirements: tool.schema.array(/* ... */),
    // Questions go directly in the spec, not a separate file
    open_questions: tool.schema.array(tool.schema.string()).optional(),
    tags: tool.schema.array(tool.schema.string()).optional(),
  },
  async execute(args, ctx) {
    // Auto-detect mode
    if (args.spec_id) {
      return await updateSpec(args, ctx);
    } else {
      return await createSpec(args, ctx);
    }
  }
});
```

#### spec_submit - Submit for Review

> **Replaces**: `spec_request_review`
> 
> Cleaner name, enforces open_questions resolution.

```typescript
export const spec_submit = tool({
  description: "Submit spec for human review. Fails if open questions exist.",
  args: {
    spec_id: tool.schema.string(),
    summary: tool.schema.string()
      .describe("One-line summary for reviewer"),
  },
  async execute(args, ctx) {
    const spec = await loadSpec(args.spec_id);
    
    // Enforce clean submission
    if (spec.open_questions?.length > 0) {
      return JSON.stringify({
        success: false,
        error: "Resolve open questions before submitting",
        open_questions: spec.open_questions,
        hint: "Use spec_write() to update spec and clear questions",
      });
    }
    
    // Update status and notify
    spec.status = "review";
    await beads_update({ id: spec.bead_id!, status: "blocked" });
    await hivemail_send({
      to: ["human"],
      subject: `[REVIEW] ${spec.title}`,
      body: formatReviewEmail(spec, args.summary),
      importance: "high",
    });
    
    return JSON.stringify({
      success: true,
      spec_id: spec.id,
      status: "review",
      message: "Submitted for review. Use `hive inbox` to check response.",
    });
  }
});
```

#### spec_implement - Create Implementation Beads

> **Replaces**: `spec_create_implementation_beads`
> 
> Shorter name, same functionality.

```typescript  
export const spec_implement = tool({
  description: "Create implementation beads from approved spec",
  args: {
    spec_id: tool.schema.string(),
  },
  async execute(args, ctx) {
    const spec = await loadSpec(args.spec_id);
    
    if (spec.status !== "approved") {
      return JSON.stringify({
        success: false,
        error: `Spec must be approved. Current: ${spec.status}`,
        hint: spec.status === "draft" 
          ? "Use spec_submit() to request review"
          : "Wait for human approval",
      });
    }
    
    // Create epic from tasks.md in change proposal
    // ... implementation same as before
  }
});
```

---

## Tool API (Full Reference)

> The following is the original detailed API for reference.
> Implementation should use the simplified versions above.

### Agent Operations (Original Design)

#### spec_draft - Create Draft Specification

```typescript
export const spec_draft = tool({
  description: "Create a draft specification for a capability. Use when starting design work that needs human review.",
  args: {
    capability: tool.schema.string()
      .regex(/^[a-z0-9-]+$/)
      .describe("Capability slug (e.g., 'user-authentication')"),
    title: tool.schema.string()
      .describe("Human-readable title"),
    purpose: tool.schema.string().min(20)
      .describe("Why this capability exists (min 20 chars)"),
    requirements: tool.schema.array(tool.schema.object({
      name: tool.schema.string().max(50),
      type: tool.schema.enum(["shall", "must", "should", "may"]),
      description: tool.schema.string(),
      scenarios: tool.schema.array(tool.schema.object({
        name: tool.schema.string(),
        given: tool.schema.string(),
        when: tool.schema.string(),
        then: tool.schema.array(tool.schema.string()),
      })),
    })),
    open_questions: tool.schema.array(tool.schema.string()).optional()
      .describe("Questions that need human clarification"),
    discovery_id: tool.schema.string().optional()
      .describe("Discovery that spawned this spec"),
    tags: tool.schema.array(tool.schema.string()).optional(),
  },
  async execute(args, ctx) {
    // 1. Generate spec ID
    const version = 1;
    const specId = `spec-${args.capability}-v${version}`;
    
    // 2. Create bead for tracking
    const bead = await beads_create({
      title: `[SPEC DRAFT] ${args.title}`,
      type: "task",
      description: `Draft specification for ${args.capability}`,
    });
    
    // 3. Create spec entry
    const spec: SpecEntry = {
      id: specId,
      capability: args.capability,
      version,
      status: "draft",
      title: args.title,
      purpose: args.purpose,
      requirements: args.requirements,
      bead_id: bead.id,
      discovery_id: args.discovery_id,
      author: ctx.agent_name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      open_questions: args.open_questions ?? [],
      tags: args.tags ?? [],
      file_path: `openspec/drafts/${specId}/spec.md`,
    };
    
    // 4. Write spec file
    await writeSpecFile(spec);
    
    // 5. Store in LanceDB for search
    await storeSpec(spec);
    
    // 6. Notify if there are open questions
    if (spec.open_questions.length > 0) {
      await hivemail_send({
        to: ["coordinator"],
        subject: `[SPEC DRAFT] ${args.title} - ${spec.open_questions.length} open questions`,
        body: formatOpenQuestionsEmail(spec),
        importance: "normal",
      });
    }
    
    return JSON.stringify({
      success: true,
      spec_id: specId,
      bead_id: bead.id,
      file_path: spec.file_path,
      status: "draft",
      open_questions: spec.open_questions.length,
      next_step: spec.open_questions.length > 0
        ? "Await human clarification on open questions"
        : "Run spec_request_review() when ready",
    }, null, 2);
  }
});
```

#### spec_request_review - Submit for Human Review

```typescript
export const spec_request_review = tool({
  description: "Submit a draft specification for human review. Blocks until human approves, requests changes, or rejects.",
  args: {
    spec_id: tool.schema.string()
      .describe("Spec ID (e.g., 'spec-user-auth-v1')"),
    summary: tool.schema.string()
      .describe("Brief summary of what this spec defines"),
    implementation_estimate: tool.schema.number().int().min(1).max(5).optional()
      .describe("Estimated implementation complexity (1-5)"),
  },
  async execute(args, ctx) {
    // 1. Load spec
    const spec = await loadSpec(args.spec_id);
    if (!spec) {
      throw new Error(`Spec not found: ${args.spec_id}`);
    }
    
    if (spec.status !== "draft") {
      throw new Error(`Spec is not in draft status: ${spec.status}`);
    }
    
    // 2. Check for unresolved questions
    if (spec.open_questions.length > 0) {
      return JSON.stringify({
        success: false,
        error: "Cannot submit for review with open questions",
        open_questions: spec.open_questions,
        action_required: "Resolve open questions first, or update spec to remove them",
      }, null, 2);
    }
    
    // 3. Move to changes/ directory (creates proposal)
    const changeId = `change-${spec.capability}-${Date.now()}`;
    await createChangeProposal(spec, changeId, args.summary);
    
    // 4. Update spec status
    spec.status = "review";
    spec.updated_at = new Date().toISOString();
    spec.file_path = `openspec/changes/${changeId}/specs/${spec.capability}/spec.md`;
    await writeSpecFile(spec);
    await storeSpec(spec);
    
    // 5. Update bead to blocked (awaiting review)
    await beads_update({
      id: spec.bead_id!,
      status: "blocked",
      description: `Awaiting human review: ${args.summary}`,
    });
    
    // 6. Send review request via hivemail
    await hivemail_send({
      to: ["human", "coordinator"],
      subject: `[REVIEW REQUESTED] Spec: ${spec.title}`,
      body: formatReviewRequestEmail(spec, args.summary, args.implementation_estimate),
      importance: "high",
      ack_required: true,
    });
    
    return JSON.stringify({
      success: true,
      spec_id: spec.id,
      change_id: changeId,
      status: "review",
      bead_id: spec.bead_id,
      message: "Spec submitted for human review. Bead blocked until review complete.",
      next_actions: [
        "Human: approve | request-changes | reject",
        "Agent: await review decision via hivemail",
      ],
    }, null, 2);
  }
});
```

#### spec_respond_to_review - Handle Review Feedback

```typescript
export const spec_respond_to_review = tool({
  description: "Respond to human review feedback. Use after receiving review comments.",
  args: {
    spec_id: tool.schema.string(),
    action: tool.schema.enum(["update", "clarify", "withdraw"]),
    updates: tool.schema.object({
      requirements: tool.schema.array(tool.schema.object({
        name: tool.schema.string(),
        type: tool.schema.enum(["shall", "must", "should", "may"]),
        description: tool.schema.string(),
        scenarios: tool.schema.array(tool.schema.object({
          name: tool.schema.string(),
          given: tool.schema.string(),
          when: tool.schema.string(),
          then: tool.schema.array(tool.schema.string()),
        })),
      })).optional(),
      purpose: tool.schema.string().optional(),
    }).optional(),
    clarification: tool.schema.string().optional()
      .describe("Response to reviewer questions"),
  },
  async execute(args, ctx) {
    const spec = await loadSpec(args.spec_id);
    
    if (args.action === "withdraw") {
      // Move back to drafts
      spec.status = "draft";
      await moveSpecToDrafts(spec);
      await beads_update({ id: spec.bead_id!, status: "open" });
      
      return JSON.stringify({
        success: true,
        action: "withdrawn",
        message: "Spec withdrawn from review, moved back to drafts",
      }, null, 2);
    }
    
    if (args.action === "update" && args.updates) {
      // Apply updates
      if (args.updates.requirements) {
        spec.requirements = args.updates.requirements;
      }
      if (args.updates.purpose) {
        spec.purpose = args.updates.purpose;
      }
      spec.updated_at = new Date().toISOString();
      await writeSpecFile(spec);
      await storeSpec(spec);
    }
    
    // Notify reviewer of response
    await hivemail_send({
      to: ["human"],
      subject: `[REVIEW UPDATED] Spec: ${spec.title}`,
      body: args.clarification || "Spec updated based on review feedback. Please re-review.",
      importance: "high",
      ack_required: true,
    });
    
    return JSON.stringify({
      success: true,
      action: args.action,
      spec_id: spec.id,
      status: spec.status,
      message: "Review response sent to human reviewer",
    }, null, 2);
  }
});
```

### Human Operations (CLI Commands)

These are invoked by humans via CLI, not by agents.

#### Human Inbox - How Humans Receive Notifications

> **Critical UX Gap**: The original design didn't specify how humans receive hivemail.
> This section addresses that gap.

```bash
# Check inbox for pending items (NEW - required for human-in-loop)
hive inbox                              # Show unread messages
hive inbox --all                        # Show all messages
hive inbox --filter review              # Show only review requests

# Read a specific message
hive inbox read 42                      # Read message ID 42

# Quick reply to agent
hive inbox reply 42 "Approved, good work"
```

**Implementation Note**: The `hive inbox` command wraps the existing hivemail system,
filtering for messages sent `to: ["human"]`. This bridges the gap between agent
communication and human CLI workflow.

#### Spec Management Commands

```bash
# List specs awaiting review
hive spec list --status review

# Approve a spec
hive spec approve spec-user-auth-v1 --comment "Looks good"

# Request changes
hive spec request-changes spec-user-auth-v1 --comment "Need scenario for password reset"

# Reject a spec
hive spec reject spec-user-auth-v1 --reason "Out of scope for MVP"

# Query specs by capability
hive spec search "authentication"

# Show spec history
hive spec history user-auth

# Quick clarify (shortcut for common workflow)
hive spec clarify spec-rate-limiting-v1 \
  --question "Should rate limits be per-user or per-API-key?" \
  --answer "Per API key"
```

#### CLI Implementation

```typescript
// src/cli/commands/spec.ts

import { command } from "commander";
import { loadSpec, updateSpecStatus, createImplementationBeads } from "../spec";
import { hivemail_send } from "../hive-mail";

export const specCommand = command("spec")
  .description("Manage design specifications");

specCommand
  .command("approve <spec-id>")
  .option("--comment <comment>", "Approval comment")
  .action(async (specId, opts) => {
    const spec = await loadSpec(specId);
    
    // 1. Update status to approved
    spec.status = "approved";
    spec.approved_at = new Date().toISOString();
    spec.approved_by = process.env.USER || "human";
    spec.updated_at = new Date().toISOString();
    
    // 2. Increment version and move to specs/
    const newVersion = spec.version;
    spec.file_path = `openspec/specs/${spec.capability}/spec.md`;
    await writeSpecFile(spec);
    
    // 3. Archive previous version if exists
    await archivePreviousVersion(spec.capability, spec.version - 1);
    
    // 4. Update bead
    await beads_update({
      id: spec.bead_id!,
      status: "open", // Unblock
      description: `Spec approved. Ready for implementation.`,
    });
    
    // 5. Notify agent
    await hivemail_send({
      to: [spec.author],
      subject: `[APPROVED] Spec: ${spec.title}`,
      body: `Your spec has been approved!\n\nComment: ${opts.comment || "None"}\n\nNext: Run spec_create_implementation_beads() to create work items.`,
      importance: "high",
    });
    
    console.log(`✅ Spec ${specId} approved`);
  });

specCommand
  .command("request-changes <spec-id>")
  .option("--comment <comment>", "Required changes", { required: true })
  .action(async (specId, opts) => {
    const spec = await loadSpec(specId);
    
    // Keep in review status, notify agent
    await hivemail_send({
      to: [spec.author],
      subject: `[CHANGES REQUESTED] Spec: ${spec.title}`,
      body: `Please update the spec based on the following feedback:\n\n${opts.comment}\n\nUse spec_respond_to_review() to submit updates.`,
      importance: "high",
      ack_required: true,
    });
    
    console.log(`📝 Changes requested for ${specId}`);
  });

specCommand
  .command("reject <spec-id>")
  .option("--reason <reason>", "Rejection reason", { required: true })
  .action(async (specId, opts) => {
    const spec = await loadSpec(specId);
    
    spec.status = "deprecated";
    await writeSpecFile(spec);
    
    await beads_close({
      id: spec.bead_id!,
      reason: `Spec rejected: ${opts.reason}`,
    });
    
    await hivemail_send({
      to: [spec.author],
      subject: `[REJECTED] Spec: ${spec.title}`,
      body: `Spec has been rejected.\n\nReason: ${opts.reason}`,
      importance: "normal",
    });
    
    console.log(`❌ Spec ${specId} rejected`);
  });
```

### Coordinator Operations

#### spec_query - Search Specifications

```typescript
export const spec_query = tool({
  description: "Search specifications by capability, status, or semantic content",
  args: {
    capability: tool.schema.string().optional(),
    status: tool.schema.enum(["draft", "review", "approved", "implemented", "deprecated"]).optional(),
    search: tool.schema.string().optional()
      .describe("Semantic search query"),
    limit: tool.schema.number().int().default(10),
  },
  async execute(args) {
    const storage = getStorage();
    
    if (args.search) {
      // Semantic search
      const patterns = await storage.findSimilarPatterns(args.search, args.limit);
      const specs = patterns
        .filter(p => p.kind === "spec")
        .filter(p => !args.status || p.tags.includes(args.status))
        .filter(p => !args.capability || p.tags.includes(args.capability));
      
      return JSON.stringify({
        count: specs.length,
        specs: await Promise.all(specs.map(p => loadSpec(p.id))),
      }, null, 2);
    }
    
    // Filter-based query
    const allPatterns = await storage.getAllPatterns();
    const specs = allPatterns
      .filter(p => p.kind === "spec")
      .filter(p => !args.status || p.tags.includes(args.status))
      .filter(p => !args.capability || p.tags.includes(args.capability))
      .slice(0, args.limit);
    
    return JSON.stringify({
      count: specs.length,
      specs: await Promise.all(specs.map(p => loadSpec(p.id))),
    }, null, 2);
  }
});
```

#### spec_create_implementation_beads - Generate Work Items

```typescript
export const spec_create_implementation_beads = tool({
  description: "Create implementation beads from an approved spec's tasks. Only works on approved specs.",
  args: {
    spec_id: tool.schema.string(),
    epic_title: tool.schema.string().optional()
      .describe("Override epic title (default: spec title)"),
  },
  async execute(args, ctx) {
    const spec = await loadSpec(args.spec_id);
    
    if (spec.status !== "approved") {
      throw new Error(`Spec must be approved before creating implementation beads. Current status: ${spec.status}`);
    }
    
    // Load change proposal to get tasks
    const changeProposal = await loadChangeProposal(spec.capability);
    if (!changeProposal) {
      throw new Error("No change proposal found. Spec must go through review process.");
    }
    
    // Create epic
    const result = await beads_create_epic({
      epic_title: args.epic_title || `Implement: ${spec.title}`,
      epic_description: `Implementation of spec ${spec.id}\n\n${spec.purpose}`,
      subtasks: changeProposal.tasks.map(t => ({
        title: t.title,
        priority: mapComplexityToPriority(t.estimated_effort),
        files: [], // Agent will determine files during execution
      })),
    });
    
    // Update spec status
    spec.status = "implemented";
    spec.updated_at = new Date().toISOString();
    await writeSpecFile(spec);
    await storeSpec(spec);
    
    // Link spec bead to epic
    await beads_update({
      id: spec.bead_id!,
      status: "closed",
      description: `Spec implemented via epic ${result.epic.id}`,
    });
    
    return JSON.stringify({
      success: true,
      spec_id: spec.id,
      epic_id: result.epic.id,
      subtasks: result.subtasks.map(s => ({
        id: s.id,
        title: s.title,
      })),
      message: "Implementation beads created. Use hive decompose flow to assign agents.",
    }, null, 2);
  }
});
```

## Commit Strategy

### Atomic Commits

Spec changes are committed atomically with meaningful messages:

```bash
# Draft creation
git add openspec/drafts/spec-user-auth-v1/
git commit -m "spec(user-auth): create draft specification"

# Submit for review (moves to changes/)
git add openspec/drafts/ openspec/changes/
git commit -m "spec(user-auth): submit for review"

# Approval (moves to specs/)
git add openspec/changes/ openspec/specs/
git commit -m "spec(user-auth): approve v1"

# Implementation complete
git commit -m "spec(user-auth): mark as implemented"
```

### Spec Deltas

When updating an existing spec, create a delta showing changes:

```markdown
# user-auth Specification (Delta)

## MODIFIED Requirements

### Requirement: Session expiration

- The system SHALL expire sessions after a configured duration.
+ The system SHALL support configurable session expiration periods.

#### Scenario: Default session timeout
- **GIVEN** a user has authenticated
-- **WHEN** 24 hours pass without activity
+- **WHEN** 24 hours pass without "Remember me"
- **THEN** invalidate the session token

## ADDED Requirements

### Requirement: Remember me functionality

The system MUST support extended sessions for users who check "Remember me".

#### Scenario: Extended session
- **GIVEN** user checks "Remember me" at login
- **WHEN** 30 days have passed
- **THEN** invalidate the session token
- **AND** clear the persistent cookie
```

### Git Hooks (Optional)

For teams wanting stricter enforcement:

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Validate OpenSpec format
for file in $(git diff --cached --name-only | grep 'openspec/.*spec\.md$'); do
  if ! hive spec validate "$file"; then
    echo "❌ Invalid spec format: $file"
    exit 1
  fi
done
```

## Sequence Numbers & Versioning

### Version Scheme

```
spec-{capability}-v{major}

Examples:
- spec-user-auth-v1      (initial version)
- spec-user-auth-v2      (breaking change)
- spec-user-auth-v3      (another breaking change)
```

### When to Increment

| Change Type | Action |
|-------------|--------|
| New requirement added | Increment version |
| Requirement removed | Increment version |
| Scenario added to existing requirement | Same version (patch) |
| Clarification/typo fix | Same version (no increment) |
| Breaking behavioral change | Increment version |

### Version History

Each capability maintains history:

```
openspec/specs/user-auth/
├── spec.md           # Current (v3)
└── history/
    ├── spec.v1.md    # Archived
    └── spec.v2.md    # Archived
```

Query history:

```typescript
const history = await spec_history("user-auth");
// Returns: [v3 (current), v2 (archived), v1 (archived)]
```

## Integration Points

### 1. Beads Integration

Every spec has an associated bead for tracking:

```typescript
// Spec → Bead linkage
interface SpecBeadLink {
  spec_id: "spec-user-auth-v1";
  bead_id: "opencode-swarm-plugin-abc.1";
  bead_type: "task"; // Spec tracking bead
  bead_status: "open" | "blocked" | "closed";
}

// Implementation → Spec linkage
interface ImplementationLink {
  epic_id: "opencode-swarm-plugin-xyz";
  spec_id: "spec-user-auth-v1";
  subtask_ids: ["...", "..."];
}
```

### 2. Discovery Integration

Discoveries can spawn specs:

```typescript
// When a discovery suggests new capability
await discovery_promote({
  discovery_id: "disc-123",
  action: "create-spec", // New action type
  spec_args: {
    capability: "rate-limiting",
    title: "Rate Limiting",
    purpose: "Protect APIs from abuse with request rate limits",
  }
});

// Creates draft spec linked to discovery
// spec.discovery_id = "disc-123"
```

### 3. Mandates Integration

High-consensus mandates can influence specs:

```typescript
// When mandate reaches "established" status
// Check if it relates to existing specs
const relatedSpecs = await spec_query({ 
  search: mandate.content 
});

if (relatedSpecs.length > 0) {
  // Suggest spec update
  await hivemail_send({
    to: ["coordinator"],
    subject: `Mandate may affect spec: ${relatedSpecs[0].title}`,
    body: `A mandate has reached consensus that may require spec update:\n\n${mandate.content}`,
  });
}
```

### 4. Learning Integration

Track spec quality through outcomes:

```typescript
// After implementation complete
interface SpecOutcome {
  spec_id: string;
  implementation_duration_ms: number;
  requirement_changes_during_impl: number;
  bugs_found_post_impl: number;
  developer_satisfaction: 1 | 2 | 3 | 4 | 5;
}

// Learn which spec patterns lead to successful implementations
// Feed back into spec_draft suggestions
```

## Human Review Workflows

### Workflow 1: Standard Review

```
Agent                          Human                         System
  │                              │                              │
  ├─ spec_draft() ─────────────►│                              │
  │  Creates draft               │                              │
  │                              │                              │
  ├─ spec_request_review() ────►│◄───── notification ──────────┤
  │  Submits for review          │                              │
  │                              │                              │
  │◄─────────────────────────────┤ hive spec approve            │
  │  Approval notification       │                              │
  │                              │                              │
  ├─ spec_create_impl_beads() ─►│                              │
  │  Creates work items          │                              │
```

### Workflow 2: Review with Changes

```
Agent                          Human                         System
  │                              │                              │
  ├─ spec_request_review() ────►│◄───── notification ──────────┤
  │                              │                              │
  │◄─────────────────────────────┤ hive spec request-changes    │
  │  Change request notification │ "Need password reset scenario"│
  │                              │                              │
  ├─ spec_respond_to_review() ─►│                              │
  │  action: "update"            │                              │
  │  updates: {new scenarios}    │                              │
  │                              │                              │
  │◄─────────────────────────────┤ hive spec approve            │
  │  Final approval              │                              │
```

### Workflow 3: Clarification Needed

```
Agent                          Human                         System
  │                              │                              │
  ├─ spec_draft() ─────────────►│                              │
  │  open_questions: [           │                              │
  │    "Should support SSO?"     │                              │
  │  ]                           │                              │
  │                              │◄───── notification ──────────┤
  │                              │  "Draft has open questions"  │
  │                              │                              │
  │◄─────────────────────────────┤ hivemail reply               │
  │  "Yes, SSO is required"      │                              │
  │                              │                              │
  ├─ Update spec with SSO req ─►│                              │
  ├─ spec_request_review() ────►│                              │
```

## Zero-Config Verification

The spec system achieves **zero-config operation** by leveraging existing infrastructure:

### ✅ No Setup Required

| Component | Status | Evidence |
|-----------|--------|----------|
| Storage | ✅ Zero-config | LanceDB at `.hive/vectors` auto-created |
| Tracking | ✅ Zero-config | Uses existing beads system |
| Communication | ✅ Zero-config | Uses existing hivemail |
| Search | ✅ Zero-config | Semantic search via embeddings |
| File Structure | ✅ Auto-created | `openspec/` dirs created on first use |

### ✅ No Config Files

- No `.specrc` needed
- No `openspec.config.ts` needed
- No environment variables required
- Directories created automatically

### ✅ Progressive Adoption

1. **Start simple**: Just use `spec_write()` for documentation
2. **Add review**: Use `spec_submit()` when ready for human approval
3. **Full workflow**: Use complete spec → review → implementation flow

### Quick Spec Mode (Skip Review)

For internal documentation or trusted agents, allow skipping human review:

```typescript
// Quick spec - auto-approves without human review
await spec_write({
  capability: "internal-logging",
  title: "Internal Logging Standards",
  purpose: "Document logging conventions for internal use",
  requirements: [...],
  // Magic flag: skips review, goes straight to approved
  quick: true,  
  tags: ["internal", "documentation"],
});
```

**When to use Quick Spec**:
- Internal documentation not requiring review
- Trivial changes (typos, clarifications)
- Trusted agent with established track record
- Time-sensitive specs where human is unavailable

**When NOT to use Quick Spec**:
- User-facing features
- Security-related specs
- Architectural decisions
- Anything that affects external APIs

## Success Metrics

### Spec Quality

- **Completeness**: % of specs with all required sections
- **Scenario coverage**: Average scenarios per requirement
- **Review cycles**: Average reviews before approval

### Process Efficiency

- **Time to approval**: Draft → Approved duration
- **Implementation alignment**: Requirement changes during implementation
- **Bug rate**: Post-implementation bugs linked to spec gaps

### Adoption

- **Spec coverage**: % of features with specs
- **Human engagement**: Review response time
- **Reuse**: Specs referenced by other specs

## Example: Complete Workflow

### Step 1: Agent Creates Draft

```typescript
// Agent discovers need for rate limiting during implementation
await spec_draft({
  capability: "rate-limiting",
  title: "API Rate Limiting",
  purpose: "Protect APIs from abuse by limiting request rates per client",
  requirements: [
    {
      name: "Request rate limits",
      type: "shall",
      description: "The system SHALL enforce configurable rate limits per API endpoint",
      scenarios: [
        {
          name: "Rate limit exceeded",
          given: "a client has made 100 requests in 1 minute",
          when: "the client makes request 101",
          then: ["return HTTP 429 Too Many Requests", "include Retry-After header"],
        },
        {
          name: "Rate limit reset",
          given: "a client was rate limited",
          when: "the rate limit window expires",
          then: ["allow new requests", "reset the counter"],
        },
      ],
    },
    {
      name: "Rate limit bypass",
      type: "should",
      description: "The system SHOULD allow certain clients to bypass rate limits",
      scenarios: [
        {
          name: "Whitelisted client",
          given: "a client is on the whitelist",
          when: "the client exceeds normal rate limits",
          then: ["allow the request", "log the bypass"],
        },
      ],
    },
  ],
  open_questions: [
    "Should rate limits be per-user or per-API-key?",
    "What's the default rate limit (requests per minute)?",
  ],
  tags: ["security", "api", "infrastructure"],
});

// Output:
// {
//   "success": true,
//   "spec_id": "spec-rate-limiting-v1",
//   "bead_id": "opencode-swarm-plugin-abc",
//   "file_path": "openspec/drafts/spec-rate-limiting-v1/spec.md",
//   "status": "draft",
//   "open_questions": 2,
//   "next_step": "Await human clarification on open questions"
// }
```

### Step 2: Human Clarifies Questions

```bash
# Human receives hivemail notification about open questions
# Human replies via hivemail or directly updates spec

hive spec clarify spec-rate-limiting-v1 \
  --question "Should rate limits be per-user or per-API-key?" \
  --answer "Per API key, with user-level override capability"

hive spec clarify spec-rate-limiting-v1 \
  --question "What's the default rate limit?" \
  --answer "100 requests per minute for standard tier"
```

### Step 3: Agent Updates and Submits

```typescript
// Agent receives clarification, updates spec
await spec_respond_to_review({
  spec_id: "spec-rate-limiting-v1",
  action: "update",
  updates: {
    requirements: [
      // ... updated requirements with clarifications incorporated
    ],
  },
});

// Submit for review
await spec_request_review({
  spec_id: "spec-rate-limiting-v1",
  summary: "Rate limiting capability to protect APIs from abuse",
  implementation_estimate: 3,
});
```

### Step 4: Human Approves

```bash
hive spec approve spec-rate-limiting-v1 \
  --comment "Good coverage of edge cases. Approved for implementation."
```

### Step 5: Agent Creates Implementation Beads

```typescript
await spec_create_implementation_beads({
  spec_id: "spec-rate-limiting-v1",
});

// Output:
// {
//   "success": true,
//   "spec_id": "spec-rate-limiting-v1",
//   "epic_id": "opencode-swarm-plugin-xyz",
//   "subtasks": [
//     {"id": "opencode-swarm-plugin-xyz.1", "title": "Implement rate limit middleware"},
//     {"id": "opencode-swarm-plugin-xyz.2", "title": "Add rate limit storage (Redis)"},
//     {"id": "opencode-swarm-plugin-xyz.3", "title": "Create whitelist management API"},
//     {"id": "opencode-swarm-plugin-xyz.4", "title": "Add rate limit headers to responses"}
//   ],
//   "message": "Implementation beads created. Use hive decompose flow to assign agents."
// }
```

### Step 6: Implementation via Hive

```typescript
// Standard hive workflow takes over
await hive_decompose({
  epic_id: "opencode-swarm-plugin-xyz",
  // ... assigns agents to subtasks
});
```

## Appendix A: File Templates

### Draft Spec Template

```markdown
# {Capability Name} Specification

**Version**: 1
**Status**: draft
**Author**: {agent-name}
**Created**: {timestamp}
**Updated**: {timestamp}
**Bead**: {bead-id}

## Purpose

{Purpose statement - minimum 20 characters}

## Requirements

### Requirement: {Name}

The system SHALL {behavior}.

#### Scenario: {Name}

- **GIVEN** {precondition}
- **WHEN** {action}
- **THEN** {outcome}

## Open Questions

- {Question 1}
- {Question 2}

## Change History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1 | {date} | {author} | Initial draft |
```

### Change Proposal Template

```markdown
# Change Proposal: {Change Title}

**Change ID**: {change-id}
**Spec**: {capability}
**Current Version**: {current}
**Proposed Version**: {proposed}
**Author**: {agent-name}
**Created**: {timestamp}

## Summary

{Brief description of what this change accomplishes}

## Motivation

{Why is this change needed?}

## Design Decisions

{Key technical decisions and trade-offs}

## Implementation Tasks

1. **{Task 1}** (complexity: {1-5})
   - {Description}

2. **{Task 2}** (complexity: {1-5})
   - {Description}

## Spec Delta

See `specs/{capability}/spec.md` for the proposed specification changes.

## Risks

- {Risk 1 and mitigation}
- {Risk 2 and mitigation}
```

## Appendix B: Schema Reference

See `src/schemas/spec.ts` for complete TypeScript definitions:

- `SpecStatusSchema`: 5 lifecycle states
- `RequirementTypeSchema`: 4 normative types (shall, must, should, may)
- `SpecRequirementSchema`: Requirement structure with scenarios
- `SpecEntrySchema`: Complete spec entry
- `SpecChangeProposalSchema`: Change proposal structure

## Appendix C: Related Documents

- [Discovery Queue Design](./discovery-queue-design.md) - How discoveries spawn specs
- [Mandates System](../src/schemas/mandate.ts) - How consensus influences specs
- [Beads System](../src/beads.ts) - Tracking integration
- [Learning System](../src/learning.ts) - Feedback on spec quality
- [OpenSpec Documentation](https://openspec.dev) - Industry standard reference

---

**End of Design Specification**
