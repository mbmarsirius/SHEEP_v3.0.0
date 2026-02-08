/**
 * SHEEP AI - MemScene Topic Clustering (V3 Spec)
 *
 * Groups related episodes/facts into thematic clusters (scenes).
 * Enables scene-level retrieval for multi-hop questions like
 * "What happened during the Italy trip?"
 *
 * Algorithm: Online incremental clustering with cosine similarity.
 * Inspired by EverMemOS ClusterManager.
 *
 * @module sheep/memory/cluster
 */

import { Type, type Static } from "@sinclair/typebox";
import { createSubsystemLogger } from "../stubs/logging.js";
import { generateId, now } from "./schema.js";
import { cosineSimilarity } from "./semantic-search.js";

const log = createSubsystemLogger("sheep");

// =============================================================================
// TYPES
// =============================================================================

/** A cluster of related memories (MemScene) */
export const MemoryClusterSchema = Type.Object({
  /** Unique cluster identifier */
  id: Type.String(),
  /** Average embedding vector (centroid) */
  centroid: Type.Array(Type.Number()),
  /** Number of members in this cluster */
  memberCount: Type.Number(),
  /** Member IDs (episode or fact IDs) */
  memberIds: Type.Array(Type.String()),
  /** Member types corresponding to memberIds */
  memberTypes: Type.Array(Type.String()),
  /** LLM-generated theme label for this cluster */
  theme: Type.String(),
  /** Keywords representative of this cluster */
  keywords: Type.Array(Type.String()),
  /** Timestamp of most recent member */
  lastTimestamp: Type.String(),
  /** When this cluster was created */
  createdAt: Type.String(),
  /** When this cluster was last updated */
  updatedAt: Type.String(),
});

export type MemoryCluster = Static<typeof MemoryClusterSchema>;

/** Configuration for the clustering engine */
export type ClusterConfig = {
  /** Minimum cosine similarity to join a cluster (default: 0.7) */
  similarityThreshold?: number;
  /** Maximum number of clusters (default: 100) */
  maxClusters?: number;
  /** Minimum members for a cluster to be considered valid (default: 2) */
  minClusterSize?: number;
};

/** Result of assigning an item to a cluster */
export type ClusterAssignment = {
  clusterId: string;
  similarity: number;
  isNew: boolean;
};

// =============================================================================
// CLUSTERING ENGINE
// =============================================================================

const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
const DEFAULT_MAX_CLUSTERS = 100;
const DEFAULT_MIN_CLUSTER_SIZE = 2;

/**
 * Online incremental clustering engine.
 *
 * Process for each new embedding:
 * 1. Compute cosine similarity to every existing cluster centroid
 * 2. If max similarity > threshold: add to that cluster, update centroid
 * 3. If max similarity < threshold: create new cluster
 * 4. If max clusters reached: merge two closest clusters, then add
 */
export class ClusterEngine {
  private clusters: Map<string, MemoryCluster> = new Map();
  private config: Required<ClusterConfig>;

  constructor(config?: ClusterConfig) {
    this.config = {
      similarityThreshold: config?.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD,
      maxClusters: config?.maxClusters ?? DEFAULT_MAX_CLUSTERS,
      minClusterSize: config?.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE,
    };
  }

  /** Load existing clusters (e.g., from database) */
  loadClusters(clusters: MemoryCluster[]): void {
    this.clusters.clear();
    for (const cluster of clusters) {
      this.clusters.set(cluster.id, cluster);
    }
    log.debug("Loaded clusters", { count: clusters.length });
  }

  /** Get all clusters */
  getClusters(): MemoryCluster[] {
    return Array.from(this.clusters.values());
  }

  /** Get valid clusters (above minimum size) */
  getValidClusters(): MemoryCluster[] {
    return this.getClusters().filter((c) => c.memberCount >= this.config.minClusterSize);
  }

  /** Get cluster by ID */
  getCluster(id: string): MemoryCluster | undefined {
    return this.clusters.get(id);
  }

  /**
   * Assign an item (episode/fact) to a cluster.
   *
   * @param embedding - The item's embedding vector
   * @param itemId - The item's ID
   * @param itemType - "episode" or "fact"
   * @param theme - Optional theme hint from LLM
   * @param keywords - Optional keywords
   * @returns Which cluster the item was assigned to
   */
  assignToCluster(
    embedding: number[],
    itemId: string,
    itemType: string,
    theme?: string,
    keywords?: string[],
  ): ClusterAssignment {
    if (embedding.length === 0) {
      // No embedding; create a singleton cluster
      return this.createNewCluster(embedding, itemId, itemType, theme ?? "unknown", keywords ?? []);
    }

    // Find nearest cluster
    let bestCluster: MemoryCluster | null = null;
    let bestSimilarity = -1;

    for (const cluster of this.clusters.values()) {
      if (cluster.centroid.length === 0) continue;
      if (cluster.centroid.length !== embedding.length) continue;

      const similarity = cosineSimilarity(embedding, cluster.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }

    // Above threshold: add to existing cluster
    if (bestCluster && bestSimilarity >= this.config.similarityThreshold) {
      this.addToCluster(bestCluster, embedding, itemId, itemType, keywords ?? []);
      log.debug("Assigned to existing cluster", {
        clusterId: bestCluster.id,
        theme: bestCluster.theme,
        similarity: bestSimilarity.toFixed(3),
      });
      return {
        clusterId: bestCluster.id,
        similarity: bestSimilarity,
        isNew: false,
      };
    }

    // At max clusters: merge two closest, then create new
    if (this.clusters.size >= this.config.maxClusters) {
      this.mergeClosestClusters();
    }

    // Create new cluster
    return this.createNewCluster(embedding, itemId, itemType, theme ?? "unknown", keywords ?? []);
  }

  /**
   * Find clusters relevant to a query embedding.
   *
   * @param queryEmbedding - The query embedding
   * @param topK - Number of clusters to return (default: 3)
   * @returns Matching clusters sorted by similarity
   */
  findRelevantClusters(
    queryEmbedding: number[],
    topK: number = 3,
  ): Array<{ cluster: MemoryCluster; similarity: number }> {
    const scored: Array<{ cluster: MemoryCluster; similarity: number }> = [];

    for (const cluster of this.clusters.values()) {
      if (cluster.centroid.length === 0 || cluster.centroid.length !== queryEmbedding.length) {
        continue;
      }
      const similarity = cosineSimilarity(queryEmbedding, cluster.centroid);
      scored.push({ cluster, similarity });
    }

    return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }

  // ---------------------------------------------------------------------------
  // PRIVATE HELPERS
  // ---------------------------------------------------------------------------

  private createNewCluster(
    embedding: number[],
    itemId: string,
    itemType: string,
    theme: string,
    keywords: string[],
  ): ClusterAssignment {
    const id = generateId("cl");
    const timestamp = now();
    const cluster: MemoryCluster = {
      id,
      centroid: [...embedding],
      memberCount: 1,
      memberIds: [itemId],
      memberTypes: [itemType],
      theme,
      keywords,
      lastTimestamp: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.clusters.set(id, cluster);
    log.debug("Created new cluster", { clusterId: id, theme });

    return { clusterId: id, similarity: 1.0, isNew: true };
  }

  private addToCluster(
    cluster: MemoryCluster,
    embedding: number[],
    itemId: string,
    itemType: string,
    keywords: string[],
  ): void {
    // Update centroid: running average
    const n = cluster.memberCount;
    const newCentroid = cluster.centroid.map((val, i) => {
      const embVal = embedding[i] ?? 0;
      return (val * n + embVal) / (n + 1);
    });

    cluster.centroid = newCentroid;
    cluster.memberCount += 1;
    cluster.memberIds.push(itemId);
    cluster.memberTypes.push(itemType);
    cluster.lastTimestamp = now();
    cluster.updatedAt = now();

    // Merge keywords (deduplicate)
    const allKeywords = new Set([...cluster.keywords, ...keywords]);
    cluster.keywords = Array.from(allKeywords).slice(0, 20); // Keep top 20
  }

  private mergeClosestClusters(): void {
    const clusterList = Array.from(this.clusters.values());
    if (clusterList.length < 2) return;

    let bestPair: [MemoryCluster, MemoryCluster] | null = null;
    let bestSim = -1;

    for (let i = 0; i < clusterList.length; i++) {
      for (let j = i + 1; j < clusterList.length; j++) {
        const a = clusterList[i];
        const b = clusterList[j];
        if (a.centroid.length === 0 || b.centroid.length === 0) continue;
        if (a.centroid.length !== b.centroid.length) continue;

        const sim = cosineSimilarity(a.centroid, b.centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestPair = [a, b];
        }
      }
    }

    if (!bestPair) return;

    const [a, b] = bestPair;
    // Merge b into a
    const totalN = a.memberCount + b.memberCount;
    a.centroid = a.centroid.map((val, i) => {
      const bVal = b.centroid[i] ?? 0;
      return (val * a.memberCount + bVal * b.memberCount) / totalN;
    });
    a.memberCount = totalN;
    a.memberIds.push(...b.memberIds);
    a.memberTypes.push(...b.memberTypes);
    const mergedKeywords = new Set([...a.keywords, ...b.keywords]);
    a.keywords = Array.from(mergedKeywords).slice(0, 20);
    a.updatedAt = now();

    this.clusters.delete(b.id);
    log.debug("Merged clusters", { kept: a.id, removed: b.id, similarity: bestSim.toFixed(3) });
  }
}

/**
 * Serialize clusters for database storage (JSON).
 */
export function serializeClusters(clusters: MemoryCluster[]): string {
  return JSON.stringify(clusters);
}

/**
 * Deserialize clusters from database storage.
 */
export function deserializeClusters(json: string): MemoryCluster[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed as MemoryCluster[];
  } catch {
    return [];
  }
}
