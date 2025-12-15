/**
 * Inbox Command - Human interface to Swarm Mail
 *
 * Allows humans to read messages sent to them by hive agents
 * and reply via hivemail_send.
 *
 * Commands:
 * - inbox           - List unread messages for 'human'
 * - inbox --all     - Show all messages (not just unread)
 * - inbox --filter  - Filter by subject pattern
 * - inbox read <id> - Display full message body
 * - inbox reply <id> <text> - Send reply via hivemail
 */

import * as p from "@clack/prompts";
import { cyan, dim, yellow, green, red } from "../branding.js";
import { getDatabase } from "../../streams/index.js";
import { PGliteDatabaseAdapter } from "../../adapter.js";
import { sendSwarmMessage } from "../../streams/hive-mail.js";

// ============================================================================
// Types
// ============================================================================

interface InboxOptions {
  all?: boolean;
  filter?: string;
}

interface InboxMessage {
  id: number;
  from_agent: string;
  subject: string;
  body: string;
  thread_id: string | null;
  importance: string;
  created_at: number;
  read_at: number | null;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Format timestamp for display
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) {
    return "just now";
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format importance level with color
 */
function formatImportance(importance: string): string {
  switch (importance) {
    case "urgent":
      return red("URGENT");
    case "high":
      return yellow("HIGH");
    case "normal":
      return dim("normal");
    case "low":
      return dim("low");
    default:
      return dim(importance);
  }
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

/**
 * Pad string to fixed width
 */
function pad(str: string, width: number): string {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

// ============================================================================
// Database Queries
// ============================================================================

/**
 * Get messages for human recipient
 */
async function getHumanInbox(
  projectPath: string,
  options: InboxOptions = {}
): Promise<InboxMessage[]> {
  const db = await getDatabase(projectPath);
  const adapter = new PGliteDatabaseAdapter(db);

  // Build query to get messages where 'human' is a recipient
  const conditions = ["mr.agent_name = $1"];
  const params: (string | number)[] = ["human"];

  // Filter by unread only if not showing all
  if (!options.all) {
    conditions.push("mr.read_at IS NULL");
  }

  const query = `
    SELECT m.id, m.from_agent, m.subject, m.body, m.thread_id, 
           m.importance, m.created_at, mr.read_at
    FROM messages m
    JOIN message_recipients mr ON m.id = mr.message_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY m.created_at DESC
    LIMIT 50
  `;

  const result = await adapter.query<InboxMessage>(query, params);
  let messages = result.rows;

  // Apply subject filter if provided
  if (options.filter) {
    const filterLower = options.filter.toLowerCase();
    messages = messages.filter(
      (m) =>
        m.subject.toLowerCase().includes(filterLower) ||
        m.from_agent.toLowerCase().includes(filterLower)
    );
  }

  return messages;
}

/**
 * Get a single message by ID
 */
async function getMessageById(
  projectPath: string,
  messageId: number
): Promise<InboxMessage | null> {
  const db = await getDatabase(projectPath);
  const adapter = new PGliteDatabaseAdapter(db);

  const result = await adapter.query<InboxMessage>(
    `SELECT m.id, m.from_agent, m.subject, m.body, m.thread_id,
            m.importance, m.created_at, mr.read_at
     FROM messages m
     JOIN message_recipients mr ON m.id = mr.message_id
     WHERE m.id = $1 AND mr.agent_name = 'human'`,
    [messageId]
  );

  return result.rows[0] ?? null;
}

/**
 * Mark a message as read
 */
async function markAsRead(
  projectPath: string,
  messageId: number
): Promise<void> {
  const db = await getDatabase(projectPath);
  const adapter = new PGliteDatabaseAdapter(db);

  await adapter.query(
    `UPDATE message_recipients SET read_at = $1 WHERE message_id = $2 AND agent_name = 'human'`,
    [Date.now(), messageId]
  );
}

// ============================================================================
// Commands
// ============================================================================

/**
 * List inbox messages
 */
async function listInbox(
  projectPath: string,
  options: InboxOptions
): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Fetching messages...");

  try {
    const messages = await getHumanInbox(projectPath, options);
    spinner.stop("Messages loaded");

    if (messages.length === 0) {
      if (options.all) {
        p.log.info("No messages in inbox");
      } else {
        p.log.info("No unread messages. Use --all to see all messages.");
      }
      return;
    }

    // Print header
    console.log();
    console.log(
      cyan(pad("ID", 6)) +
        " " +
        cyan(pad("From", 15)) +
        " " +
        cyan(pad("Subject", 35)) +
        " " +
        cyan(pad("Importance", 10)) +
        " " +
        cyan("Time")
    );
    console.log(dim("─".repeat(80)));

    // Print messages
    for (const msg of messages) {
      const readMarker = msg.read_at ? dim("✓") : green("•");
      const id = pad(String(msg.id), 5);
      const from = pad(truncate(msg.from_agent, 14), 15);
      const subject = pad(truncate(msg.subject, 34), 35);
      const importance = pad(formatImportance(msg.importance), 10);
      const time = formatTime(msg.created_at);

      console.log(
        `${readMarker} ${dim(id)} ${yellow(from)} ${subject} ${importance} ${dim(time)}`
      );
    }

    console.log();
    p.log.info(
      dim(
        `${messages.length} message(s). Use 'inbox read <id>' to view full message.`
      )
    );
  } catch (error) {
    spinner.stop("Failed to fetch messages");
    p.log.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

/**
 * Read a specific message
 */
async function readMessage(
  projectPath: string,
  messageId: number
): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Loading message...");

  try {
    const message = await getMessageById(projectPath, messageId);
    spinner.stop("Message loaded");

    if (!message) {
      p.log.error(`Message ${messageId} not found or not addressed to you`);
      process.exit(1);
    }

    // Mark as read
    await markAsRead(projectPath, messageId);

    // Display message
    console.log();
    console.log(cyan("━".repeat(60)));
    console.log(
      `${cyan("From:")}    ${yellow(message.from_agent)}`
    );
    console.log(
      `${cyan("Subject:")} ${message.subject}`
    );
    console.log(
      `${cyan("Time:")}    ${new Date(message.created_at).toLocaleString()}`
    );
    console.log(
      `${cyan("Priority:")} ${formatImportance(message.importance)}`
    );
    if (message.thread_id) {
      console.log(
        `${cyan("Thread:")}  ${dim(message.thread_id)}`
      );
    }
    console.log(cyan("━".repeat(60)));
    console.log();
    console.log(message.body);
    console.log();
    console.log(cyan("━".repeat(60)));

    // Show reply hint
    p.log.info(
      dim(`Reply with: inbox reply ${messageId} "your message here"`)
    );
  } catch (error) {
    spinner.stop("Failed to load message");
    p.log.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

/**
 * Reply to a message
 */
async function replyToMessage(
  projectPath: string,
  messageId: number,
  replyText: string
): Promise<void> {
  const spinner = p.spinner();
  spinner.start("Loading original message...");

  try {
    // Get original message for context
    const original = await getMessageById(projectPath, messageId);
    spinner.stop("Original message loaded");

    if (!original) {
      p.log.error(`Message ${messageId} not found`);
      process.exit(1);
    }

    spinner.start("Sending reply...");

    // Send reply via hivemail
    const result = await sendSwarmMessage({
      projectPath,
      fromAgent: "human",
      toAgents: [original.from_agent],
      subject: original.subject.startsWith("Re: ")
        ? original.subject
        : `Re: ${original.subject}`,
      body: replyText,
      threadId: original.thread_id || `thread-${messageId}`,
      importance: "normal",
    });

    spinner.stop("Reply sent");

    p.log.success(
      `Reply sent to ${yellow(original.from_agent)} (message #${result.messageId})`
    );

    if (original.thread_id) {
      p.log.info(dim(`Thread: ${original.thread_id}`));
    }
  } catch (error) {
    spinner.stop("Failed to send reply");
    p.log.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

// ============================================================================
// Main Command
// ============================================================================

/**
 * Main inbox command handler
 */
export async function inboxCommand(
  args: string[] = [],
  projectPath: string = process.cwd()
): Promise<void> {
  p.intro(cyan("hive inbox") + dim(" - Human inbox for Swarm Mail"));

  // Parse arguments
  const options: InboxOptions = {};
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--all" || arg === "-a") {
      options.all = true;
    } else if (arg === "--filter" || arg === "-f") {
      options.filter = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    } else if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    }
  }

  // Handle subcommands
  const subcommand = positionalArgs[0];

  if (subcommand === "read") {
    const messageId = parseInt(positionalArgs[1], 10);
    if (isNaN(messageId)) {
      p.log.error("Usage: inbox read <message-id>");
      process.exit(1);
    }
    await readMessage(projectPath, messageId);
  } else if (subcommand === "reply") {
    const messageId = parseInt(positionalArgs[1], 10);
    const replyText = positionalArgs.slice(2).join(" ");
    if (isNaN(messageId) || !replyText) {
      p.log.error('Usage: inbox reply <message-id> "your reply text"');
      process.exit(1);
    }
    await replyToMessage(projectPath, messageId, replyText);
  } else if (subcommand && !isNaN(parseInt(subcommand, 10))) {
    // If just a number, treat as read command
    await readMessage(projectPath, parseInt(subcommand, 10));
  } else {
    // Default: list inbox
    await listInbox(projectPath, options);
  }

  p.outro(dim("Use 'inbox --help' for more options"));
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
${cyan("Usage:")} hive inbox [command] [options]

${cyan("Commands:")}
  ${yellow("(default)")}           List unread messages
  ${yellow("read <id>")}           Display full message body
  ${yellow("reply <id> <text>")}   Send reply to a message

${cyan("Options:")}
  ${yellow("--all, -a")}           Show all messages (not just unread)
  ${yellow("--filter, -f <term>")} Filter by subject or sender
  ${yellow("--help, -h")}          Show this help message

${cyan("Examples:")}
  ${dim("# List unread messages")}
  hive inbox

  ${dim("# Show all messages")}
  hive inbox --all

  ${dim("# Filter by subject")}
  hive inbox --filter review

  ${dim("# Read message #42")}
  hive inbox read 42

  ${dim("# Reply to message #42")}
  hive inbox reply 42 "Looks good, ship it!"
`);
}

/**
 * CLI entry point
 */
export async function main(args: string[] = []): Promise<void> {
  await inboxCommand(args);
}
