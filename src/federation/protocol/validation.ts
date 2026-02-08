/**
 * Schema Validation for Federation Messages
 */

import { z } from "zod";
import { FederationMessageSchema, FederationMessage } from "./messages.js";

/**
 * Validate a federation message against its schema
 */
export function validateMessage(data: unknown): {
  valid: boolean;
  message?: FederationMessage;
  error?: string;
} {
  try {
    const message = FederationMessageSchema.parse(data);
    return { valid: true, message };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        valid: false,
        error: `Validation failed: ${error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
      };
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown validation error",
    };
  }
}

/**
 * Validate message type specifically
 */
export function validateMessageType<T extends FederationMessage["type"]>(
  data: unknown,
  expectedType: T,
): { valid: boolean; message?: Extract<FederationMessage, { type: T }>; error?: string } {
  const result = validateMessage(data);
  if (!result.valid || !result.message) {
    return { valid: false, error: result.error };
  }

  if (result.message.type !== expectedType) {
    return {
      valid: false,
      error: `Expected message type ${expectedType}, got ${result.message.type}`,
    };
  }

  return {
    valid: true,
    message: result.message as Extract<FederationMessage, { type: T }>,
  };
}
