/**
 * Text Embeddings using Transformers.js
 *
 * ## Overview
 * This module provides local text embeddings using the 'Xenova/all-mpnet-base-v2' model.
 * The model is downloaded once (~90MB) and cached locally for subsequent runs.
 *
 * ## Architecture
 * - **Singleton Pattern**: The embedder is initialized lazily on first use
 * - **Model**: all-mpnet-base-v2 (768-dimensional embeddings)
 * - **Pooling**: Mean pooling for sentence-level embeddings
 * - **Normalization**: Embeddings are normalized for cosine similarity
 *
 * ## Usage
 * ```typescript
 * import { embed, embedBatch, EMBEDDING_DIMENSION } from './embeddings';
 *
 * // Single text
 * const vector = await embed("Hello world");
 * console.log(vector.length); // 768
 *
 * // Batch processing
 * const vectors = await embedBatch(["text1", "text2", "text3"]);
 * console.log(vectors.length); // 3
 * console.log(vectors[0].length); // 768
 * ```
 *
 * ## Thread Safety
 * The module is safe for concurrent use. Multiple calls during initialization
 * will share the same pending Promise, preventing duplicate model loading.
 */

import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

// ============================================================================
// Constants
// ============================================================================

/** Dimension of embeddings produced by all-mpnet-base-v2 model */
export const EMBEDDING_DIMENSION = 768;

/** Model name - high quality sentence transformer */
const MODEL_NAME = "Xenova/all-mpnet-base-v2";

// ============================================================================
// Singleton Embedder Instance
// ============================================================================

/** Cached embedder instance */
let embedderInstance: FeatureExtractionPipeline | null = null;

/** Pending initialization promise to prevent race conditions */
let initPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Get or create the embedder pipeline
 *
 * Uses Promise-based caching to prevent race conditions when multiple concurrent
 * calls occur before the first one completes.
 *
 * @returns Initialized feature extraction pipeline
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  // Return cached instance if available
  if (embedderInstance) {
    return embedderInstance;
  }

  // Return pending promise if initialization is in progress
  if (initPromise) {
    return initPromise;
  }

  // Create new initialization promise
  initPromise = initializeEmbedder();

  try {
    embedderInstance = await initPromise;
    return embedderInstance;
  } finally {
    // Clean up pending promise once resolved/rejected
    initPromise = null;
  }
}

/**
 * Initialize the embedder pipeline
 *
 * Downloads the model on first run (~90MB, cached locally).
 * Subsequent runs load from cache.
 */
async function initializeEmbedder(): Promise<FeatureExtractionPipeline> {
  try {
    console.log("[embeddings] Initializing embedder model...");
    const embedder = (await pipeline(
      "feature-extraction",
      MODEL_NAME,
    )) as FeatureExtractionPipeline;
    console.log("[embeddings] Embedder initialized successfully");
    return embedder;
  } catch (error) {
    const err = error as Error;
    console.error(
      `[embeddings] Failed to initialize embedder: ${err.message}`,
    );
    throw new Error(`Embedder initialization failed: ${err.message}`);
  }
}

/**
 * Apply mean pooling to token embeddings
 *
 * Takes the raw token-level embeddings and pools them to get a single
 * sentence-level embedding.
 */
function meanPooling(tokenEmbeddings: number[][], sequenceLength: number): number[] {
  const embeddingDim = tokenEmbeddings[0]?.length ?? EMBEDDING_DIMENSION;
  const pooled = new Array(embeddingDim).fill(0);

  // Sum all token embeddings
  for (let i = 0; i < sequenceLength; i++) {
    const tokenEmb = tokenEmbeddings[i];
    if (tokenEmb) {
      for (let j = 0; j < embeddingDim; j++) {
        pooled[j] += tokenEmb[j];
      }
    }
  }

  // Average by number of tokens
  for (let j = 0; j < embeddingDim; j++) {
    pooled[j] /= sequenceLength;
  }

  return pooled;
}

/**
 * Normalize a vector to unit length (L2 normalization)
 */
function normalize(vector: number[]): number[] {
  // Calculate L2 norm
  let norm = 0;
  for (const val of vector) {
    norm += val * val;
  }
  norm = Math.sqrt(norm);

  // Normalize
  if (norm === 0) {
    return vector; // Avoid division by zero
  }

  return vector.map((val) => val / norm);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate embedding for a single text
 *
 * The embedding is a 768-dimensional vector normalized for cosine similarity.
 *
 * @param text - Text to embed
 * @returns 768-dimensional embedding vector
 *
 * @example
 * const vector = await embed("Hello world");
 * console.log(vector.length); // 768
 */
export async function embed(text: string): Promise<number[]> {
  const embedder = await getEmbedder();

  try {
    // Generate embeddings with pooling and normalization
    const result = await embedder(text, { pooling: "mean", normalize: true });

    // The result is a Tensor with dims [1, embedding_dim] for single text
    // We need to extract the data and handle the shape
    const dims = result.dims as number[];
    const data = Array.from(result.data) as number[];

    // For pooled result, dims should be [1, EMBEDDING_DIMENSION]
    // The data is flat, so we just need to slice the relevant portion
    let embedding: number[];
    
    if (dims.length === 2 && dims[1] === EMBEDDING_DIMENSION) {
      // Perfect - already pooled and correct dimension
      embedding = data.slice(0, EMBEDDING_DIMENSION);
    } else if (dims.length === 3) {
      // Token-level embeddings: [batch, sequence_length, embedding_dim]
      // We need to apply mean pooling manually
      const [batch, seqLen, embDim] = dims;
      if (embDim !== EMBEDDING_DIMENSION) {
        throw new Error(
          `Model embedding dimension ${embDim} does not match expected ${EMBEDDING_DIMENSION}`,
        );
      }
      
      // Extract first batch, apply mean pooling
      const pooled = new Array(embDim).fill(0);
      for (let i = 0; i < seqLen; i++) {
        for (let j = 0; j < embDim; j++) {
          pooled[j] += data[i * embDim + j];
        }
      }
      for (let j = 0; j < embDim; j++) {
        pooled[j] /= seqLen;
      }
      
      // Normalize
      embedding = normalize(pooled);
    } else {
      throw new Error(
        `Unexpected tensor shape: dims=${dims.join(",")}, data.length=${data.length}`,
      );
    }

    return embedding;
  } catch (error) {
    const err = error as Error;
    console.error(`[embeddings] Failed to embed text: ${err.message}`);
    throw new Error(`Embedding generation failed: ${err.message}`);
  }
}

/**
 * Generate embeddings for multiple texts in batch
 *
 * More efficient than calling embed() multiple times for large batches.
 *
 * @param texts - Array of texts to embed
 * @returns Array of 768-dimensional embedding vectors
 *
 * @example
 * const vectors = await embedBatch(["text1", "text2", "text3"]);
 * console.log(vectors.length); // 3
 * console.log(vectors[0].length); // 768
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const embedder = await getEmbedder();

  try {
    // Process in batch with pooling and normalization
    const result = await embedder(texts, { pooling: "mean", normalize: true });

    // The result is a Tensor with dims [batch_size, embedding_dim] for pooled result
    const dims = result.dims as number[];
    const data = Array.from(result.data) as number[];

    const embeddings: number[][] = [];

    if (dims.length === 2 && dims[0] === texts.length && dims[1] === EMBEDDING_DIMENSION) {
      // Perfect - already pooled, just reshape
      for (let i = 0; i < texts.length; i++) {
        const start = i * EMBEDDING_DIMENSION;
        const end = start + EMBEDDING_DIMENSION;
        embeddings.push(data.slice(start, end));
      }
    } else if (dims.length === 3) {
      // Token-level embeddings: [batch_size, sequence_length, embedding_dim]
      // Need to pool each batch separately
      const [batchSize, seqLen, embDim] = dims;
      
      if (embDim !== EMBEDDING_DIMENSION) {
        throw new Error(
          `Model embedding dimension ${embDim} does not match expected ${EMBEDDING_DIMENSION}`,
        );
      }

      for (let b = 0; b < batchSize; b++) {
        const pooled = new Array(embDim).fill(0);
        const batchOffset = b * seqLen * embDim;
        
        for (let i = 0; i < seqLen; i++) {
          for (let j = 0; j < embDim; j++) {
            pooled[j] += data[batchOffset + i * embDim + j];
          }
        }
        
        for (let j = 0; j < embDim; j++) {
          pooled[j] /= seqLen;
        }
        
        // Normalize
        embeddings.push(normalize(pooled));
      }
    } else {
      throw new Error(
        `Unexpected tensor shape: dims=${dims.join(",")}, data.length=${data.length}`,
      );
    }

    return embeddings;
  } catch (error) {
    const err = error as Error;
    console.error(`[embeddings] Failed to embed batch: ${err.message}`);
    throw new Error(`Batch embedding generation failed: ${err.message}`);
  }
}

/**
 * Reset the embedder instance (useful for testing)
 */
export function resetEmbedder(): void {
  embedderInstance = null;
  initPromise = null;
}
