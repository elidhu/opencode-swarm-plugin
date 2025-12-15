/**
 * Text Embeddings using Transformers.js via Node.js subprocess
 *
 * ## Overview
 * This module provides local text embeddings using the 'Xenova/all-MiniLM-L6-v2' model.
 * The model is downloaded once (~30MB) and cached locally for subsequent runs.
 *
 * ## Architecture
 * - **Node.js Subprocess**: Embeddings run in Node.js to avoid Bun/ONNX crash
 * - **Model**: all-MiniLM-L6-v2 (384-dimensional embeddings, faster than mpnet)
 * - **Pooling**: Mean pooling for sentence-level embeddings
 * - **Normalization**: Embeddings are normalized for cosine similarity
 *
 * ## Why Node.js?
 * Bun crashes during ONNX runtime cleanup with @huggingface/transformers.
 * Node.js handles it correctly. We spawn Node for embedding ops only.
 *
 * ## Usage
 * ```typescript
 * import { embed, embedBatch, EMBEDDING_DIMENSION } from './embeddings';
 *
 * // Single text
 * const vector = await embed("Hello world");
 * console.log(vector.length); // 384
 *
 * // Batch processing
 * const vectors = await embedBatch(["text1", "text2", "text3"]);
 * console.log(vectors.length); // 3
 * console.log(vectors[0].length); // 384
 * ```
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Get the directory where this module is located (for finding node_modules)
const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Constants
// ============================================================================

/** Dimension of embeddings produced by all-MiniLM-L6-v2 model */
export const EMBEDDING_DIMENSION = 384;

/** Model name - fast, good quality sentence transformer */
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

// ============================================================================
// Node.js Subprocess Execution
// ============================================================================

/**
 * Run embedding generation in Node.js subprocess
 *
 * This avoids the Bun ONNX crash by isolating transformers.js in Node.
 */
async function runNodeEmbedding(texts: string[]): Promise<number[][]> {
  return new Promise((resolve, reject) => {
    // Escape texts for JSON embedding in script
    const textsJson = JSON.stringify(texts);

    const script = `
const { pipeline } = require('@huggingface/transformers');

(async () => {
  try {
    const texts = ${textsJson};
    
    // Explicitly set dtype to suppress warning
    const embedder = await pipeline('feature-extraction', '${MODEL_NAME}', {
      dtype: 'fp32'
    });
    
    const results = [];
    for (const text of texts) {
      const result = await embedder(text, { pooling: 'mean', normalize: true });
      // Extract the embedding array from tensor
      const data = Array.from(result.data);
      results.push(data.slice(0, ${EMBEDDING_DIMENSION}));
    }
    
    console.log(JSON.stringify({ success: true, embeddings: results }));
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message }));
  }
})();
`;

    // Set NODE_PATH to include the plugin's node_modules so @huggingface/transformers can be found
    // This is necessary because the subprocess runs in the user's project directory
    const pluginNodeModules = join(__dirname, "..", "node_modules");
    const env = {
      ...process.env,
      NODE_PATH: pluginNodeModules,
    };

    const node = spawn("node", ["-e", script], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";

    node.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    node.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    node.on("close", () => {
      // Find the JSON output line (last line with valid JSON)
      const lines = stdout.trim().split("\n");
      let result = null;

      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          result = JSON.parse(lines[i]);
          break;
        } catch {
          // Not JSON, keep looking
        }
      }

      if (!result) {
        reject(
          new Error(
            `Failed to parse embedding result. stdout: ${stdout}, stderr: ${stderr}`,
          ),
        );
        return;
      }

      if (result.success) {
        resolve(result.embeddings);
      } else {
        reject(new Error(result.error || "Unknown embedding error"));
      }
    });

    node.on("error", (err) => {
      reject(new Error(`Failed to spawn node process: ${err.message}`));
    });
  });
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate embedding for a single text
 *
 * The embedding is a 384-dimensional vector normalized for cosine similarity.
 *
 * @param text - Text to embed
 * @returns 384-dimensional embedding vector
 *
 * @example
 * const vector = await embed("Hello world");
 * console.log(vector.length); // 384
 */
export async function embed(text: string): Promise<number[]> {
  const results = await runNodeEmbedding([text]);
  return results[0];
}

/**
 * Generate embeddings for multiple texts in batch
 *
 * @param texts - Array of texts to embed
 * @returns Array of 384-dimensional embedding vectors
 *
 * @example
 * const vectors = await embedBatch(["text1", "text2", "text3"]);
 * console.log(vectors.length); // 3
 * console.log(vectors[0].length); // 384
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  return runNodeEmbedding(texts);
}

/**
 * Reset the embedder instance (no-op for subprocess implementation)
 */
export function resetEmbedder(): void {
  // No persistent state to reset in subprocess model
}
