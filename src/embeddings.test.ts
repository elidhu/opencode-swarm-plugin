/**
 * Tests for embeddings module
 *
 * Tests embedding generation, batching, and error handling.
 */
import { describe, expect, it, afterAll } from "bun:test";
import { embed, embedBatch, EMBEDDING_DIMENSION, resetEmbedder } from "./embeddings";

describe("embeddings", () => {
  // Clean up after tests
  afterAll(() => {
    resetEmbedder();
  });

  describe("EMBEDDING_DIMENSION", () => {
    it("exports the correct dimension", () => {
      expect(EMBEDDING_DIMENSION).toBe(384);
    });
  });

  describe("embed", () => {
    it("generates embedding for single text", async () => {
      const text = "Hello world";
      const embedding = await embed(text);

      expect(embedding).toBeDefined();
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(EMBEDDING_DIMENSION);
      
      // Check that all values are numbers
      for (const val of embedding) {
        expect(typeof val).toBe("number");
        expect(Number.isFinite(val)).toBe(true);
      }
    }, 30000); // 30s timeout for model download on first run

    it("generates consistent embeddings for same text", async () => {
      const text = "Consistent text";
      const embedding1 = await embed(text);
      const embedding2 = await embed(text);

      expect(embedding1.length).toBe(embedding2.length);
      
      // Embeddings should be identical or very similar (allowing for floating point differences)
      for (let i = 0; i < embedding1.length; i++) {
        expect(Math.abs(embedding1[i] - embedding2[i])).toBeLessThan(1e-6);
      }
    });

    it("generates different embeddings for different texts", async () => {
      const text1 = "Machine learning";
      const text2 = "Pizza delivery";
      
      const embedding1 = await embed(text1);
      const embedding2 = await embed(text2);

      expect(embedding1.length).toBe(embedding2.length);
      
      // Embeddings should be different
      let diffCount = 0;
      for (let i = 0; i < embedding1.length; i++) {
        if (Math.abs(embedding1[i] - embedding2[i]) > 1e-6) {
          diffCount++;
        }
      }
      
      // At least 50% of values should be different
      expect(diffCount).toBeGreaterThan(EMBEDDING_DIMENSION / 2);
    });

    it("handles empty string", async () => {
      const embedding = await embed("");
      
      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(EMBEDDING_DIMENSION);
    });

    it("handles long text", async () => {
      const longText = "word ".repeat(500); // 500 words
      const embedding = await embed(longText);
      
      expect(embedding).toBeDefined();
      expect(embedding.length).toBe(EMBEDDING_DIMENSION);
    });
  });

  describe("embedBatch", () => {
    it("generates embeddings for multiple texts", async () => {
      const texts = ["First text", "Second text", "Third text"];
      const embeddings = await embedBatch(texts);

      expect(embeddings).toBeDefined();
      expect(Array.isArray(embeddings)).toBe(true);
      expect(embeddings.length).toBe(3);
      
      for (const embedding of embeddings) {
        expect(embedding.length).toBe(EMBEDDING_DIMENSION);
        
        // Check that all values are numbers
        for (const val of embedding) {
          expect(typeof val).toBe("number");
          expect(Number.isFinite(val)).toBe(true);
        }
      }
    }, 30000);

    it("returns empty array for empty input", async () => {
      const embeddings = await embedBatch([]);
      
      expect(embeddings).toBeDefined();
      expect(Array.isArray(embeddings)).toBe(true);
      expect(embeddings.length).toBe(0);
    });

    it("generates same embeddings as single embed", async () => {
      const text = "Batch test";
      const singleEmbedding = await embed(text);
      const batchEmbeddings = await embedBatch([text]);

      expect(batchEmbeddings.length).toBe(1);
      expect(batchEmbeddings[0].length).toBe(singleEmbedding.length);
      
      // Should be identical or very similar
      for (let i = 0; i < singleEmbedding.length; i++) {
        expect(Math.abs(singleEmbedding[i] - batchEmbeddings[0][i])).toBeLessThan(1e-6);
      }
    });

    it("handles batch of different length texts", async () => {
      const texts = [
        "Short",
        "This is a medium length sentence with several words.",
        "This is a much longer text that contains many more words and should test the model's ability to handle variable length inputs effectively.",
      ];
      const embeddings = await embedBatch(texts);

      expect(embeddings.length).toBe(3);
      
      // All embeddings should be same dimension regardless of input length
      for (const embedding of embeddings) {
        expect(embedding.length).toBe(EMBEDDING_DIMENSION);
      }
    });
  });

  describe("semantic similarity", () => {
    it("similar texts have higher cosine similarity", async () => {
      const text1 = "Machine learning and artificial intelligence";
      const text2 = "AI and ML technologies";
      const text3 = "Cooking pasta for dinner";

      const emb1 = await embed(text1);
      const emb2 = await embed(text2);
      const emb3 = await embed(text3);

      // Calculate cosine similarity (embeddings are pre-normalized)
      const similarity12 = dotProduct(emb1, emb2);
      const similarity13 = dotProduct(emb1, emb3);

      // Similar texts (ML/AI) should have higher similarity than dissimilar texts
      expect(similarity12).toBeGreaterThan(similarity13);
    });
  });
});

/**
 * Calculate dot product (cosine similarity for normalized vectors)
 */
function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
