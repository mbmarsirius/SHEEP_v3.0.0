/**
 * SHEEP Federation Protocol Messages
 */

import { z } from "zod";

// ============ BASE MESSAGE ============

export const BaseMessageSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  version: z.literal("1.0"),
  timestamp: z.string().datetime(),
  senderId: z.string(),
  signature: z.string().optional(),
});

// ============ ANNOUNCE ============

export const AnnounceMessageSchema = BaseMessageSchema.extend({
  type: z.literal("ANNOUNCE"),
  payload: z.object({
    capabilities: z.object({
      facts: z.boolean(),
      causal: z.boolean(),
      procedures: z.boolean(),
      templates: z.boolean(),
    }),
    version: z.string(),
    tier: z.enum(["free", "pro", "enterprise"]),
    p2pEndpoint: z.string().optional(),
    publicKey: z.string().optional(),
  }),
});

export type AnnounceMessage = z.infer<typeof AnnounceMessageSchema>;

// ============ TEMPLATE_OFFER ============

export const TemplateOfferMessageSchema = BaseMessageSchema.extend({
  type: z.literal("TEMPLATE_OFFER"),
  payload: z.object({
    templateId: z.string().uuid(),
    templateType: z.enum(["fact", "causal", "procedure", "heuristic"]),
    category: z.string(),
    preview: z.string().max(200), // Truncated preview
    confidence: z.number().min(0).max(1),
    usageCount: z.number().int().min(0),
  }),
});

export type TemplateOfferMessage = z.infer<typeof TemplateOfferMessageSchema>;

// ============ TEMPLATE_REQUEST ============

export const TemplateRequestMessageSchema = BaseMessageSchema.extend({
  type: z.literal("TEMPLATE_REQUEST"),
  payload: z.object({
    templateId: z.string().uuid(),
    requesterId: z.string(),
  }),
});

export type TemplateRequestMessage = z.infer<typeof TemplateRequestMessageSchema>;

// ============ TEMPLATE_EXCHANGE ============

export const TemplateExchangeMessageSchema = BaseMessageSchema.extend({
  type: z.literal("TEMPLATE_EXCHANGE"),
  payload: z.object({
    templateId: z.string().uuid(),
    templateType: z.enum(["fact", "causal", "procedure", "heuristic"]),
    content: z.string(), // Anonymized & optionally encrypted
    encrypted: z.boolean(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.string()).max(10),
  }),
});

export type TemplateExchangeMessage = z.infer<typeof TemplateExchangeMessageSchema>;

// ============ ACK ============

export const AckMessageSchema = BaseMessageSchema.extend({
  type: z.literal("ACK"),
  payload: z.object({
    originalMessageId: z.string().uuid(),
    status: z.enum(["received", "accepted", "rejected"]),
    reason: z.string().optional(),
  }),
});

export type AckMessage = z.infer<typeof AckMessageSchema>;

// ============ UNION ============

export const FederationMessageSchema = z.discriminatedUnion("type", [
  AnnounceMessageSchema,
  TemplateOfferMessageSchema,
  TemplateRequestMessageSchema,
  TemplateExchangeMessageSchema,
  AckMessageSchema,
]);

export type FederationMessage = z.infer<typeof FederationMessageSchema>;
