/**
 * Moltbook API Client
 *
 * Handles all communication with Moltbook API.
 * Reference: https://www.moltbook.com/developer
 */

import { z } from "zod";

// ============ TYPES ============

export const MoltbookAgentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    profile: z.string().optional(),
    karma: z.number().optional().default(0),
    verified: z.boolean().optional().default(false),
    postsCount: z.number().optional().default(0),
    commentsCount: z.number().optional().default(0),
    followersCount: z.number().optional().default(0),
    owner: z
      .object({
        id: z.string().optional(),
        handle: z.string().optional(),
        verified: z.boolean().optional(),
      })
      .optional(),
    createdAt: z.string().optional(),
  })
  .passthrough(); // Allow extra fields

export type MoltbookAgent = z.infer<typeof MoltbookAgentSchema>;

export const MoltbookPostSchema = z
  .object({
    id: z.string(),
    submolt: z
      .union([
        z.string(),
        z
          .object({
            id: z.string().optional(),
            name: z.string().optional(),
            slug: z.string().optional(),
          })
          .passthrough(),
      ])
      .optional(),
    title: z.string(),
    content: z.string(),
    author: MoltbookAgentSchema.optional(),
    upvotes: z.number().optional().default(0),
    downvotes: z.number().optional().default(0),
    commentsCount: z.number().optional().default(0),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough(); // Allow extra fields

export type MoltbookPost = z.infer<typeof MoltbookPostSchema>;

export const MoltbookDMSchema = z.object({
  id: z.string(),
  from: MoltbookAgentSchema,
  content: z.string(),
  read: z.boolean(),
  createdAt: z.string(),
});

export type MoltbookDM = z.infer<typeof MoltbookDMSchema>;

export interface MoltbookClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface CreatePostOptions {
  submolt: string;
  title: string;
  content: string;
  tags?: string[];
}

export interface ListPostsOptions {
  submolt?: string;
  author?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
  sortBy?: "new" | "top" | "hot";
}

// ============ CLIENT ============

export class MoltbookClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config: MoltbookClientConfig) {
    this.baseUrl = config.baseUrl ?? "https://www.moltbook.com/api/v1";
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 30000;
  }

  // ============ INTERNAL ============

  private async fetch<T>(
    path: string,
    options?: RequestInit & { schema?: z.ZodSchema<T> },
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "SHEEP-Federation/1.0",
          ...options?.headers,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new MoltbookAPIError(response.status, error);
      }

      const responseData = await response.json();

      // Moltbook API wraps responses in {success: true, ...}
      // Extract the actual data based on endpoint
      let data: any = responseData;

      if (responseData.success === true) {
        // Extract nested data based on response structure
        if (responseData.agent) {
          data = responseData.agent;
        } else if (responseData.posts) {
          data = responseData.posts;
        } else if (responseData.post) {
          // Single post response
          data = responseData.post;
        } else if (responseData.messages) {
          // For DMs, return the messages array
          data = responseData.messages.items || [];
        } else {
          // Fallback: return the whole response if no known structure
          data = responseData;
        }
      }

      if (options?.schema) {
        return options.schema.parse(data);
      }

      return data as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ============ AGENTS ============

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<MoltbookAgent> {
    return this.fetch(`/agents/${agentId}`, {
      schema: MoltbookAgentSchema,
    });
  }

  /**
   * Get current agent (self)
   */
  async getSelf(): Promise<MoltbookAgent> {
    return this.fetch(`/agents/me`, {
      schema: MoltbookAgentSchema,
    });
  }

  /**
   * Search agents
   * Note: This endpoint may not be available in the current API
   */
  async searchAgents(query: string, limit = 20): Promise<MoltbookAgent[]> {
    // Endpoint doesn't exist, return empty array
    // In production, would use a different endpoint or search via posts
    return [];
  }

  // ============ POSTS ============

  /**
   * Create a post
   */
  async createPost(options: CreatePostOptions): Promise<MoltbookPost> {
    return this.fetch(`/posts`, {
      method: "POST",
      body: JSON.stringify({
        submolt: options.submolt,
        title: options.title,
        content: options.content,
        tags: options.tags ?? [],
      }),
      schema: MoltbookPostSchema,
    });
  }

  /**
   * Get post by ID
   */
  async getPost(postId: string): Promise<MoltbookPost> {
    return this.fetch(`/posts/${postId}`, {
      schema: MoltbookPostSchema,
    });
  }

  /**
   * List posts
   */
  async listPosts(options?: ListPostsOptions): Promise<MoltbookPost[]> {
    const params = new URLSearchParams();
    if (options?.submolt) params.set("submolt", options.submolt);
    if (options?.author) params.set("author", options.author);
    if (options?.tags) params.set("tags", options.tags.join(","));
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    if (options?.sortBy) params.set("sort", options.sortBy);

    return this.fetch(`/posts?${params}`, {
      schema: z.array(MoltbookPostSchema),
    });
  }

  /**
   * Get posts from a submolt
   */
  async getSubmoltPosts(
    submolt: string,
    options?: Omit<ListPostsOptions, "submolt">,
  ): Promise<MoltbookPost[]> {
    return this.listPosts({ ...options, submolt });
  }

  // ============ DMs ============

  /**
   * Check for new DMs
   */
  async checkDMs(): Promise<MoltbookDM[]> {
    // The API returns {success: true, messages: {items: [...]}}
    const response = await this.fetch<{ success: boolean; messages: { items: any[] } }>(
      `/agents/dm/check`,
    );
    if (response.success && response.messages?.items) {
      return z.array(MoltbookDMSchema).parse(response.messages.items);
    }
    return [];
  }

  /**
   * Send DM to agent
   */
  async sendDM(toAgentId: string, content: string): Promise<void> {
    await this.fetch(`/agents/${toAgentId}/dm`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  // ============ COMMENTS ============

  /**
   * Add comment to post
   */
  async addComment(postId: string, content: string): Promise<void> {
    await this.fetch(`/posts/${postId}/comments`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
  }

  /**
   * Get comments on post
   */
  async getComments(postId: string): Promise<any[]> {
    return this.fetch(`/posts/${postId}/comments`);
  }
}

// ============ ERRORS ============

export class MoltbookAPIError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Moltbook API error (${status}): ${body}`);
    this.name = "MoltbookAPIError";
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}
