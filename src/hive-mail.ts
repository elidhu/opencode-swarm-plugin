/**
 * Swarm Mail Plugin Tools - Embedded event-sourced implementation
 *
 * Replaces the MCP-based agent-mail with embedded PGLite storage.
 * Same tool API surface, but no external server dependency.
 *
 * Key features:
 * - Event sourcing for full audit trail
 * - Offset-based resumability (Durable Streams inspired)
 * - Materialized views for fast queries
 * - File reservation with conflict detection
 *
 * CRITICAL CONSTRAINTS (same as agent-mail):
 * - hivemail_inbox ALWAYS limits to 5 messages max
 * - hivemail_inbox ALWAYS excludes bodies by default
 * - Use summarize_thread instead of fetching all messages
 * - Auto-release reservations when tasks complete
 */
import { tool } from "@opencode-ai/plugin";
import {
  initSwarmAgent,
  sendSwarmMessage,
  getSwarmInbox,
  readSwarmMessage,
  reserveSwarmFiles,
  releaseSwarmFiles,
  acknowledgeSwarmMessage,
  checkHiveHealth,
} from "./streams/hive-mail";
import { getActiveReservations } from "./streams/projections";
import type { MailSessionState } from "./streams/events";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createHiveTool,
  loadSessionState,
  saveSessionState,
} from "./hive-tool-helpers";

// ============================================================================
// Types
// ============================================================================

/** Tool execution context from OpenCode plugin */
interface ToolContext {
  sessionID: string;
}

/**
 * Swarm Mail session state
 * @deprecated Use MailSessionState from streams/events.ts instead
 * This is kept for backward compatibility and re-exported as an alias
 */
export type HiveMailState = MailSessionState;

/** Init tool arguments */
interface InitArgs {
  project_path?: string;
  agent_name?: string;
  task_description?: string;
}

/** Send tool arguments */
interface SendArgs {
  to: string[];
  subject: string;
  body: string;
  thread_id?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ack_required?: boolean;
}

/** Inbox tool arguments */
interface InboxArgs {
  limit?: number;
  urgent_only?: boolean;
}

/** Read message tool arguments */
interface ReadMessageArgs {
  message_id: number;
}

/** Reserve tool arguments */
interface ReserveArgs {
  paths: string[];
  reason?: string;
  exclusive?: boolean;
  ttl_seconds?: number;
}

/** Release tool arguments */
interface ReleaseArgs {
  paths?: string[];
  reservation_ids?: number[];
}

/** Ack tool arguments */
interface AckArgs {
  message_id: number;
}

// ============================================================================
// Configuration
// ============================================================================

const MAX_INBOX_LIMIT = 5; // HARD CAP - context preservation

/**
 * Default project directory for Swarm Mail operations
 *
 * This is set by the plugin init to the actual working directory (from OpenCode).
 * Without this, tools might use the plugin's directory instead of the project's.
 */
let hiveMailProjectDirectory: string | null = null;

/**
 * Set the default project directory for Swarm Mail operations
 *
 * Called during plugin initialization with the actual project directory.
 */
export function setHiveMailProjectDirectory(directory: string): void {
  hiveMailProjectDirectory = directory;
}

/**
 * Get the default project directory
 * Returns undefined if not set - let getDatabasePath use global fallback
 */
export function getHiveMailProjectDirectory(): string | undefined {
  return hiveMailProjectDirectory ?? undefined;
}

// ============================================================================
// Session State Management
// ============================================================================

const SESSION_STATE_DIR =
  process.env.HIVE_STATE_DIR || join(tmpdir(), "hive-sessions");

function getSessionStatePath(sessionID: string): string {
  const safeID = sessionID.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(SESSION_STATE_DIR, `${safeID}.json`);
}

export function clearSessionState(sessionID: string): void {
  const path = getSessionStatePath(sessionID);
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Ignore errors
  }
}

// ============================================================================
// Plugin Tools
// ============================================================================

/**
 * Initialize Swarm Mail session
 */
export const hivemail_init = tool({
  description:
    "Initialize Swarm Mail session. Creates agent identity and registers with the embedded event store.",
  args: {
    project_path: tool.schema
      .string()
      .optional()
      .describe("Project path (defaults to current working directory)"),
    agent_name: tool.schema
      .string()
      .optional()
      .describe("Custom agent name (auto-generated if not provided)"),
    task_description: tool.schema
      .string()
      .optional()
      .describe("Description of the task this agent is working on"),
  },
  async execute(args: InitArgs, ctx: ToolContext): Promise<string> {
    // For init, we need a project path - use provided, stored, or cwd
    const projectPath =
      args.project_path || getHiveMailProjectDirectory() || process.cwd();
    const sessionID = ctx.sessionID || "default";

    // Check if already initialized
    const existingState = loadSessionState(sessionID);
    if (existingState) {
      return JSON.stringify(
        {
          agent_name: existingState.agentName,
          project_key: existingState.projectKey,
          message: `Session already initialized as ${existingState.agentName}`,
          already_initialized: true,
        },
        null,
        2,
      );
    }

    try {
      const result = await initSwarmAgent({
        projectPath,
        agentName: args.agent_name,
        taskDescription: args.task_description,
      });

      // Save session state
      const state: HiveMailState = {
        projectKey: result.projectKey,
        agentName: result.agentName,
        reservations: [],
        startedAt: new Date().toISOString(),
      };
      saveSessionState(sessionID, state);

      return JSON.stringify(
        {
          agent_name: result.agentName,
          project_key: result.projectKey,
          message: `Initialized as ${result.agentName}`,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Send message to other agents
 */
export const hivemail_send = createHiveTool<SendArgs>(
  "Send message to other hive agents",
  {
    to: tool.schema
      .array(tool.schema.string())
      .describe("List of recipient agent names"),
    subject: tool.schema.string().describe("Message subject"),
    body: tool.schema.string().describe("Message body"),
    thread_id: tool.schema
      .string()
      .optional()
      .describe("Thread ID for conversation tracking"),
    importance: tool.schema
      .enum(["low", "normal", "high", "urgent"])
      .optional()
      .describe("Message importance level"),
    ack_required: tool.schema
      .boolean()
      .optional()
      .describe("Whether acknowledgement is required"),
  },
  async (args, state) => {
    if (!state) {
      throw new Error("Session not initialized");
    }

    const result = await sendSwarmMessage({
      projectPath: state.projectKey,
      fromAgent: state.agentName,
      toAgents: args.to,
      subject: args.subject,
      body: args.body,
      threadId: args.thread_id,
      importance: args.importance,
      ackRequired: args.ack_required,
    });

    return {
      success: result.success,
      message_id: result.messageId,
      thread_id: result.threadId,
      recipient_count: result.recipientCount,
    };
  },
);

/**
 * Fetch inbox (CONTEXT-SAFE: bodies excluded, limit 5)
 */
export const hivemail_inbox = createHiveTool<InboxArgs>(
  "Fetch inbox (CONTEXT-SAFE: bodies excluded by default, max 5 messages). Use hivemail_read_message for full body.",
  {
    limit: tool.schema
      .number()
      .max(MAX_INBOX_LIMIT)
      .optional()
      .describe(`Max messages to fetch (hard cap: ${MAX_INBOX_LIMIT})`),
    urgent_only: tool.schema
      .boolean()
      .optional()
      .describe("Only fetch urgent messages"),
  },
  async (args, state) => {
    if (!state) {
      throw new Error("Session not initialized");
    }

    const result = await getSwarmInbox({
      projectPath: state.projectKey,
      agentName: state.agentName,
      limit: Math.min(args.limit || MAX_INBOX_LIMIT, MAX_INBOX_LIMIT),
      urgentOnly: args.urgent_only,
      includeBodies: false, // ALWAYS false for context preservation
    });

    return {
      messages: result.messages.map((m) => ({
        id: m.id,
        from: m.from_agent,
        subject: m.subject,
        thread_id: m.thread_id,
        importance: m.importance,
        timestamp: m.created_at,
      })),
      total: result.total,
      note: "Use hivemail_read_message to fetch full body",
    };
  },
);

/**
 * Fetch ONE message body by ID
 */
export const hivemail_read_message = createHiveTool<ReadMessageArgs>(
  "Fetch ONE message body by ID. Use for reading full message content.",
  {
    message_id: tool.schema.number().describe("Message ID to read"),
  },
  async (args, state) => {
    if (!state) {
      throw new Error("Session not initialized");
    }

    const message = await readSwarmMessage({
      projectPath: state.projectKey,
      messageId: args.message_id,
      agentName: state.agentName,
      markAsRead: true,
    });

    if (!message) {
      throw new Error(`Message ${args.message_id} not found`);
    }

    return {
      id: message.id,
      from: message.from_agent,
      subject: message.subject,
      body: message.body,
      thread_id: message.thread_id,
      importance: message.importance,
      timestamp: message.created_at,
    };
  },
);

/**
 * Reserve file paths for exclusive editing
 */
export const hivemail_reserve = createHiveTool<ReserveArgs>(
  "Reserve file paths for exclusive editing. Prevents conflicts with other agents.",
  {
    paths: tool.schema
      .array(tool.schema.string())
      .describe("File paths or glob patterns to reserve"),
    reason: tool.schema
      .string()
      .optional()
      .describe("Reason for reservation (e.g., bead ID)"),
    exclusive: tool.schema
      .boolean()
      .optional()
      .describe("Whether reservation is exclusive (default: true)"),
    ttl_seconds: tool.schema
      .number()
      .optional()
      .describe("Time-to-live in seconds (default: 3600)"),
  },
  async (args, state, ctx) => {
    if (!state) {
      throw new Error("Session not initialized");
    }

    const result = await reserveSwarmFiles({
      projectPath: state.projectKey,
      agentName: state.agentName,
      paths: args.paths,
      reason: args.reason,
      exclusive: args.exclusive ?? true,
      ttlSeconds: args.ttl_seconds,
    });

    // Track reservations in session state
    if (result.granted.length > 0) {
      state.reservations.push(...result.granted.map((r) => r.id));
      const sessionID = ctx.sessionID || "default";
      saveSessionState(sessionID, state);
    }

    if (result.conflicts.length > 0) {
      return {
        granted: result.granted,
        conflicts: result.conflicts,
        warning: `${result.conflicts.length} path(s) already reserved by other agents`,
      };
    }

    return {
      granted: result.granted,
      message: `Reserved ${result.granted.length} path(s)`,
    };
  },
);

/**
 * Release file reservations
 */
export const hivemail_release = tool({
  description: "Release file reservations. Call when done editing files.",
  args: {
    paths: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Specific paths to release (releases all if omitted)"),
    reservation_ids: tool.schema
      .array(tool.schema.number())
      .optional()
      .describe("Specific reservation IDs to release"),
  },
  async execute(args: ReleaseArgs, ctx: ToolContext): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);

    if (!state) {
      return JSON.stringify(
        { error: "Session not initialized. Call hivemail_init first." },
        null,
        2,
      );
    }

    try {
      // Get current reservations to find which IDs correspond to paths
      const currentReservations = await getActiveReservations(
        state.projectKey,
        state.projectKey,
        state.agentName,
      );

      const result = await releaseSwarmFiles({
        projectPath: state.projectKey,
        agentName: state.agentName,
        paths: args.paths,
        reservationIds: args.reservation_ids,
      });

      // Clear tracked reservations
      if (!args.paths && !args.reservation_ids) {
        state.reservations = [];
      } else if (args.reservation_ids) {
        state.reservations = state.reservations.filter(
          (id) => !args.reservation_ids!.includes(id),
        );
      } else if (args.paths) {
        // When releasing by paths, find the reservation IDs that match those paths
        const releasedIds = currentReservations
          .filter((r: { path_pattern: string }) =>
            args.paths!.includes(r.path_pattern),
          )
          .map((r: { id: number }) => r.id);
        state.reservations = state.reservations.filter(
          (id: number) => !releasedIds.includes(id),
        );
      }
      saveSessionState(sessionID, state);

      return JSON.stringify(
        {
          released: result.released,
          released_at: result.releasedAt,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          error: `Failed to release files: ${error instanceof Error ? error.message : String(error)}`,
        },
        null,
        2,
      );
    }
  },
});

/**
 * Acknowledge a message
 */
export const hivemail_ack = createHiveTool<AckArgs>(
  "Acknowledge a message (for messages that require acknowledgement)",
  {
    message_id: tool.schema.number().describe("Message ID to acknowledge"),
  },
  async (args, state) => {
    if (!state) {
      throw new Error("Session not initialized");
    }

    const result = await acknowledgeSwarmMessage({
      projectPath: state.projectKey,
      messageId: args.message_id,
      agentName: state.agentName,
    });

    return {
      acknowledged: result.acknowledged,
      acknowledged_at: result.acknowledgedAt,
    };
  },
);

/**
 * Check if Swarm Mail is healthy
 */
export const hivemail_health = tool({
  description: "Check if Swarm Mail embedded store is healthy",
  args: {},
  async execute(
    _args: Record<string, never>,
    ctx: ToolContext,
  ): Promise<string> {
    const sessionID = ctx.sessionID || "default";
    const state = loadSessionState(sessionID);
    // For health check, undefined is OK - database layer uses global fallback
    const projectPath = state?.projectKey || getHiveMailProjectDirectory();

    try {
      const result = await checkHiveHealth(projectPath);

      return JSON.stringify(
        {
          healthy: result.healthy,
          database: result.database,
          stats: result.stats,
          session: state
            ? {
                agent_name: state.agentName,
                project_key: state.projectKey,
                reservations: state.reservations.length,
              }
            : null,
        },
        null,
        2,
      );
    } catch (error) {
      return JSON.stringify(
        {
          healthy: false,
          error: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
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

export const hiveMailTools = {
  hivemail_init: hivemail_init,
  hivemail_send: hivemail_send,
  hivemail_inbox: hivemail_inbox,
  hivemail_read_message: hivemail_read_message,
  hivemail_reserve: hivemail_reserve,
  hivemail_release: hivemail_release,
  hivemail_ack: hivemail_ack,
  hivemail_health: hivemail_health,
};
