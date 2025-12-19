/**
 * Spec Command - Manage design specifications
 *
 * Provides CLI interface for human review of agent-created specifications.
 * Implements the design-specification-strategy workflow.
 *
 * Commands:
 * - list: List specs with optional status filter
 * - approve: Approve a spec and notify the agent
 * - request-changes: Request changes with required comment
 * - reject: Reject a spec with required reason
 * - search: Semantic search for specs
 * - history: Show spec versions for a capability
 * - clarify: Answer open questions on a spec
 *
 * @see docs/analysis/design-specification-strategy.md
 */

import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { cyan, dim, green, yellow, red } from "../branding.js";
import {
  loadSpec,
  writeSpecFile,
  setSpecWorkingDirectory,
  getSpecWorkingDirectory,
} from "../../spec.js";
import { getStorage } from "../../storage.js";
import { SpecEntrySchema, type SpecEntry, type SpecStatus } from "../../schemas/spec.js";
import {
  sendSwarmMessage,
  initSwarmAgent,
} from "../../streams/hive-mail.js";

// ============================================================================
// Types
// ============================================================================

interface SpecListOptions {
  status?: SpecStatus;
  limit?: number;
}

interface SpecApproveOptions {
  comment?: string;
}

interface SpecRequestChangesOptions {
  comment: string;
}

interface SpecRejectOptions {
  reason: string;
}

interface SpecClarifyOptions {
  question: string;
  answer: string;
}

interface SpecReviewOptions {
  verbose?: boolean;
}

interface SpecApproveAllOptions {
  tag?: string;
  since?: string;
  confidence?: number;
  dryRun?: boolean;
  quiet?: boolean;
}

interface ReviewSummary {
  approved: number;
  rejected: number;
  changesRequested: number;
  skipped: number;
  total: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get all specs from the openspec directory.
 * 
 * Simplified structure:
 * - openspec/specs/{capability}/spec.json - All specs live here regardless of status
 * - Status is tracked in the JSON, not directory location
 */
async function getAllSpecs(): Promise<SpecEntry[]> {
  const baseDir = getSpecWorkingDirectory();
  const specs: SpecEntry[] = [];

  // Primary location: openspec/specs/{capability}/spec.json
  const specsDir = join(baseDir, "openspec", "specs");
  if (existsSync(specsDir)) {
    const capabilityDirs = readdirSync(specsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const capability of capabilityDirs) {
      const jsonPath = join(specsDir, capability, "spec.json");
      if (existsSync(jsonPath)) {
        try {
          const data = readFileSync(jsonPath, "utf-8");
          const spec = SpecEntrySchema.parse(JSON.parse(data));
          specs.push(spec);
        } catch {
          // Skip invalid specs
        }
      }
    }
  }

  // Legacy support: Check drafts directory (migrate these to specs/)
  const draftsDir = join(baseDir, "openspec", "drafts");
  if (existsSync(draftsDir)) {
    const draftDirs = readdirSync(draftsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const draftId of draftDirs) {
      const jsonPath = join(draftsDir, draftId, "spec.json");
      if (existsSync(jsonPath)) {
        try {
          const data = readFileSync(jsonPath, "utf-8");
          const spec = SpecEntrySchema.parse(JSON.parse(data));
          // Only add if not already found in specs/
          if (!specs.some(s => s.id === spec.id)) {
            specs.push(spec);
          }
        } catch {
          // Skip invalid specs
        }
      }
    }
  }

  // Legacy support: Check changes directory (migrate these to specs/)
  const changesDir = join(baseDir, "openspec", "changes");
  if (existsSync(changesDir)) {
    const changeDirs = readdirSync(changesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const changeId of changeDirs) {
      const specsSubdir = join(changesDir, changeId, "specs");
      if (existsSync(specsSubdir)) {
        const capabilityDirs = readdirSync(specsSubdir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);

        for (const capability of capabilityDirs) {
          const jsonPath = join(specsSubdir, capability, "spec.json");
          if (existsSync(jsonPath)) {
            try {
              const data = readFileSync(jsonPath, "utf-8");
              const spec = SpecEntrySchema.parse(JSON.parse(data));
              // Only add if not already found
              if (!specs.some(s => s.id === spec.id)) {
                specs.push(spec);
              }
            } catch {
              // Skip invalid specs
            }
          }
        }
      }
    }
  }

  return specs;
}

/**
 * Find spec by ID across all locations
 */
async function findSpecById(specId: string): Promise<SpecEntry | null> {
  // Try loading from LanceDB first
  const spec = await loadSpec(specId);
  if (spec) {
    return spec;
  }

  // Fallback to scanning directories
  const specs = await getAllSpecs();
  return specs.find((s) => s.id === specId) || null;
}

/**
 * Find all locations of a spec by ID (for cleanup of legacy locations)
 */
function findSpecLocations(specId: string, capability: string): string[] {
  const baseDir = getSpecWorkingDirectory();
  const locations: string[] = [];
  
  // Check primary location: specs/{capability}
  const specsPath = join(baseDir, "openspec", "specs", capability, "spec.json");
  if (existsSync(specsPath)) {
    locations.push(dirname(specsPath));
  }
  
  // Check legacy drafts directory
  const draftPath = join(baseDir, "openspec", "drafts", specId, "spec.json");
  if (existsSync(draftPath)) {
    locations.push(dirname(draftPath));
  }
  
  // Check legacy changes directory
  const changesDir = join(baseDir, "openspec", "changes");
  if (existsSync(changesDir)) {
    const changeDirs = readdirSync(changesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const changeId of changeDirs) {
      const testPath = join(changesDir, changeId, "specs", capability, "spec.json");
      if (existsSync(testPath)) {
        locations.push(dirname(testPath));
      }
    }
  }
  
  return locations;
}

/**
 * Save spec JSON to canonical location: openspec/specs/{capability}/
 * 
 * Simplified approach:
 * - All specs live in specs/{capability}/ regardless of status
 * - Status is tracked in the JSON file itself
 * - Cleans up any legacy locations (drafts/, changes/)
 */
async function saveSpec(spec: SpecEntry): Promise<void> {
  const baseDir = getSpecWorkingDirectory();
  
  // Find all existing locations before saving
  const existingLocations = findSpecLocations(spec.id, spec.capability);
  
  // Canonical location: openspec/specs/{capability}/
  const newDir = join(baseDir, "openspec", "specs", spec.capability);
  
  // Ensure directory exists
  if (!existsSync(newDir)) {
    mkdirSync(newDir, { recursive: true });
  }
  
  const jsonPath = join(newDir, "spec.json");

  // Write JSON
  writeFileSync(jsonPath, JSON.stringify(spec, null, 2), "utf-8");

  // Write markdown
  spec.file_path = join(newDir, "spec.md");
  await writeSpecFile(spec);
  
  // Clean up any legacy locations that aren't the canonical location
  for (const location of existingLocations) {
    if (location !== newDir) {
      try {
        rmSync(location, { recursive: true, force: true });
      } catch {
        // Ignore errors deleting old location
      }
    }
  }
}

/**
 * Initialize hivemail for sending notifications
 */
async function initHivemail(): Promise<{ projectPath: string; agentName: string }> {
  const projectPath = getSpecWorkingDirectory();
  const result = await initSwarmAgent({
    projectPath,
    agentName: "human-cli",
    taskDescription: "Spec review via CLI",
  });
  return { projectPath: result.projectKey, agentName: result.agentName };
}

/**
 * Send notification to agent via hivemail
 */
async function notifyAgent(
  to: string,
  subject: string,
  body: string,
  importance: "low" | "normal" | "high" | "urgent" = "high",
  ackRequired: boolean = false,
): Promise<void> {
  const { projectPath, agentName } = await initHivemail();

  await sendSwarmMessage({
    projectPath,
    fromAgent: agentName,
    toAgents: [to],
    subject,
    body,
    importance,
    ackRequired,
  });
}

/**
 * Execute bd command for bead operations
 */
async function runBdCommand(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { executeCommand } = await import("../../utils/cli-executor.js");
  const cwd = getSpecWorkingDirectory();
  return executeCommand(["bd", ...args], { cwd });
}

/**
 * Update bead status
 */
async function updateBeadStatus(beadId: string, status: string, description?: string): Promise<void> {
  const cmd = ["update", beadId, "--status", status];
  if (description) {
    cmd.push("-d", description);
  }
  cmd.push("--json");

  const result = await runBdCommand(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to update bead ${beadId}: ${result.stderr}`);
  }
}

/**
 * Close a bead
 */
async function closeBead(beadId: string, reason: string): Promise<void> {
  const cmd = ["close", beadId, "--reason", reason, "--json"];
  const result = await runBdCommand(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to close bead ${beadId}: ${result.stderr}`);
  }
}

/**
 * Format status with color
 */
function formatStatus(status: SpecStatus): string {
  switch (status) {
    case "draft":
      return dim(status);
    case "review":
      return yellow(status);
    case "approved":
      return green(status);
    case "implemented":
      return cyan(status);
    case "deprecated":
      return red(status);
    default:
      return status;
  }
}

// ============================================================================
// Commands
// ============================================================================

/**
 * List specs with optional status filter
 */
export async function specListCommand(options: SpecListOptions = {}): Promise<void> {
  p.intro(cyan("hive spec list"));

  setSpecWorkingDirectory(process.cwd());

  const s = p.spinner();
  s.start("Loading specifications...");

  const specs = await getAllSpecs();

  s.stop("Specifications loaded");

  // Apply status filter
  let filtered = specs;
  if (options.status) {
    filtered = specs.filter((s) => s.status === options.status);
  }

  // Apply limit
  if (options.limit && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  if (filtered.length === 0) {
    p.log.info(options.status ? `No specs with status '${options.status}'` : "No specs found");
    p.outro("Use spec_write tool to create specifications");
    return;
  }

  // Display specs in compact table format
  p.log.step(`Found ${filtered.length} specification(s):\n`);

  for (const spec of filtered) {
    const statusStr = formatStatus(spec.status);
    const reqCount = spec.requirements.length;
    const questionsCount = spec.open_questions?.length || 0;
    const updated = new Date(spec.updated_at).toLocaleDateString();

    // Compact single-line format with details on second line
    console.log(`  ${cyan(spec.id)}`);
    console.log(`    ${spec.title} ${dim(`(${statusStr}, v${spec.version}, ${reqCount} reqs${questionsCount > 0 ? `, ${yellow(questionsCount + " questions")}` : ""}${spec.bead_id ? `, ${dim(spec.bead_id)}` : ""})`)}`);
    console.log(`    ${dim(`by ${spec.author} • ${updated}`)}`);
  }

  console.log();
  p.outro(`Total: ${filtered.length} spec(s)`);
}

/**
 * Approve a spec
 */
export async function specApproveCommand(specId: string, options: SpecApproveOptions = {}): Promise<void> {
  p.intro(cyan("hive spec approve"));

  setSpecWorkingDirectory(process.cwd());

  const s = p.spinner();
  s.start(`Loading spec ${specId}...`);

  const spec = await findSpecById(specId);

  if (!spec) {
    s.stop("Spec not found");
    p.log.error(`Spec ${specId} not found`);
    p.outro("Use 'hive spec list' to see available specs");
    process.exit(1);
  }

  if (spec.status !== "review") {
    s.stop("Invalid status");
    p.log.error(`Spec ${specId} is not in review status (current: ${spec.status})`);
    p.outro(spec.status === "draft" ? "Spec must be submitted for review first" : "Spec has already been processed");
    process.exit(1);
  }

  s.stop("Spec loaded");

  // Show spec summary
  p.log.info(`Approving: ${spec.title}`);
  p.log.message(`  Author: ${spec.author}`);
  p.log.message(`  Requirements: ${spec.requirements.length}`);

  // Confirm approval
  const confirm = await p.confirm({
    message: "Approve this specification?",
    initialValue: true,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Approval cancelled");
    return;
  }

  const s2 = p.spinner();
  s2.start("Approving spec...");

  try {
    // 1. Update spec status
    spec.status = "approved";
    spec.approved_at = new Date().toISOString();
    spec.approved_by = process.env.USER || "human";
    spec.updated_at = new Date().toISOString();

    // 2. Save spec to approved location
    await saveSpec(spec);

    // 3. Update bead to unblock
    if (spec.bead_id) {
      try {
        await updateBeadStatus(spec.bead_id, "open", "Spec approved. Ready for implementation.");
      } catch (beadError) {
        p.log.warn(`Could not update bead: ${beadError instanceof Error ? beadError.message : String(beadError)}`);
      }
    }

    // 4. Notify agent via hivemail
    try {
      const comment = options.comment || "No additional comments";
      await notifyAgent(
        spec.author,
        `[APPROVED] Spec: ${spec.title}`,
        `Your specification has been approved!\n\n` +
          `**Spec ID**: ${spec.id}\n` +
          `**Version**: v${spec.version}\n` +
          `**Comment**: ${comment}\n\n` +
          `Next step: Run spec_implement() to create implementation beads.`,
        "high",
        false,
      );
    } catch (mailError) {
      p.log.warn(`Could not send notification: ${mailError instanceof Error ? mailError.message : String(mailError)}`);
    }

    s2.stop("Spec approved");

    p.log.success(`Approved ${specId}`);
    if (options.comment) {
      p.log.message(`  Comment: ${options.comment}`);
    }

    p.outro("Agent has been notified via hivemail");
  } catch (error) {
    s2.stop("Failed to approve");
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Request changes on a spec
 */
export async function specRequestChangesCommand(specId: string, options: SpecRequestChangesOptions): Promise<void> {
  p.intro(cyan("hive spec request-changes"));

  if (!options.comment) {
    p.log.error("--comment is required when requesting changes");
    p.outro("Usage: hive spec request-changes <spec-id> --comment 'feedback'");
    process.exit(1);
  }

  setSpecWorkingDirectory(process.cwd());

  const s = p.spinner();
  s.start(`Loading spec ${specId}...`);

  const spec = await findSpecById(specId);

  if (!spec) {
    s.stop("Spec not found");
    p.log.error(`Spec ${specId} not found`);
    p.outro("Use 'hive spec list' to see available specs");
    process.exit(1);
  }

  if (spec.status !== "review" && spec.status !== "draft") {
    s.stop("Invalid status");
    p.log.error(`Cannot request changes on spec with status: ${spec.status}`);
    process.exit(1);
  }

  s.stop("Spec loaded");

  // Show feedback preview
  p.log.info(`Requesting changes on: ${spec.title}`);
  p.log.message(`  Feedback: ${options.comment}`);

  const s2 = p.spinner();
  s2.start("Sending feedback...");

  try {
    // Keep spec in review status, just notify agent
    await notifyAgent(
      spec.author,
      `[CHANGES REQUESTED] Spec: ${spec.title}`,
      `Please update the specification based on the following feedback:\n\n` +
        `**Spec ID**: ${spec.id}\n` +
        `**Feedback**: ${options.comment}\n\n` +
        `Use spec_write() to update the spec and address the feedback.`,
      "high",
      true,
    );

    s2.stop("Feedback sent");

    p.log.success(`Changes requested for ${specId}`);

    p.outro("Agent has been notified via hivemail (ack required)");
  } catch (error) {
    s2.stop("Failed to send");
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Reject a spec
 */
export async function specRejectCommand(specId: string, options: SpecRejectOptions): Promise<void> {
  p.intro(cyan("hive spec reject"));

  if (!options.reason) {
    p.log.error("--reason is required when rejecting a spec");
    p.outro("Usage: hive spec reject <spec-id> --reason 'rejection reason'");
    process.exit(1);
  }

  setSpecWorkingDirectory(process.cwd());

  const s = p.spinner();
  s.start(`Loading spec ${specId}...`);

  const spec = await findSpecById(specId);

  if (!spec) {
    s.stop("Spec not found");
    p.log.error(`Spec ${specId} not found`);
    p.outro("Use 'hive spec list' to see available specs");
    process.exit(1);
  }

  s.stop("Spec loaded");

  // Show rejection preview
  p.log.warn(`Rejecting: ${spec.title}`);
  p.log.message(`  Reason: ${options.reason}`);

  // Confirm rejection
  const confirm = await p.confirm({
    message: "Are you sure you want to reject this spec?",
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.outro("Rejection cancelled");
    return;
  }

  const s2 = p.spinner();
  s2.start("Rejecting spec...");

  try {
    // 1. Update spec status to deprecated
    spec.status = "deprecated";
    spec.updated_at = new Date().toISOString();
    await saveSpec(spec);

    // 2. Close the bead
    if (spec.bead_id) {
      try {
        await closeBead(spec.bead_id, `Spec rejected: ${options.reason}`);
      } catch (beadError) {
        p.log.warn(`Could not close bead: ${beadError instanceof Error ? beadError.message : String(beadError)}`);
      }
    }

    // 3. Notify agent
    try {
      await notifyAgent(
        spec.author,
        `[REJECTED] Spec: ${spec.title}`,
        `The specification has been rejected.\n\n` +
          `**Spec ID**: ${spec.id}\n` +
          `**Reason**: ${options.reason}\n\n` +
          `If you believe this decision should be reconsidered, please discuss with the team.`,
        "normal",
        false,
      );
    } catch (mailError) {
      p.log.warn(`Could not send notification: ${mailError instanceof Error ? mailError.message : String(mailError)}`);
    }

    s2.stop("Spec rejected");

    p.log.success(`Rejected ${specId}`);

    p.outro("Agent has been notified");
  } catch (error) {
    s2.stop("Failed to reject");
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Semantic search for specs
 */
export async function specSearchCommand(query: string): Promise<void> {
  p.intro(cyan("hive spec search"));

  if (!query || query.trim().length === 0) {
    p.log.error("Search query is required");
    p.outro("Usage: hive spec search 'query'");
    process.exit(1);
  }

  setSpecWorkingDirectory(process.cwd());

  const s = p.spinner();
  s.start(`Searching for "${query}"...`);

  try {
    const storage = getStorage();
    const patterns = await storage.findSimilarPatterns(query, 20);

    // Filter to only specs
    const specs = patterns.filter((p) => p.kind === "spec");

    s.stop("Search complete");

    if (specs.length === 0) {
      p.log.info(`No specs found matching "${query}"`);
      p.outro("Try a different search term");
      return;
    }

    p.log.step(`Found ${specs.length} matching spec(s):`);

    for (const pattern of specs) {
      const statusTag = pattern.tags.find((t) =>
        ["draft", "review", "approved", "implemented", "deprecated"].includes(t),
      );
      const versionTag = pattern.tags.find((t) => t.startsWith("v"));

      console.log();
      p.log.message(`${cyan(pattern.id)}`);
      p.log.message(`  Status: ${statusTag ? formatStatus(statusTag as SpecStatus) : dim("unknown")}`);
      if (versionTag) {
        p.log.message(`  Version: ${versionTag}`);
      }
      p.log.message(`  Purpose: ${dim(pattern.reason?.slice(0, 80) || "No purpose")}`);
    }

    p.outro(`Found ${specs.length} spec(s)`);
  } catch (error) {
    s.stop("Search failed");
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Show spec version history for a capability
 */
export async function specHistoryCommand(capability: string): Promise<void> {
  p.intro(cyan("hive spec history"));

  if (!capability || capability.trim().length === 0) {
    p.log.error("Capability name is required");
    p.outro("Usage: hive spec history <capability>");
    process.exit(1);
  }

  setSpecWorkingDirectory(process.cwd());

  const s = p.spinner();
  s.start(`Loading history for "${capability}"...`);

  const allSpecs = await getAllSpecs();
  const capabilitySpecs = allSpecs
    .filter((s) => s.capability === capability)
    .sort((a, b) => b.version - a.version);

  s.stop("History loaded");

  if (capabilitySpecs.length === 0) {
    p.log.info(`No specs found for capability "${capability}"`);

    // Show available capabilities
    const capabilities = [...new Set(allSpecs.map((s) => s.capability))];
    if (capabilities.length > 0) {
      p.log.message(dim(`Available capabilities: ${capabilities.join(", ")}`));
    }

    p.outro("Check the capability name and try again");
    return;
  }

  p.log.step(`Version history for ${cyan(capability)}:`);

  console.log();
  console.log("| Version | Status | Author | Date |");
  console.log("|---------|--------|--------|------|");

  for (const spec of capabilitySpecs) {
    const date = spec.updated_at.split("T")[0];
    console.log(`| v${spec.version} | ${spec.status} | ${spec.author} | ${date} |`);
  }

  p.outro(`${capabilitySpecs.length} version(s) found`);
}

/**
 * Clarify a spec by answering an open question
 */
export async function specClarifyCommand(specId: string, options: SpecClarifyOptions): Promise<void> {
  p.intro(cyan("hive spec clarify"));

  if (!options.question || !options.answer) {
    p.log.error("Both --question and --answer are required");
    p.outro("Usage: hive spec clarify <spec-id> --question 'Q' --answer 'A'");
    process.exit(1);
  }

  setSpecWorkingDirectory(process.cwd());

  const s = p.spinner();
  s.start(`Loading spec ${specId}...`);

  const spec = await findSpecById(specId);

  if (!spec) {
    s.stop("Spec not found");
    p.log.error(`Spec ${specId} not found`);
    p.outro("Use 'hive spec list' to see available specs");
    process.exit(1);
  }

  s.stop("Spec loaded");

  // Show clarification preview
  p.log.info(`Clarifying: ${spec.title}`);
  p.log.message(`  Question: ${options.question}`);
  p.log.message(`  Answer: ${options.answer}`);

  const s2 = p.spinner();
  s2.start("Sending clarification...");

  try {
    // Remove the question from open_questions if it matches
    if (spec.open_questions && spec.open_questions.length > 0) {
      const normalizedQuestion = options.question.toLowerCase().trim();
      spec.open_questions = spec.open_questions.filter(
        (q) => !q.toLowerCase().trim().includes(normalizedQuestion) &&
               !normalizedQuestion.includes(q.toLowerCase().trim())
      );
      spec.updated_at = new Date().toISOString();
      await saveSpec(spec);
    }

    // Notify agent with clarification
    await notifyAgent(
      spec.author,
      `[CLARIFICATION] Spec: ${spec.title}`,
      `A clarification has been provided for your specification:\n\n` +
        `**Spec ID**: ${spec.id}\n` +
        `**Question**: ${options.question}\n` +
        `**Answer**: ${options.answer}\n\n` +
        `Please update the spec accordingly using spec_write().`,
      "high",
      true,
    );

    s2.stop("Clarification sent");

    p.log.success(`Clarification sent for ${specId}`);
    if (spec.open_questions && spec.open_questions.length > 0) {
      p.log.message(dim(`Remaining open questions: ${spec.open_questions.length}`));
    }

    p.outro("Agent has been notified via hivemail (ack required)");
  } catch (error) {
    s2.stop("Failed to send");
    p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Display a spec in formatted detail for review (compact format)
 */
function displaySpecForReview(spec: SpecEntry, index: number, total: number): void {
  console.log();
  console.log(dim("─".repeat(60)));
  console.log(`  ${cyan(`[${index + 1}/${total}]`)} ${spec.title}`);
  console.log(dim("─".repeat(60)));
  
  // Metadata in compact 2-column layout
  const created = new Date(spec.created_at).toLocaleDateString();
  const confidence = spec.confidence !== undefined ? `${spec.confidence}%` : "";
  const tags = spec.tags?.length ? spec.tags.join(", ") : "";
  
  console.log(`  ${dim("ID:")} ${spec.id}  ${dim("Capability:")} ${spec.capability}  ${dim("Version:")} v${spec.version}`);
  console.log(`  ${dim("Author:")} ${spec.author}  ${dim("Status:")} ${formatStatus(spec.status)}  ${dim("Created:")} ${created}${confidence ? `  ${dim("Confidence:")} ${confidence}` : ""}`);
  if (tags) console.log(`  ${dim("Tags:")} ${tags}`);
  
  // Purpose (single line if short, wrapped if long)
  console.log();
  console.log(`  ${dim("Purpose:")} ${spec.purpose.length <= 80 ? spec.purpose : ""}`);
  if (spec.purpose.length > 80) {
    console.log(`    ${spec.purpose}`);
  }
  
  // Requirements (compact list)
  console.log();
  console.log(`  ${dim("Requirements:")} (${spec.requirements.length})`);
  for (const req of spec.requirements.slice(0, 5)) {
    console.log(`    • ${req.description.slice(0, 70)}${req.description.length > 70 ? "..." : ""}`);
  }
  if (spec.requirements.length > 5) {
    console.log(dim(`    ... and ${spec.requirements.length - 5} more`));
  }
  
  // Open questions (if any)
  if (spec.open_questions && spec.open_questions.length > 0) {
    console.log();
    console.log(`  ${yellow("Open Questions:")} (${spec.open_questions.length})`);
    for (const q of spec.open_questions) {
      console.log(`    ${yellow("?")} ${q}`);
    }
  }
  
  console.log();
}

/**
 * Interactive review of specs one-by-one
 */
export async function specReviewCommand(options: SpecReviewOptions = {}): Promise<void> {
  p.intro(cyan("hive spec review"));
  
  setSpecWorkingDirectory(process.cwd());
  
  const s = p.spinner();
  s.start("Loading specs pending review...");
  
  const allSpecs = await getAllSpecs();
  const reviewSpecs = allSpecs.filter((spec) => spec.status === "review");
  
  s.stop(`Found ${reviewSpecs.length} spec(s) pending review`);
  
  if (reviewSpecs.length === 0) {
    p.log.info("No specs pending review");
    p.outro("All caught up!");
    return;
  }
  
  // Sort by created date (oldest first)
  reviewSpecs.sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  
  const summary: ReviewSummary = {
    approved: 0,
    rejected: 0,
    changesRequested: 0,
    skipped: 0,
    total: reviewSpecs.length,
  };
  
  console.log();
  p.log.step(`Starting interactive review of ${reviewSpecs.length} spec(s)`);
  p.log.message(dim("Actions: [a]pprove  [r]eject  [c]hanges  [s]kip  [q]uit"));
  
  for (let i = 0; i < reviewSpecs.length; i++) {
    const spec = reviewSpecs[i];
    
    displaySpecForReview(spec, i, reviewSpecs.length);
    
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "approve", label: "[a] Approve", hint: "Approve this spec for implementation" },
        { value: "reject", label: "[r] Reject", hint: "Reject this spec (requires reason)" },
        { value: "changes", label: "[c] Request Changes", hint: "Request changes (requires feedback)" },
        { value: "skip", label: "[s] Skip", hint: "Skip and move to next spec" },
        { value: "quit", label: "[q] Quit", hint: "Exit review session" },
      ],
    });
    
    if (p.isCancel(action) || action === "quit") {
      p.log.warn("Review session ended early");
      break;
    }
    
    if (action === "skip") {
      summary.skipped++;
      p.log.info(`Skipped ${spec.id}`);
      continue;
    }
    
    if (action === "approve") {
      const comment = await p.text({
        message: "Optional approval comment:",
        placeholder: "Press enter to skip",
      });
      
      if (p.isCancel(comment)) continue;
      
      const s2 = p.spinner();
      s2.start("Approving...");
      
      try {
        spec.status = "approved";
        spec.approved_at = new Date().toISOString();
        spec.approved_by = process.env.USER || "human";
        spec.updated_at = new Date().toISOString();
        await saveSpec(spec);
        
        if (spec.bead_id) {
          try {
            await updateBeadStatus(spec.bead_id, "open", "Spec approved. Ready for implementation.");
          } catch { /* ignore bead errors */ }
        }
        
        try {
          await notifyAgent(
            spec.author,
            `[APPROVED] Spec: ${spec.title}`,
            `Your specification has been approved!\n\n` +
              `**Spec ID**: ${spec.id}\n` +
              `**Comment**: ${comment || "No additional comments"}\n\n` +
              `Next step: Run spec_implement() to create implementation beads.`,
            "high",
            false,
          );
        } catch { /* ignore mail errors */ }
        
        s2.stop(green("✓") + ` Approved ${spec.id}`);
        summary.approved++;
      } catch (error) {
        s2.stop(red("✗") + " Failed to approve");
        p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    
    if (action === "reject") {
      const reason = await p.text({
        message: "Rejection reason (required):",
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "Reason is required";
          }
        },
      });
      
      if (p.isCancel(reason) || !reason) continue;
      
      const s2 = p.spinner();
      s2.start("Rejecting...");
      
      try {
        spec.status = "deprecated";
        spec.updated_at = new Date().toISOString();
        await saveSpec(spec);
        
        if (spec.bead_id) {
          try {
            await closeBead(spec.bead_id, `Spec rejected: ${reason}`);
          } catch { /* ignore bead errors */ }
        }
        
        try {
          await notifyAgent(
            spec.author,
            `[REJECTED] Spec: ${spec.title}`,
            `The specification has been rejected.\n\n` +
              `**Spec ID**: ${spec.id}\n` +
              `**Reason**: ${reason}`,
            "normal",
            false,
          );
        } catch { /* ignore mail errors */ }
        
        s2.stop(red("✓") + ` Rejected ${spec.id}`);
        summary.rejected++;
      } catch (error) {
        s2.stop(red("✗") + " Failed to reject");
        p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
    
    if (action === "changes") {
      const feedback = await p.text({
        message: "What changes are needed? (required):",
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return "Feedback is required";
          }
        },
      });
      
      if (p.isCancel(feedback) || !feedback) continue;
      
      const s2 = p.spinner();
      s2.start("Requesting changes...");
      
      try {
        await notifyAgent(
          spec.author,
          `[CHANGES REQUESTED] Spec: ${spec.title}`,
          `Please update the specification based on the following feedback:\n\n` +
            `**Spec ID**: ${spec.id}\n` +
            `**Feedback**: ${feedback}\n\n` +
            `Use spec_write() to update the spec and address the feedback.`,
          "high",
          true,
        );
        
        s2.stop(yellow("✓") + ` Requested changes on ${spec.id}`);
        summary.changesRequested++;
      } catch (error) {
        s2.stop(red("✗") + " Failed to send");
        p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }
  }
  
  // Show summary (compact format)
  console.log();
  console.log(dim("─".repeat(60)));
  console.log(`  Review Summary: ${green(summary.approved + " approved")}  ${red(summary.rejected + " rejected")}  ${yellow(summary.changesRequested + " changes")}  ${dim(summary.skipped + " skipped")}`);
  console.log(dim("─".repeat(60)));
  
  const processed = summary.approved + summary.rejected + summary.changesRequested;
  const remaining = summary.total - processed - summary.skipped;
  
  if (remaining > 0) {
    p.outro(`${processed} processed, ${remaining} remaining`);
  } else {
    p.outro(`All ${summary.total} specs reviewed`);
  }
}

/**
 * Batch approve specs with filters
 */
export async function specApproveAllCommand(options: SpecApproveAllOptions = {}): Promise<void> {
  p.intro(cyan("hive spec approve-all"));
  
  setSpecWorkingDirectory(process.cwd());
  
  const s = p.spinner();
  s.start("Loading specs pending review...");
  
  const allSpecs = await getAllSpecs();
  let reviewSpecs = allSpecs.filter((spec) => spec.status === "review");
  
  // Apply filters
  if (options.tag) {
    reviewSpecs = reviewSpecs.filter((spec) => 
      spec.tags && spec.tags.some((t) => t.toLowerCase() === options.tag!.toLowerCase())
    );
  }
  
  if (options.since) {
    const sinceDate = new Date(options.since);
    if (isNaN(sinceDate.getTime())) {
      s.stop("Invalid date format");
      p.log.error(`Invalid date: ${options.since}`);
      p.outro("Use ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss");
      process.exit(1);
    }
    reviewSpecs = reviewSpecs.filter((spec) => 
      new Date(spec.created_at) >= sinceDate
    );
  }
  
  if (options.confidence !== undefined) {
    reviewSpecs = reviewSpecs.filter((spec) => 
      spec.confidence !== undefined && spec.confidence >= options.confidence!
    );
  }
  
  s.stop(`Found ${reviewSpecs.length} spec(s) matching filters`);
  
  if (reviewSpecs.length === 0) {
    p.log.info("No specs match the specified filters");
    
    // Show filter info
    if (options.tag) p.log.message(dim(`  --tag: ${options.tag}`));
    if (options.since) p.log.message(dim(`  --since: ${options.since}`));
    if (options.confidence !== undefined) p.log.message(dim(`  --confidence: >= ${options.confidence}`));
    
    p.outro("Try different filters or use 'hive spec list --status review' to see all");
    return;
  }
  
  // Show what will be approved
  if (!options.quiet) {
    p.log.step(`Specs to be approved (${reviewSpecs.length}):`);
    for (const spec of reviewSpecs) {
      const confidence = spec.confidence !== undefined ? ` (${spec.confidence}%)` : "";
      p.log.message(`  • ${cyan(spec.id)}: ${spec.title}${confidence}`);
    }
    console.log();
  }
  
  // Dry run mode
  if (options.dryRun) {
    p.log.info("Dry run - no changes made");
    p.outro(`Would approve ${reviewSpecs.length} spec(s)`);
    return;
  }
  
  // Require confirmation
  const confirm = await p.confirm({
    message: `Approve all ${reviewSpecs.length} spec(s)?`,
    initialValue: false,
  });
  
  if (p.isCancel(confirm) || !confirm) {
    p.outro("Batch approval cancelled");
    return;
  }
  
  // Process approvals
  const s2 = p.spinner();
  let approved = 0;
  let failed = 0;
  
  for (let i = 0; i < reviewSpecs.length; i++) {
    const spec = reviewSpecs[i];
    s2.start(`Approving ${i + 1}/${reviewSpecs.length}: ${spec.id}...`);
    
    try {
      spec.status = "approved";
      spec.approved_at = new Date().toISOString();
      spec.approved_by = process.env.USER || "human";
      spec.updated_at = new Date().toISOString();
      await saveSpec(spec);
      
      if (spec.bead_id) {
        try {
          await updateBeadStatus(spec.bead_id, "open", "Spec approved (batch). Ready for implementation.");
        } catch { /* ignore bead errors */ }
      }
      
      try {
        await notifyAgent(
          spec.author,
          `[APPROVED] Spec: ${spec.title}`,
          `Your specification has been approved (batch approval).\n\n` +
            `**Spec ID**: ${spec.id}\n\n` +
            `Next step: Run spec_implement() to create implementation beads.`,
          "normal",
          false,
        );
      } catch { /* ignore mail errors */ }
      
      approved++;
      if (!options.quiet) {
        s2.stop(green("✓") + ` Approved ${spec.id}`);
        if (i < reviewSpecs.length - 1) {
          s2.start(`Processing...`);
        }
      }
    } catch (error) {
      failed++;
      if (!options.quiet) {
        s2.stop(red("✗") + ` Failed: ${spec.id}`);
        p.log.error(`  ${error instanceof Error ? error.message : String(error)}`);
        if (i < reviewSpecs.length - 1) {
          s2.start(`Processing...`);
        }
      }
    }
  }
  
  s2.stop("Done");
  
  // Summary
  console.log();
  p.log.success(`Approved: ${approved}`);
  if (failed > 0) {
    p.log.error(`Failed: ${failed}`);
  }
  
  p.outro(`Batch approval complete`);
}

// ============================================================================
// Main CLI Entry Point
// ============================================================================

/**
 * CLI entry point with argument parsing
 */
export async function main(args: string[] = []): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "list": {
      const options: SpecListOptions = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === "--status" || arg === "-s") {
          const status = subArgs[++i] as SpecStatus;
          if (!["draft", "review", "approved", "implemented", "deprecated"].includes(status)) {
            console.error(`Invalid status: ${status}`);
            process.exit(1);
          }
          options.status = status;
        } else if (arg === "--limit" || arg === "-l") {
          options.limit = parseInt(subArgs[++i], 10);
        }
      }
      await specListCommand(options);
      break;
    }

    case "approve": {
      const specId = subArgs[0];
      if (!specId) {
        console.error("Spec ID is required");
        console.error("Usage: hive spec approve <spec-id> [--comment 'comment']");
        process.exit(1);
      }
      const options: SpecApproveOptions = {};
      for (let i = 1; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === "--comment" || arg === "-c") {
          options.comment = subArgs[++i];
        }
      }
      await specApproveCommand(specId, options);
      break;
    }

    case "request-changes": {
      const specId = subArgs[0];
      if (!specId) {
        console.error("Spec ID is required");
        console.error("Usage: hive spec request-changes <spec-id> --comment 'feedback'");
        process.exit(1);
      }
      let comment = "";
      for (let i = 1; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === "--comment" || arg === "-c") {
          comment = subArgs[++i];
        }
      }
      if (!comment) {
        console.error("--comment is required");
        process.exit(1);
      }
      await specRequestChangesCommand(specId, { comment });
      break;
    }

    case "reject": {
      const specId = subArgs[0];
      if (!specId) {
        console.error("Spec ID is required");
        console.error("Usage: hive spec reject <spec-id> --reason 'reason'");
        process.exit(1);
      }
      let reason = "";
      for (let i = 1; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === "--reason" || arg === "-r") {
          reason = subArgs[++i];
        }
      }
      if (!reason) {
        console.error("--reason is required");
        process.exit(1);
      }
      await specRejectCommand(specId, { reason });
      break;
    }

    case "search": {
      const query = subArgs.join(" ");
      if (!query) {
        console.error("Search query is required");
        console.error("Usage: hive spec search <query>");
        process.exit(1);
      }
      await specSearchCommand(query);
      break;
    }

    case "history": {
      const capability = subArgs[0];
      if (!capability) {
        console.error("Capability name is required");
        console.error("Usage: hive spec history <capability>");
        process.exit(1);
      }
      await specHistoryCommand(capability);
      break;
    }

    case "clarify": {
      const specId = subArgs[0];
      if (!specId) {
        console.error("Spec ID is required");
        console.error("Usage: hive spec clarify <spec-id> --question 'Q' --answer 'A'");
        process.exit(1);
      }
      let question = "";
      let answer = "";
      for (let i = 1; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === "--question" || arg === "-q") {
          question = subArgs[++i];
        } else if (arg === "--answer" || arg === "-a") {
          answer = subArgs[++i];
        }
      }
      if (!question || !answer) {
        console.error("Both --question and --answer are required");
        process.exit(1);
      }
      await specClarifyCommand(specId, { question, answer });
      break;
    }

    case "review": {
      const options: SpecReviewOptions = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === "--verbose" || arg === "-v") {
          options.verbose = true;
        }
      }
      await specReviewCommand(options);
      break;
    }

    case "approve-all": {
      const options: SpecApproveAllOptions = {};
      for (let i = 0; i < subArgs.length; i++) {
        const arg = subArgs[i];
        if (arg === "--tag" || arg === "-t") {
          options.tag = subArgs[++i];
        } else if (arg === "--since") {
          options.since = subArgs[++i];
        } else if (arg === "--confidence") {
          options.confidence = parseInt(subArgs[++i], 10);
          if (isNaN(options.confidence) || options.confidence < 0 || options.confidence > 100) {
            console.error("Confidence must be a number between 0 and 100");
            process.exit(1);
          }
        } else if (arg === "--dry-run") {
          options.dryRun = true;
        } else if (arg === "--quiet" || arg === "-q") {
          options.quiet = true;
        }
      }
      await specApproveAllCommand(options);
      break;
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  console.log(`
Usage: hive spec <command> [options]

Manage design specifications for human-agent collaboration.

Commands:
  list                          List all specifications
    --status, -s <status>       Filter by status (draft|review|approved|implemented|deprecated)
    --limit, -l <n>             Maximum specs to show

  review                        Interactive review of pending specs
    --verbose, -v               Show additional details

  approve <spec-id>             Approve a specification
    --comment, -c <comment>     Optional approval comment

  approve-all                   Batch approve specs with filters
    --tag, -t <tag>             Only specs with this tag
    --since <date>              Only specs created after date (ISO format)
    --confidence <n>            Only specs with confidence >= n (0-100)
    --dry-run                   Show what would be approved without doing it
    --quiet, -q                 Minimal output

  request-changes <spec-id>     Request changes on a spec
    --comment, -c <comment>     Required feedback (what needs to change)

  reject <spec-id>              Reject a specification
    --reason, -r <reason>       Required rejection reason

  search <query>                Semantic search for specifications

  history <capability>          Show version history for a capability

  clarify <spec-id>             Provide clarification for open questions
    --question, -q <question>   The question being answered
    --answer, -a <answer>       The clarification/answer

Examples:
  hive spec list --status review
  hive spec review
  hive spec approve spec-user-auth-v1 --comment "Looks good"
  hive spec approve-all --confidence 80 --dry-run
  hive spec approve-all --tag mvp --since 2024-01-01
  hive spec request-changes spec-user-auth-v1 --comment "Need password reset scenario"
  hive spec reject spec-user-auth-v1 --reason "Out of scope for MVP"
  hive spec search "authentication"
  hive spec history user-auth
  hive spec clarify spec-rate-limiting-v1 --question "Per-user or per-key?" --answer "Per API key"
`);
}

// Export alias for CLI integration
export { main as specCommand };
