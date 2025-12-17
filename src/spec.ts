/**
 * Specification Tools Module
 *
 * Provides tools for managing design specifications through a collaborative
 * human-agent process. Implements the design-specification-strategy.
 *
 * Tools:
 * - spec_write: Create or update specifications
 * - spec_submit: Submit for human review
 * - spec_implement: Create implementation beads from approved specs
 * - spec_query: Search specs by capability, status, or semantic content
 *
 * @see docs/analysis/design-specification-strategy.md
 */
import { tool } from "@opencode-ai/plugin";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { getStorage } from "./storage";
import type { DecompositionPattern } from "./pattern-maturity";
import {
  SpecEntrySchema,
  type SpecEntry,
  type SpecChangeProposal,
  type ApproverType,
} from "./schemas/spec";
import { beads_create, beads_update, beads_create_epic } from "./beads";
import { hivemail_send } from "./hive-mail";
import {
  createDirectoryContext,
  CONTEXT_NAMES,
} from "./utils/directory-context";

// ============================================================================
// Configuration
// ============================================================================

/**
 * Directory context for spec operations.
 * Set this via setSpecWorkingDirectory() before using tools.
 */
const specDirContext = createDirectoryContext(CONTEXT_NAMES.SPEC);

/**
 * Set the working directory for all spec commands.
 * Call this from the plugin initialization with the project directory.
 */
export function setSpecWorkingDirectory(directory: string): void {
  specDirContext.set(directory);
}

/**
 * Get the current working directory for spec commands.
 */
export function getSpecWorkingDirectory(): string {
  return specDirContext.get();
}

// ============================================================================
// Errors
// ============================================================================

/**
 * Custom error for spec operations
 */
export class SpecError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SpecError";
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a spec ID from capability and version
 */
function generateSpecId(capability: string, version: number): string {
  return `spec-${capability}-v${version}`;
}

/**
 * Get the file path for a spec based on its status
 */
function getSpecFilePath(spec: SpecEntry): string {
  const baseDir = getSpecWorkingDirectory();

  if (spec.status === "draft") {
    return join(baseDir, "openspec", "drafts", spec.id, "spec.md");
  } else if (spec.status === "review") {
    return join(
      baseDir,
      "openspec",
      "changes",
      `change-${spec.capability}-${Date.now()}`,
      "specs",
      spec.capability,
      "spec.md",
    );
  } else {
    return join(baseDir, "openspec", "specs", spec.capability, "spec.md");
  }
}

/**
 * Format a spec entry for embedding in LanceDB
 */
export function formatSpecForEmbedding(spec: SpecEntry): string {
  const requirements = spec.requirements
    .map(
      (r) =>
        `### ${r.name}\n${r.description}\n${r.scenarios
          .map(
            (s) =>
              `- GIVEN ${s.given}\n- WHEN ${s.when}\n- THEN ${s.then.join("\n- AND ")}`,
          )
          .join("\n")}`,
    )
    .join("\n\n");

  return `
# ${spec.title}

${spec.purpose}

## Requirements

${requirements}
  `.trim();
}

/**
 * Format a spec entry as OpenSpec-compatible Markdown
 */
function formatSpecAsMarkdown(spec: SpecEntry): string {
  const requirements = spec.requirements
    .map((r) => {
      const scenarios = r.scenarios
        .map(
          (s) =>
            `#### Scenario: ${s.name}\n\n- **GIVEN** ${s.given}\n- **WHEN** ${s.when}\n- **THEN** ${s.then.join("\n- **AND** ")}`,
        )
        .join("\n\n");

      return `### Requirement: ${r.name}\n\nThe system ${r.type.toUpperCase()} ${r.description}.\n\n${scenarios}`;
    })
    .join("\n\n");

  const nfr = spec.nfr
    ? `## Non-Functional Requirements

${spec.nfr.performance ? `### Performance\n- ${spec.nfr.performance}\n` : ""}
${spec.nfr.security ? `### Security\n- ${spec.nfr.security}\n` : ""}
${spec.nfr.scalability ? `### Scalability\n- ${spec.nfr.scalability}\n` : ""}`
    : "";

  const openQuestions =
    spec.open_questions.length > 0
      ? `## Open Questions\n\n${spec.open_questions.map((q) => `- ${q}`).join("\n")}`
      : "";

  return `# ${spec.title} Specification

**Version**: ${spec.version}
**Status**: ${spec.status}
**Author**: ${spec.author}
**Created**: ${spec.created_at}
**Updated**: ${spec.updated_at}
${spec.bead_id ? `**Bead**: ${spec.bead_id}` : ""}

## Purpose

${spec.purpose}

## Requirements

${requirements}

${nfr}

${spec.dependencies.length > 0 ? `## Dependencies\n\n${spec.dependencies.map((d) => `- ${d}`).join("\n")}` : ""}

${openQuestions}

## Change History

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| ${spec.version} | ${spec.created_at.split("T")[0]} | ${spec.author} | Initial specification |
`;
}

/**
 * Write a spec file to disk
 */
export async function writeSpecFile(spec: SpecEntry): Promise<string> {
  const filePath = spec.file_path || getSpecFilePath(spec);
  const dir = dirname(filePath);

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Format and write
  const content = formatSpecAsMarkdown(spec);
  writeFileSync(filePath, content, "utf-8");

  return filePath;
}

/**
 * Load a spec from LanceDB storage
 */
export async function loadSpec(specId: string): Promise<SpecEntry | null> {
  const storage = getStorage();

  // Use findSimilarPatterns with exact ID match
  const patterns = await storage.findSimilarPatterns(specId, 10);

  // Find exact match
  const match = patterns.find((p) => p.id === specId && p.kind === "spec");
  if (!match) {
    return null;
  }

  // Parse the spec from pattern data
  // Note: Full spec data is in the content and tags
  const specPath = join(
    getSpecWorkingDirectory(),
    "openspec",
    "drafts",
    specId,
    "spec.json",
  );

  if (existsSync(specPath)) {
    try {
      const data = readFileSync(specPath, "utf-8");
      return SpecEntrySchema.parse(JSON.parse(data));
    } catch {
      // Fall through to null
    }
  }

  return null;
}

/**
 * Store a spec in LanceDB for semantic search
 */
async function storeSpec(spec: SpecEntry): Promise<void> {
  const storage = getStorage();

  // Format content for embedding
  const content = formatSpecForEmbedding(spec);

  // Store as pattern with kind="spec"
  const pattern: DecompositionPattern = {
    id: spec.id,
    content,
    kind: "spec",
    is_negative: false,
    tags: [spec.status, spec.capability, `v${spec.version}`, ...spec.tags],
    success_count: 0,
    failure_count: 0,
    created_at: spec.created_at,
    updated_at: spec.updated_at,
    example_beads: spec.bead_id ? [spec.bead_id] : [],
    reason: spec.purpose,
  };

  await storage.storePattern(pattern);

  // Also store JSON file for full data retrieval
  const jsonPath = join(
    getSpecWorkingDirectory(),
    "openspec",
    "drafts",
    spec.id,
    "spec.json",
  );
  const jsonDir = dirname(jsonPath);
  if (!existsSync(jsonDir)) {
    mkdirSync(jsonDir, { recursive: true });
  }
  writeFileSync(jsonPath, JSON.stringify(spec, null, 2), "utf-8");
}

/**
 * Create a change proposal for submitting a spec for review
 */
export async function createChangeProposal(
  spec: SpecEntry,
  changeId: string,
  summary: string,
): Promise<SpecChangeProposal> {
  const baseDir = getSpecWorkingDirectory();
  const changeDir = join(baseDir, "openspec", "changes", changeId);

  // Create change directory
  if (!existsSync(changeDir)) {
    mkdirSync(changeDir, { recursive: true });
  }

  // Create proposal
  const proposal: SpecChangeProposal = {
    id: changeId,
    spec_capability: spec.capability,
    current_version: spec.version - 1,
    proposed_version: spec.version,
    proposal: summary,
    tasks: spec.requirements.map((r) => ({
      title: `Implement: ${r.name}`,
      description: r.description,
      estimated_effort: Math.min(
        5,
        Math.max(1, Math.ceil(r.scenarios.length / 2)),
      ),
    })),
    status: "review",
    bead_id: spec.bead_id,
    author: spec.author,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Write proposal file
  const proposalPath = join(changeDir, "proposal.md");
  const proposalContent = `# Change Proposal: ${spec.title}

**ID**: ${changeId}
**Capability**: ${spec.capability}
**Version**: ${proposal.current_version} → ${proposal.proposed_version}
**Author**: ${proposal.author}
**Created**: ${proposal.created_at}

## Summary

${summary}

## Tasks

${proposal.tasks.map((t) => `- [ ] ${t.title} (effort: ${t.estimated_effort}/5)`).join("\n")}
`;
  writeFileSync(proposalPath, proposalContent, "utf-8");

  // Write tasks.md
  const tasksPath = join(changeDir, "tasks.md");
  const tasksContent = `# Implementation Tasks

${proposal.tasks.map((t) => `## ${t.title}\n\n${t.description || "No description"}\n\n**Effort**: ${t.estimated_effort}/5`).join("\n\n")}
`;
  writeFileSync(tasksPath, tasksContent, "utf-8");

  return proposal;
}

/**
 * Format review email for human notification
 */
function formatReviewEmail(spec: SpecEntry, summary: string): string {
  return `# Specification Review Request

**Title**: ${spec.title}
**Capability**: ${spec.capability}
**Version**: ${spec.version}
**Author**: ${spec.author}

## Summary

${summary}

## Purpose

${spec.purpose}

## Requirements Count

- Total requirements: ${spec.requirements.length}
- Mandatory (SHALL/MUST): ${spec.requirements.filter((r) => r.type === "shall" || r.type === "must").length}
- Recommended (SHOULD): ${spec.requirements.filter((r) => r.type === "should").length}
- Optional (MAY): ${spec.requirements.filter((r) => r.type === "may").length}

## Actions

Reply to this message with:
- **APPROVED** - to approve the specification
- **CHANGES: <feedback>** - to request changes
- **REJECTED: <reason>** - to reject the specification

---

File path: ${spec.file_path}
Bead ID: ${spec.bead_id || "N/A"}
`;
}

// ============================================================================
// Core Approval Logic
// ============================================================================

/**
 * Default confidence threshold for auto-approval.
 * Specs with confidence >= this value will be auto-approved when using spec_quick_write.
 */
export const DEFAULT_AUTO_APPROVE_THRESHOLD = 0.8;

/**
 * Approve a specification programmatically.
 *
 * This is the core approval function that can be invoked by both CLI and programmatic callers.
 * It handles all approval side effects: status change, timestamp, notifications, and bead updates.
 *
 * @param specId - The spec ID to approve
 * @param approver - Who is approving: "human" | "system" | specific human identifier
 * @param ctx - Tool execution context for calling other tools
 * @returns The approved spec entry
 * @throws SpecError if spec not found or not in a state that can be approved
 */
export async function approveSpec(
  specId: string,
  approver: ApproverType | string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): Promise<SpecEntry> {
  const spec = await loadSpec(specId);
  if (!spec) {
    throw new SpecError(`Spec not found: ${specId}`, "NOT_FOUND", { specId });
  }

  // Allow approval from draft (for auto-approve) or review (for human review)
  if (spec.status !== "draft" && spec.status !== "review") {
    throw new SpecError(
      `Spec cannot be approved from status: ${spec.status}`,
      "INVALID_STATUS",
      { specId, currentStatus: spec.status },
    );
  }

  const now = new Date().toISOString();

  // Update spec
  spec.status = "approved";
  spec.approved_at = now;
  spec.approved_by = approver;
  spec.updated_at = now;

  // Update file path to approved location
  spec.file_path = join(
    getSpecWorkingDirectory(),
    "openspec",
    "specs",
    spec.capability,
    "spec.md",
  );

  // Write to new location and update storage
  await writeSpecFile(spec);
  await storeSpec(spec);

  // Update bead status if linked
  if (spec.bead_id) {
    await beads_update.execute(
      {
        id: spec.bead_id,
        status: "closed",
        description: `Spec ${spec.id} approved by ${approver}`,
      },
      ctx,
    );
  }

  return spec;
}

/**
 * Auto-approve a specification (system approval).
 *
 * This is a convenience function that mirrors CLI approval but for programmatic use.
 * It sets approved_by to "system" and sends a notification via hivemail.
 *
 * @param specId - The spec ID to auto-approve
 * @param ctx - Tool execution context
 * @returns The approved spec entry
 */
export async function autoApproveSpec(
  specId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
): Promise<SpecEntry> {
  const spec = await approveSpec(specId, "system", ctx);

  // Send notification about auto-approval
  await hivemail_send.execute(
    {
      to: ["coordinator", "human"],
      subject: `[AUTO-APPROVED] ${spec.title}`,
      body: formatAutoApprovalNotification(spec),
      importance: "normal",
    },
    ctx,
  );

  return spec;
}

/**
 * Format notification for auto-approved specs
 */
function formatAutoApprovalNotification(spec: SpecEntry): string {
  return `# Specification Auto-Approved

**Title**: ${spec.title}
**Capability**: ${spec.capability}
**Version**: ${spec.version}
**Spec ID**: ${spec.id}

## Purpose

${spec.purpose}

## Details

- **Requirements**: ${spec.requirements.length} total
- **Confidence**: ${spec.confidence !== undefined ? `${(spec.confidence * 100).toFixed(0)}%` : "N/A"}
- **Approved At**: ${spec.approved_at}
- **Approved By**: system (auto-approval)

## Actions

This spec was auto-approved based on confidence threshold or explicit auto_approve flag.
If you need to revise, use spec_write() to create a new version.

---

File path: ${spec.file_path}
Bead ID: ${spec.bead_id || "N/A"}
`;
}

/**
 * Check if a spec should be auto-approved based on confidence threshold
 */
function shouldAutoApprove(
  autoApprove: boolean | undefined,
  confidence: number | undefined,
  threshold: number = DEFAULT_AUTO_APPROVE_THRESHOLD,
): boolean {
  // Explicit auto_approve flag takes precedence
  if (autoApprove === true) {
    return true;
  }
  if (autoApprove === false) {
    return false;
  }

  // Fall back to confidence threshold
  if (confidence !== undefined && confidence >= threshold) {
    return true;
  }

  return false;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * spec_write - Create or update a specification
 */
export const spec_write = tool({
  description:
    "Create or update a design specification. Auto-detects whether creating new or updating existing based on spec_id.",
  args: {
    spec_id: tool.schema
      .string()
      .optional()
      .describe("Existing spec ID to update, or omit to create new"),
    capability: tool.schema
      .string()
      .regex(/^[a-z0-9-]+$/)
      .describe("Capability slug (e.g., 'user-authentication')"),
    title: tool.schema.string().describe("Human-readable title"),
    purpose: tool.schema
      .string()
      .min(20)
      .describe("Why this capability exists (min 20 chars)"),
    requirements: tool.schema
      .array(
        tool.schema.object({
          id: tool.schema.string().optional().describe("Requirement ID"),
          name: tool.schema.string().max(50).describe("Short requirement name"),
          type: tool.schema
            .enum(["shall", "must", "should", "may"])
            .describe("Normative language type"),
          description: tool.schema.string().describe("Full description"),
          scenarios: tool.schema
            .array(
              tool.schema.object({
                name: tool.schema.string(),
                given: tool.schema.string(),
                when: tool.schema.string(),
                then: tool.schema.array(tool.schema.string()),
              }),
            )
            .describe("Test scenarios in Given-When-Then format"),
          tags: tool.schema.array(tool.schema.string()).optional(),
        }),
      )
      .describe("Structured requirements"),
    nfr: tool.schema
      .object({
        performance: tool.schema.string().optional(),
        security: tool.schema.string().optional(),
        scalability: tool.schema.string().optional(),
      })
      .optional()
      .describe("Non-functional requirements"),
    open_questions: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Questions that need human clarification"),
    discovery_id: tool.schema
      .string()
      .optional()
      .describe("Discovery that spawned this spec"),
    tags: tool.schema.array(tool.schema.string()).optional(),
  },
  async execute(args, ctx): Promise<string> {
    try {
      const now = new Date().toISOString();
      const agentName = (ctx as { agentName?: string }).agentName || "agent";

      // Check if updating existing spec
      if (args.spec_id) {
        // Update existing
        const existing = await loadSpec(args.spec_id);
        if (!existing) {
          throw new SpecError(
            `Spec not found: ${args.spec_id}`,
            "NOT_FOUND",
            { spec_id: args.spec_id },
          );
        }

        // Update fields
        const updated: SpecEntry = {
          ...existing,
          title: args.title,
          purpose: args.purpose,
          requirements: args.requirements.map((r, i) => ({
            id: r.id || `req-${i + 1}`,
            name: r.name,
            type: r.type,
            description: r.description,
            scenarios: r.scenarios,
            tags: r.tags || [],
          })),
          nfr: args.nfr,
          open_questions: args.open_questions || [],
          tags: args.tags || existing.tags,
          updated_at: now,
        };

        await writeSpecFile(updated);
        await storeSpec(updated);

        return JSON.stringify(
          {
            success: true,
            mode: "update",
            spec_id: updated.id,
            bead_id: updated.bead_id,
            file_path: updated.file_path,
            status: updated.status,
            open_questions: updated.open_questions.length,
            next_step:
              updated.open_questions.length > 0
                ? "Resolve open questions or await human clarification"
                : "Run spec_submit() when ready for review",
          },
          null,
          2,
        );
      } else {
        // Create new spec
        const version = 1;
        const specId = generateSpecId(args.capability, version);

        // Create bead for tracking
        const beadResult = await beads_create.execute(
          {
            title: `[SPEC DRAFT] ${args.title}`,
            type: "task",
            description: `Draft specification for ${args.capability}`,
          },
          ctx,
        );
        const bead = JSON.parse(beadResult);

        // Create spec entry
        const spec: SpecEntry = {
          id: specId,
          capability: args.capability,
          version,
          status: "draft",
          title: args.title,
          purpose: args.purpose,
          requirements: args.requirements.map((r, i) => ({
            id: r.id || `req-${i + 1}`,
            name: r.name,
            type: r.type,
            description: r.description,
            scenarios: r.scenarios,
            tags: r.tags || [],
          })),
          nfr: args.nfr,
          dependencies: [],
          bead_id: bead.id,
          discovery_id: args.discovery_id,
          author: agentName,
          created_at: now,
          updated_at: now,
          open_questions: args.open_questions || [],
          tags: args.tags || [],
          file_path: "",
        };

        // Set file path after creating spec
        spec.file_path = getSpecFilePath(spec);

        // Write spec file and store in LanceDB
        await writeSpecFile(spec);
        await storeSpec(spec);

        return JSON.stringify(
          {
            success: true,
            mode: "create",
            spec_id: specId,
            bead_id: bead.id,
            file_path: spec.file_path,
            status: "draft",
            open_questions: spec.open_questions.length,
            next_step:
              spec.open_questions.length > 0
                ? "Await human clarification on open questions"
                : "Run spec_submit() when ready for review",
          },
          null,
          2,
        );
      }
    } catch (error) {
      if (error instanceof SpecError) {
        return JSON.stringify(
          {
            success: false,
            error: error.message,
            code: error.code,
            details: error.details,
          },
          null,
          2,
        );
      }
      return JSON.stringify(
        {
          success: false,
          error: `Failed to write spec: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * spec_submit - Submit a spec for human review
 */
export const spec_submit = tool({
  description:
    "Submit spec for human review. Fails if open questions exist. Updates bead to blocked and sends hivemail to human.",
  args: {
    spec_id: tool.schema.string().describe("Spec ID to submit"),
    summary: tool.schema
      .string()
      .describe("One-line summary for reviewer"),
  },
  async execute(args, ctx): Promise<string> {
    try {
      // Load spec
      const spec = await loadSpec(args.spec_id);
      if (!spec) {
        throw new SpecError(`Spec not found: ${args.spec_id}`, "NOT_FOUND", {
          spec_id: args.spec_id,
        });
      }

      // Enforce no open questions
      if (spec.open_questions && spec.open_questions.length > 0) {
        return JSON.stringify(
          {
            success: false,
            error: "Resolve open questions before submitting",
            open_questions: spec.open_questions,
            hint: "Use spec_write() to update spec and clear questions",
          },
          null,
          2,
        );
      }

      // Check status
      if (spec.status !== "draft") {
        return JSON.stringify(
          {
            success: false,
            error: `Spec is not in draft status: ${spec.status}`,
            hint:
              spec.status === "review"
                ? "Spec is already in review"
                : "Use spec_write() to create a new version if needed",
          },
          null,
          2,
        );
      }

      // Create change proposal
      const changeId = `change-${spec.capability}-${Date.now()}`;
      await createChangeProposal(spec, changeId, args.summary);

      // Update spec status
      spec.status = "review";
      spec.updated_at = new Date().toISOString();
      spec.file_path = join(
        getSpecWorkingDirectory(),
        "openspec",
        "changes",
        changeId,
        "specs",
        spec.capability,
        "spec.md",
      );
      await writeSpecFile(spec);
      await storeSpec(spec);

      // Update bead to blocked
      if (spec.bead_id) {
        await beads_update.execute(
          {
            id: spec.bead_id,
            status: "blocked",
            description: `Awaiting review for spec ${spec.id}`,
          },
          ctx,
        );
      }

      // Send hivemail to human
      await hivemail_send.execute(
        {
          to: ["human"],
          subject: `[REVIEW] ${spec.title}`,
          body: formatReviewEmail(spec, args.summary),
          importance: "high",
        },
        ctx,
      );

      return JSON.stringify(
        {
          success: true,
          spec_id: spec.id,
          change_id: changeId,
          status: "review",
          message:
            "Submitted for review. Use `hivemail_inbox` to check for response.",
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof SpecError) {
        return JSON.stringify(
          {
            success: false,
            error: error.message,
            code: error.code,
            details: error.details,
          },
          null,
          2,
        );
      }
      return JSON.stringify(
        {
          success: false,
          error: `Failed to submit spec: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * spec_implement - Create implementation beads from approved spec
 */
export const spec_implement = tool({
  description:
    "Create implementation beads from an approved spec using beads_create_epic. Only works on approved specs.",
  args: {
    spec_id: tool.schema.string().describe("Approved spec ID to implement"),
  },
  async execute(args, ctx): Promise<string> {
    try {
      // Load spec
      const spec = await loadSpec(args.spec_id);
      if (!spec) {
        throw new SpecError(`Spec not found: ${args.spec_id}`, "NOT_FOUND", {
          spec_id: args.spec_id,
        });
      }

      // Check status
      if (spec.status !== "approved") {
        return JSON.stringify(
          {
            success: false,
            error: `Spec must be approved. Current status: ${spec.status}`,
            hint:
              spec.status === "draft"
                ? "Use spec_submit() to request review first"
                : spec.status === "review"
                  ? "Wait for human approval"
                  : "Spec cannot be implemented in current state",
          },
          null,
          2,
        );
      }

      // Create epic from requirements
      const subtasks = spec.requirements.map((r) => ({
        title: `Implement: ${r.name}`,
        priority: r.type === "shall" || r.type === "must" ? 1 : 2,
      }));

      const epicResult = await beads_create_epic.execute(
        {
          epic_title: `[IMPL] ${spec.title}`,
          epic_description: `Implementation of ${spec.id}\n\n${spec.purpose}`,
          subtasks,
        },
        ctx,
      );
      const epic = JSON.parse(epicResult);

      // Update spec status
      spec.status = "implemented";
      spec.updated_at = new Date().toISOString();
      await storeSpec(spec);

      return JSON.stringify(
        {
          success: true,
          spec_id: spec.id,
          epic_id: epic.epic.id,
          subtask_count: epic.subtasks.length,
          subtasks: epic.subtasks.map((s: { id: string; title: string }) => ({
            id: s.id,
            title: s.title,
          })),
          message: `Created epic with ${epic.subtasks.length} subtasks`,
        },
        null,
        2,
      );
    } catch (error) {
      if (error instanceof SpecError) {
        return JSON.stringify(
          {
            success: false,
            error: error.message,
            code: error.code,
            details: error.details,
          },
          null,
          2,
        );
      }
      return JSON.stringify(
        {
          success: false,
          error: `Failed to implement spec: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * spec_query - Search specs by capability, status, or semantic content
 */
export const spec_query = tool({
  description:
    "Search specifications by capability, status, or semantic content via LanceDB. Supports filter-based and semantic queries.",
  args: {
    capability: tool.schema
      .string()
      .optional()
      .describe("Filter by capability slug"),
    status: tool.schema
      .enum(["draft", "review", "approved", "implemented", "deprecated"])
      .optional()
      .describe("Filter by status"),
    query: tool.schema
      .string()
      .optional()
      .describe("Semantic search query for content"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Filter by tags"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results to return (default: 10)"),
  },
  async execute(args, _ctx): Promise<string> {
    try {
      const storage = getStorage();
      const limit = args.limit || 10;
      let results: DecompositionPattern[] = [];

      // Semantic search if query provided
      if (args.query) {
        results = await storage.findSimilarPatterns(args.query, limit * 2); // Get more for filtering
      } else {
        // Get all patterns and filter
        results = await storage.getAllPatterns();
      }

      // Filter to only specs
      let specs = results.filter((p) => p.kind === "spec");

      // Apply filters
      if (args.capability) {
        specs = specs.filter((p) => p.tags.includes(args.capability!));
      }

      if (args.status) {
        specs = specs.filter((p) => p.tags.includes(args.status!));
      }

      if (args.tags && args.tags.length > 0) {
        specs = specs.filter((p) =>
          args.tags!.some((t) => p.tags.includes(t)),
        );
      }

      // Limit results
      specs = specs.slice(0, limit);

      // Format results
      const formattedResults = specs.map((p) => ({
        id: p.id,
        capability: p.tags.find((t) => !["draft", "review", "approved", "implemented", "deprecated"].includes(t) && !t.startsWith("v")),
        version: p.tags.find((t) => t.startsWith("v")),
        status: p.tags.find((t) =>
          ["draft", "review", "approved", "implemented", "deprecated"].includes(t),
        ),
        purpose: p.reason,
        tags: p.tags.filter(
          (t) =>
            !["draft", "review", "approved", "implemented", "deprecated"].includes(t) &&
            !t.startsWith("v"),
        ),
        bead_id: p.example_beads[0],
        updated_at: p.updated_at,
      }));

      return JSON.stringify(
        {
          success: true,
          count: formattedResults.length,
          specs: formattedResults,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          success: false,
          error: `Failed to query specs: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * spec_quick_write - Create specification with optional auto-approval
 *
 * Combines spec_write + automatic approval in one operation.
 * If auto_approve=true OR confidence >= threshold (default 0.8), auto-approves immediately.
 * Otherwise, behaves like spec_write (creates draft for later review).
 */
export const spec_quick_write = tool({
  description:
    "Create a specification with optional auto-approval. Combines spec_write + automatic approval in one operation. If auto_approve=true OR confidence >= threshold (default 0.8), auto-approves immediately. Otherwise, creates draft for later review.",
  args: {
    // Same args as spec_write
    spec_id: tool.schema
      .string()
      .optional()
      .describe("Existing spec ID to update, or omit to create new"),
    capability: tool.schema
      .string()
      .regex(/^[a-z0-9-]+$/)
      .describe("Capability slug (e.g., 'user-authentication')"),
    title: tool.schema.string().describe("Human-readable title"),
    purpose: tool.schema
      .string()
      .min(20)
      .describe("Why this capability exists (min 20 chars)"),
    requirements: tool.schema
      .array(
        tool.schema.object({
          id: tool.schema.string().optional().describe("Requirement ID"),
          name: tool.schema.string().max(50).describe("Short requirement name"),
          type: tool.schema
            .enum(["shall", "must", "should", "may"])
            .describe("Normative language type"),
          description: tool.schema.string().describe("Full description"),
          scenarios: tool.schema
            .array(
              tool.schema.object({
                name: tool.schema.string(),
                given: tool.schema.string(),
                when: tool.schema.string(),
                then: tool.schema.array(tool.schema.string()),
              }),
            )
            .describe("Test scenarios in Given-When-Then format"),
          tags: tool.schema.array(tool.schema.string()).optional(),
        }),
      )
      .describe("Structured requirements"),
    nfr: tool.schema
      .object({
        performance: tool.schema.string().optional(),
        security: tool.schema.string().optional(),
        scalability: tool.schema.string().optional(),
      })
      .optional()
      .describe("Non-functional requirements"),
    open_questions: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Questions that need human clarification"),
    discovery_id: tool.schema
      .string()
      .optional()
      .describe("Discovery that spawned this spec"),
    tags: tool.schema.array(tool.schema.string()).optional(),

    // Auto-approval specific args
    auto_approve: tool.schema
      .boolean()
      .optional()
      .describe(
        "If true, auto-approve the spec immediately (bypasses human review)",
      ),
    confidence: tool.schema
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Confidence score (0-1). If >= threshold (default 0.8), auto-approves",
      ),
    confidence_threshold: tool.schema
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        "Custom threshold for confidence-based auto-approval (default: 0.8)",
      ),
  },
  async execute(args, ctx): Promise<string> {
    try {
      const now = new Date().toISOString();
      const agentName = (ctx as { agentName?: string }).agentName || "agent";
      const threshold = args.confidence_threshold ?? DEFAULT_AUTO_APPROVE_THRESHOLD;

      // Determine if we should auto-approve
      const willAutoApprove = shouldAutoApprove(
        args.auto_approve,
        args.confidence,
        threshold,
      );

      // Check for open questions - cannot auto-approve with open questions
      if (willAutoApprove && args.open_questions && args.open_questions.length > 0) {
        return JSON.stringify(
          {
            success: false,
            error: "Cannot auto-approve spec with open questions",
            open_questions: args.open_questions,
            hint: "Either resolve open questions or set auto_approve=false",
          },
          null,
          2,
        );
      }

      // Check if updating existing spec
      if (args.spec_id) {
        // Update existing
        const existing = await loadSpec(args.spec_id);
        if (!existing) {
          throw new SpecError(
            `Spec not found: ${args.spec_id}`,
            "NOT_FOUND",
            { spec_id: args.spec_id },
          );
        }

        // Update fields
        const updated: SpecEntry = {
          ...existing,
          title: args.title,
          purpose: args.purpose,
          requirements: args.requirements.map((r, i) => ({
            id: r.id || `req-${i + 1}`,
            name: r.name,
            type: r.type,
            description: r.description,
            scenarios: r.scenarios,
            tags: r.tags || [],
          })),
          nfr: args.nfr,
          open_questions: args.open_questions || [],
          tags: args.tags || existing.tags,
          updated_at: now,
          auto_approve: args.auto_approve,
          confidence: args.confidence,
        };

        await writeSpecFile(updated);
        await storeSpec(updated);

        // Auto-approve if conditions met
        if (willAutoApprove) {
          const approved = await autoApproveSpec(updated.id, ctx);
          return JSON.stringify(
            {
              success: true,
              mode: "update",
              auto_approved: true,
              spec_id: approved.id,
              bead_id: approved.bead_id,
              file_path: approved.file_path,
              status: approved.status,
              approved_by: approved.approved_by,
              approved_at: approved.approved_at,
              confidence: args.confidence,
              threshold,
            },
            null,
            2,
          );
        }

        return JSON.stringify(
          {
            success: true,
            mode: "update",
            auto_approved: false,
            spec_id: updated.id,
            bead_id: updated.bead_id,
            file_path: updated.file_path,
            status: updated.status,
            open_questions: updated.open_questions.length,
            confidence: args.confidence,
            threshold,
            next_step:
              updated.open_questions.length > 0
                ? "Resolve open questions or await human clarification"
                : "Run spec_submit() when ready for review",
          },
          null,
          2,
        );
      } else {
        // Create new spec
        const version = 1;
        const specId = generateSpecId(args.capability, version);

        // Create bead for tracking
        const beadResult = await beads_create.execute(
          {
            title: willAutoApprove
              ? `[SPEC AUTO-APPROVED] ${args.title}`
              : `[SPEC DRAFT] ${args.title}`,
            type: "task",
            description: `Specification for ${args.capability}`,
          },
          ctx,
        );
        const bead = JSON.parse(beadResult);

        // Create spec entry
        const spec: SpecEntry = {
          id: specId,
          capability: args.capability,
          version,
          status: "draft",
          title: args.title,
          purpose: args.purpose,
          requirements: args.requirements.map((r, i) => ({
            id: r.id || `req-${i + 1}`,
            name: r.name,
            type: r.type,
            description: r.description,
            scenarios: r.scenarios,
            tags: r.tags || [],
          })),
          nfr: args.nfr,
          dependencies: [],
          bead_id: bead.id,
          discovery_id: args.discovery_id,
          author: agentName,
          created_at: now,
          updated_at: now,
          open_questions: args.open_questions || [],
          tags: args.tags || [],
          file_path: "",
          auto_approve: args.auto_approve,
          confidence: args.confidence,
        };

        // Set file path after creating spec
        spec.file_path = getSpecFilePath(spec);

        // Write spec file and store in LanceDB
        await writeSpecFile(spec);
        await storeSpec(spec);

        // Auto-approve if conditions met
        if (willAutoApprove) {
          const approved = await autoApproveSpec(specId, ctx);
          return JSON.stringify(
            {
              success: true,
              mode: "create",
              auto_approved: true,
              spec_id: approved.id,
              bead_id: bead.id,
              file_path: approved.file_path,
              status: approved.status,
              approved_by: approved.approved_by,
              approved_at: approved.approved_at,
              confidence: args.confidence,
              threshold,
            },
            null,
            2,
          );
        }

        return JSON.stringify(
          {
            success: true,
            mode: "create",
            auto_approved: false,
            spec_id: specId,
            bead_id: bead.id,
            file_path: spec.file_path,
            status: "draft",
            open_questions: spec.open_questions.length,
            confidence: args.confidence,
            threshold,
            next_step:
              spec.open_questions.length > 0
                ? "Await human clarification on open questions"
                : "Run spec_submit() when ready for review",
          },
          null,
          2,
        );
      }
    } catch (error) {
      if (error instanceof SpecError) {
        return JSON.stringify(
          {
            success: false,
            error: error.message,
            code: error.code,
            details: error.details,
          },
          null,
          2,
        );
      }
      return JSON.stringify(
        {
          success: false,
          error: `Failed to write spec: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

// ============================================================================
// Exports
// ============================================================================

export const specTools = {
  spec_write,
  spec_submit,
  spec_implement,
  spec_query,
  spec_quick_write,
};
