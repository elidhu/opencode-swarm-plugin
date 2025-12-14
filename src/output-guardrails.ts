/**
 * Output Guardrails for MCP Tool Response Truncation
 *
 * Prevents MCP tools from blowing out context with massive responses.
 * Smart truncation that preserves JSON, code blocks, and markdown structure.
 */

export interface GuardrailConfig {
  defaultMaxChars: number;
  toolLimits: Record<string, number>;
  skipTools: string[];
}

export interface GuardrailResult {
  output: string;
  truncated: boolean;
  originalLength: number;
  truncatedLength: number;
}

export interface GuardrailMetrics {
  toolName: string;
  originalLength: number;
  truncatedLength: number;
  timestamp: number;
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  defaultMaxChars: 32000,

  toolLimits: {
    "repo-autopsy_file": 64000,
    "repo-autopsy_search": 64000,
    "repo-autopsy_exports_map": 64000,
    "context7_get-library-docs": 64000,
    skills_read: 48000,
    "repo-autopsy_structure": 24000,
    "repo-autopsy_stats": 16000,
  },

  skipTools: [
    // Beads tools
    "beads_create",
    "beads_create_epic",
    "beads_query",
    "beads_update",
    "beads_close",
    "beads_start",
    "beads_ready",
    "beads_sync",

    // Hive Mail tools
    "hivemail_init",
    "hivemail_send",
    "hivemail_inbox",
    "hivemail_read_message",
    "hivemail_reserve",
    "hivemail_release",
    "hivemail_ack",

    // Structured output tools
    "structured_extract_json",
    "structured_validate",
    "structured_parse_evaluation",
    "structured_parse_decomposition",
    "structured_parse_bead_tree",

    // Hive orchestration tools
    "hive_select_strategy",
    "hive_plan_prompt",
    "hive_decompose",
    "hive_validate_decomposition",
    "hive_status",
    "hive_progress",
    "hive_complete",
    "hive_record_outcome",
    "hive_subtask_prompt",
    "hive_spawn_subtask",
    "hive_complete_subtask",
    "hive_evaluation_prompt",

    // Mandate tools
    "mandate_file",
    "mandate_vote",
    "mandate_query",
    "mandate_list",
    "mandate_stats",
  ],
};

function findMatchingBrace(text: string, startIdx: number): number {
  const openChar = text[startIdx];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 1;

  for (let i = startIdx + 1; i < text.length; i++) {
    if (text[i] === openChar) {
      depth++;
    } else if (text[i] === closeChar) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

export function truncateWithBoundaries(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  let truncateAt = maxChars;

  const beforeTruncate = text.slice(0, maxChars);
  const lastOpenBrace = Math.max(
    beforeTruncate.lastIndexOf("{"),
    beforeTruncate.lastIndexOf("["),
  );
  const lastCloseBrace = Math.max(
    beforeTruncate.lastIndexOf("}"),
    beforeTruncate.lastIndexOf("]"),
  );

  if (lastOpenBrace > lastCloseBrace) {
    const matchingClose = findMatchingBrace(text, lastOpenBrace);
    if (matchingClose !== -1 && matchingClose < maxChars * 1.2) {
      truncateAt = matchingClose + 1;
    } else {
      truncateAt = lastOpenBrace;
    }
  }

  const codeBlockMarker = "```";
  const beforeTruncateForCode = text.slice(0, truncateAt);
  const codeBlockCount = (beforeTruncateForCode.match(/```/g) || []).length;

  if (codeBlockCount % 2 === 1) {
    const closeMarkerIdx = text.indexOf(codeBlockMarker, truncateAt);
    if (closeMarkerIdx !== -1 && closeMarkerIdx < maxChars * 1.2) {
      truncateAt = closeMarkerIdx + codeBlockMarker.length;
    } else {
      const lastOpenMarker = beforeTruncateForCode.lastIndexOf(codeBlockMarker);
      if (lastOpenMarker !== -1) {
        truncateAt = lastOpenMarker;
      }
    }
  }

  const headerMatch = text.slice(0, truncateAt).match(/\n#{1,6}\s/g);
  if (headerMatch && headerMatch.length > 0) {
    const lastHeaderIdx = beforeTruncateForCode.lastIndexOf("\n##");
    if (lastHeaderIdx !== -1 && lastHeaderIdx > maxChars * 0.8) {
      truncateAt = lastHeaderIdx;
    }
  }

  while (truncateAt > 0 && !/\s/.test(text[truncateAt])) {
    truncateAt--;
  }

  const truncated = text.slice(0, truncateAt).trimEnd();
  const charsRemoved = text.length - truncated.length;

  return `${truncated}\n\n[TRUNCATED - ${charsRemoved.toLocaleString()} chars removed]`;
}

function getToolLimit(
  toolName: string,
  config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): number {
  return config.toolLimits[toolName] ?? config.defaultMaxChars;
}

export function guardrailOutput(
  toolName: string,
  output: string,
  config: GuardrailConfig = DEFAULT_GUARDRAIL_CONFIG,
): GuardrailResult {
  const originalLength = output.length;

  if (config.skipTools.includes(toolName)) {
    return {
      output,
      truncated: false,
      originalLength,
      truncatedLength: originalLength,
    };
  }

  const limit = getToolLimit(toolName, config);

  if (originalLength <= limit) {
    return {
      output,
      truncated: false,
      originalLength,
      truncatedLength: originalLength,
    };
  }

  const truncatedOutput = truncateWithBoundaries(output, limit);
  const truncatedLength = truncatedOutput.length;

  return {
    output: truncatedOutput,
    truncated: true,
    originalLength,
    truncatedLength,
  };
}

export function createMetrics(
  result: GuardrailResult,
  toolName: string,
): GuardrailMetrics {
  return {
    toolName,
    originalLength: result.originalLength,
    truncatedLength: result.truncatedLength,
    timestamp: Date.now(),
  };
}
