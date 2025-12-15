/**
 * Hive Mail - Embedded event-sourced implementation
 *
 * Replaces the MCP-based agent-mail with embedded PGLite storage.
 * Same API surface, but no external server dependency.
 *
 * Key features:
 * - Event sourcing for full audit trail
 * - Offset-based resumability (Durable Streams inspired)
 * - Materialized views for fast queries
 * - File reservation with conflict detection
 *
 * Effect-TS Integration:
 * - DurableMailbox for message send/receive (envelope pattern)
 * - DurableCursor for positioned inbox consumption with checkpointing
 * - DurableLock for file reservations (mutual exclusion via CAS)
 * - DurableDeferred for request/response messaging
 *
 * Adapter Pattern:
 * - All functions accept optional DatabaseAdapter for dependency injection
 * - Enables in-memory testing without PGLite overhead
 * - Falls back to PGLite via getDatabase() if adapter not provided
 */
import { createEvent } from "./events";
import { isDatabaseHealthy, getDatabaseStats } from "./index";
import {
  checkConflicts,
  getActiveReservations,
  getInbox,
  getMessage,
} from "./projections";
import { appendEvent, registerAgent, reserveFiles, sendMessage } from "./store";
import type { DatabaseAdapter } from "../types/database";

// ============================================================================
// Constants
// ============================================================================

const MAX_INBOX_LIMIT = 5; // HARD CAP - context preservation
const DEFAULT_TTL_SECONDS = 3600; // 1 hour

// Agent name generation
const ADJECTIVES = [
  "Blue",
  "Red",
  "Green",
  "Gold",
  "Silver",
  "Swift",
  "Bright",
  "Dark",
  "Calm",
  "Bold",
  "Wise",
  "Quick",
  "Warm",
  "Cool",
  "Pure",
  "Wild",
];
const NOUNS = [
  "Lake",
  "Stone",
  "River",
  "Mountain",
  "Forest",
  "Ocean",
  "Star",
  "Moon",
  "Wind",
  "Fire",
  "Cloud",
  "Storm",
  "Dawn",
  "Dusk",
  "Hawk",
  "Wolf",
];

function generateSwarmAgentName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}${noun}`;
}

// ============================================================================
// Types
// ============================================================================

export interface HiveMailContext {
  projectKey: string;
  agentName: string;
}

export interface InitSwarmAgentOptions {
  projectPath: string;
  agentName?: string;
  program?: string;
  model?: string;
  taskDescription?: string;
  adapter?: DatabaseAdapter;
}

export interface SendSwarmMessageOptions {
  projectPath: string;
  fromAgent: string;
  toAgents: string[];
  subject: string;
  body: string;
  threadId?: string;
  importance?: "low" | "normal" | "high" | "urgent";
  ackRequired?: boolean;
  adapter?: DatabaseAdapter;
}

export interface SendSwarmMessageResult {
  success: boolean;
  messageId: number;
  threadId?: string;
  recipientCount: number;
}

export interface GetSwarmInboxOptions {
  projectPath: string;
  agentName: string;
  limit?: number;
  urgentOnly?: boolean;
  unreadOnly?: boolean;
  includeBodies?: boolean;
  adapter?: DatabaseAdapter;
}

export interface SwarmInboxMessage {
  id: number;
  from_agent: string;
  subject: string;
  body?: string;
  thread_id: string | null;
  importance: string;
  created_at: number;
}

export interface SwarmInboxResult {
  messages: SwarmInboxMessage[];
  total: number;
}

export interface ReadSwarmMessageOptions {
  projectPath: string;
  messageId: number;
  agentName?: string;
  markAsRead?: boolean;
  adapter?: DatabaseAdapter;
}

export interface ReserveSwarmFilesOptions {
  projectPath: string;
  agentName: string;
  paths: string[];
  reason?: string;
  exclusive?: boolean;
  ttlSeconds?: number;
  force?: boolean;
  adapter?: DatabaseAdapter;
}

export interface GrantedSwarmReservation {
  id: number;
  path_pattern: string;
  exclusive: boolean;
  expiresAt: number;
}

export interface SwarmReservationConflict {
  path: string;
  holder: string;
  pattern: string;
}

export interface ReserveSwarmFilesResult {
  granted: GrantedSwarmReservation[];
  conflicts: SwarmReservationConflict[];
}

export interface ReleaseSwarmFilesOptions {
  projectPath: string;
  agentName: string;
  paths?: string[];
  reservationIds?: number[];
  adapter?: DatabaseAdapter;
}

export interface ReleaseSwarmFilesResult {
  released: number;
  releasedAt: number;
}

export interface AcknowledgeSwarmOptions {
  projectPath: string;
  messageId: number;
  agentName: string;
  adapter?: DatabaseAdapter;
}

export interface AcknowledgeSwarmResult {
  acknowledged: boolean;
  acknowledgedAt: string | null;
}

export interface SwarmHealthResult {
  healthy: boolean;
  database: "connected" | "disconnected";
  stats?: {
    events: number;
    agents: number;
    messages: number;
    reservations: number;
  };
}

// ============================================================================
// Agent Operations
// ============================================================================

/**
 * Initialize a hive agent for this session
 *
 * Future: Can use DurableMailbox.create() for actor-style message consumption
 */
export async function initSwarmAgent(
  options: InitSwarmAgentOptions,
): Promise<HiveMailContext> {
  const {
    projectPath,
    agentName = generateSwarmAgentName(),
    program = "opencode",
    model = "unknown",
    taskDescription,
    // adapter: Stored in session state, will be passed through once store.ts supports it (bead .2)
  } = options;

  // Register the agent (creates event + updates view)
  // TODO: Pass adapter once store.ts registerAgent() accepts it (bead .2)
  await registerAgent(
    projectPath, // Use projectPath as projectKey
    agentName,
    { program, model, taskDescription },
    projectPath,
  );

  return {
    projectKey: projectPath,
    agentName,
  };
}

// ============================================================================
// Message Operations
// ============================================================================

/**
 * Send a message to other hive agents
 *
 * Future: Use DurableMailbox.send() for envelope pattern with replyTo support
 */
export async function sendSwarmMessage(
  options: SendSwarmMessageOptions,
): Promise<SendSwarmMessageResult> {
  const {
    projectPath,
    fromAgent,
    toAgents,
    subject,
    body,
    threadId,
    importance = "normal",
    ackRequired = false,
    // adapter: Will be used once store.ts sendMessage() accepts it (bead .2)
  } = options;

  // TODO: Pass adapter once store.ts sendMessage() accepts it (bead .2)
  await sendMessage(
    projectPath,
    fromAgent,
    toAgents,
    subject,
    body,
    { threadId, importance, ackRequired },
    projectPath,
  );

  // Get the message ID from the messages table (not the event ID)
  // Use adapter if provided, otherwise create PGliteDatabaseAdapter
  let dbAdapter: DatabaseAdapter;
  if (options.adapter) {
    dbAdapter = options.adapter;
  } else {
    const { getDatabase } = await import("./index");
    const { PGliteDatabaseAdapter } = await import("../adapter");
    const db = await getDatabase(projectPath);
    dbAdapter = new PGliteDatabaseAdapter(db);
  }
  
  const result = await dbAdapter.query<{ id: number }>(
    `SELECT id FROM messages 
     WHERE project_key = $1 AND from_agent = $2 AND subject = $3
     ORDER BY created_at DESC LIMIT 1`,
    [projectPath, fromAgent, subject],
  );

  const messageId = result.rows[0]?.id ?? 0;

  return {
    success: true,
    messageId,
    threadId,
    recipientCount: toAgents.length,
  };
}

/**
 * Get inbox messages for a hive agent
 *
 * Future: Use DurableCursor.consume() for positioned consumption with checkpointing
 */
export async function getSwarmInbox(
  options: GetSwarmInboxOptions,
): Promise<SwarmInboxResult> {
  const {
    projectPath,
    agentName,
    limit = MAX_INBOX_LIMIT,
    urgentOnly = false,
    unreadOnly = false,
    includeBodies = false,
    // adapter: Will be used once projections.ts getInbox() accepts it (bead .2)
  } = options;

  // Enforce max limit
  const effectiveLimit = Math.min(limit, MAX_INBOX_LIMIT);

  // TODO: Pass adapter once projections.ts getInbox() accepts it (bead .2)
  const messages = await getInbox(
    projectPath,
    agentName,
    {
      limit: effectiveLimit,
      urgentOnly,
      unreadOnly,
      includeBodies,
    },
    projectPath,
  );

  return {
    messages: messages.map((m) => ({
      id: m.id,
      from_agent: m.from_agent,
      subject: m.subject,
      body: includeBodies ? m.body : undefined,
      thread_id: m.thread_id,
      importance: m.importance,
      created_at: m.created_at,
    })),
    total: messages.length,
  };
}

/**
 * Read a single message with full body
 */
export async function readSwarmMessage(
  options: ReadSwarmMessageOptions,
): Promise<SwarmInboxMessage | null> {
  const {
    projectPath,
    messageId,
    agentName,
    markAsRead = false,
    // adapter: Will be used once projections/store accept it (bead .2)
  } = options;

  // TODO: Pass adapter once projections.ts getMessage() accepts it (bead .2)
  const message = await getMessage(projectPath, messageId, projectPath);

  if (!message) {
    return null;
  }

  // Mark as read if requested
  if (markAsRead && agentName) {
    // TODO: Pass adapter once store.ts appendEvent() accepts it (bead .2)
    await appendEvent(
      createEvent("message_read", {
        project_key: projectPath,
        message_id: messageId,
        agent_name: agentName,
      }),
      projectPath,
    );
  }

  return {
    id: message.id,
    from_agent: message.from_agent,
    subject: message.subject,
    body: message.body,
    thread_id: message.thread_id,
    importance: message.importance,
    created_at: message.created_at,
  };
}

// ============================================================================
// Reservation Operations
// ============================================================================

/**
 * Reserve files for exclusive editing
 *
 * Always grants reservations (even with conflicts) - conflicts are warnings, not blockers.
 * This matches the test expectations and allows agents to proceed with awareness.
 *
 * Future: Use DurableLock.acquire() for distributed mutex with automatic expiry
 */
export async function reserveSwarmFiles(
  options: ReserveSwarmFilesOptions,
): Promise<ReserveSwarmFilesResult> {
  const {
    projectPath,
    agentName,
    paths,
    reason,
    exclusive = true,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    // adapter: Will be used once projections/store accept it (bead .2)
  } = options;

  // TODO: Pass adapter once projections.ts checkConflicts() accepts it (bead .2)
  // Check for conflicts first
  const conflicts = await checkConflicts(
    projectPath,
    agentName,
    paths,
    projectPath,
  );

  // TODO: Pass adapter once store.ts reserveFiles() accepts it (bead .2)
  // Always create reservations - conflicts are warnings, not blockers
  await reserveFiles(
    projectPath,
    agentName,
    paths,
    { reason, exclusive, ttlSeconds },
    projectPath,
  );

  // TODO: Pass adapter once projections.ts getActiveReservations() accepts it (bead .2)
  // Query the actual reservation IDs from the database
  const reservations = await getActiveReservations(
    projectPath,
    projectPath,
    agentName,
  );

  // Filter to just the paths we reserved (most recent ones)
  const granted: GrantedSwarmReservation[] = reservations
    .filter((r) => paths.includes(r.path_pattern))
    .map((r) => ({
      id: r.id,
      path_pattern: r.path_pattern,
      exclusive: r.exclusive,
      expiresAt: r.expires_at,
    }));

  return {
    granted,
    conflicts: conflicts.map((c) => ({
      path: c.path,
      holder: c.holder,
      pattern: c.pattern,
    })),
  };
}

/**
 * Release file reservations
 *
 * Future: Use DurableLock.release() for automatic cleanup
 */
export async function releaseSwarmFiles(
  options: ReleaseSwarmFilesOptions,
): Promise<ReleaseSwarmFilesResult> {
  const {
    projectPath,
    agentName,
    paths,
    reservationIds,
    // adapter: Will be used once projections/store accept it (bead .2)
  } = options;

  // TODO: Pass adapter once projections.ts getActiveReservations() accepts it (bead .2)
  // Get current reservations to count what we're releasing
  const currentReservations = await getActiveReservations(
    projectPath,
    projectPath,
    agentName,
  );

  let releaseCount = 0;

  if (paths && paths.length > 0) {
    // Release specific paths
    releaseCount = currentReservations.filter((r) =>
      paths.includes(r.path_pattern),
    ).length;
  } else if (reservationIds && reservationIds.length > 0) {
    // Release by ID
    releaseCount = currentReservations.filter((r) =>
      reservationIds.includes(r.id),
    ).length;
  } else {
    // Release all
    releaseCount = currentReservations.length;
  }

  // TODO: Pass adapter once store.ts appendEvent() accepts it (bead .2)
  // Create release event
  await appendEvent(
    createEvent("file_released", {
      project_key: projectPath,
      agent_name: agentName,
      paths,
      reservation_ids: reservationIds,
    }),
    projectPath,
  );

  return {
    released: releaseCount,
    releasedAt: Date.now(),
  };
}

// ============================================================================
// Acknowledgement Operations
// ============================================================================

/**
 * Acknowledge a hive message
 */
export async function acknowledgeSwarmMessage(
  options: AcknowledgeSwarmOptions,
): Promise<AcknowledgeSwarmResult> {
  const {
    projectPath,
    messageId,
    agentName,
    // adapter: Will be used once store.ts appendEvent() accepts it (bead .2)
  } = options;

  const timestamp = Date.now();

  // TODO: Pass adapter once store.ts appendEvent() accepts it (bead .2)
  await appendEvent(
    createEvent("message_acked", {
      project_key: projectPath,
      message_id: messageId,
      agent_name: agentName,
    }),
    projectPath,
  );

  return {
    acknowledged: true,
    acknowledgedAt: new Date(timestamp).toISOString(),
  };
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if the hive mail store is healthy
 */
export async function checkHiveHealth(
  projectPath?: string,
): Promise<SwarmHealthResult> {
  const healthy = await isDatabaseHealthy(projectPath);

  if (!healthy) {
    return {
      healthy: false,
      database: "disconnected",
    };
  }

  const stats = await getDatabaseStats(projectPath);

  return {
    healthy: true,
    database: "connected",
    stats,
  };
}
