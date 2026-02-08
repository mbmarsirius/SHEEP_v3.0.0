/**
 * SHEEP AI - Episode Extractor Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSessionFile,
  segmentIntoEpisodes,
  extractEpisodesFromFile,
  type ParsedSession,
  type RawMessage,
} from "./episode-extractor.js";

describe("Episode Extractor", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `sheep-extraction-test-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("parseSessionFile", () => {
    it("parses a valid session JSONL file", async () => {
      const sessionFile = join(testDir, "test-session.jsonl");
      const content = [
        JSON.stringify({ type: "session", id: "sess-001", timestamp: "2026-01-28T10:00:00.000Z" }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          message: { role: "user", content: "Hello, how are you?" },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-2",
          message: { role: "assistant", content: "I'm doing well, thank you for asking!" },
        }),
      ].join("\n");

      writeFileSync(sessionFile, content);

      const session = await parseSessionFile(sessionFile);
      expect(session).not.toBeNull();
      expect(session!.sessionId).toBe("sess-001");
      expect(session!.messages).toHaveLength(2);
      expect(session!.messages[0].role).toBe("user");
      expect(session!.messages[1].role).toBe("assistant");
    });

    it("handles array content format", async () => {
      const sessionFile = join(testDir, "array-content.jsonl");
      const content = [
        JSON.stringify({ type: "session", id: "sess-002", timestamp: "2026-01-28T10:00:00.000Z" }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          message: {
            role: "user",
            content: [{ type: "text", text: "What is TypeScript?" }],
          },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-2",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "TypeScript is a typed superset of JavaScript." },
              { type: "text", text: "It adds static typing to the language." },
            ],
          },
        }),
      ].join("\n");

      writeFileSync(sessionFile, content);

      const session = await parseSessionFile(sessionFile);
      expect(session).not.toBeNull();
      expect(session!.messages[0].content).toBe("What is TypeScript?");
      expect(session!.messages[1].content).toContain("TypeScript is a typed superset");
    });

    it("skips system messages", async () => {
      const sessionFile = join(testDir, "system-messages.jsonl");
      const content = [
        JSON.stringify({ type: "session", id: "sess-003", timestamp: "2026-01-28T10:00:00.000Z" }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          message: { role: "system", content: "You are a helpful assistant." },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-2",
          message: { role: "user", content: "Hi!" },
        }),
      ].join("\n");

      writeFileSync(sessionFile, content);

      const session = await parseSessionFile(sessionFile);
      expect(session).not.toBeNull();
      expect(session!.messages).toHaveLength(1);
      expect(session!.messages[0].role).toBe("user");
    });

    it("returns null for empty file", async () => {
      const sessionFile = join(testDir, "empty.jsonl");
      writeFileSync(sessionFile, "");

      const session = await parseSessionFile(sessionFile);
      expect(session).toBeNull();
    });

    it("returns null for file without session header", async () => {
      const sessionFile = join(testDir, "no-header.jsonl");
      const content = JSON.stringify({
        type: "message",
        id: "msg-1",
        message: { role: "user", content: "Hello" },
      });

      writeFileSync(sessionFile, content);

      const session = await parseSessionFile(sessionFile);
      expect(session).toBeNull();
    });
  });

  describe("segmentIntoEpisodes", () => {
    it("creates a single episode from short conversation", () => {
      const session: ParsedSession = {
        sessionId: "sess-001",
        sessionFile: "/test/session.jsonl",
        timestamp: "2026-01-28T10:00:00.000Z",
        messages: [
          { id: "msg-1", role: "user", content: "How do I create a TypeScript project?" },
          {
            id: "msg-2",
            role: "assistant",
            content: "You can use npm init and tsc --init to set up TypeScript.",
          },
          { id: "msg-3", role: "user", content: "Thanks, that worked!" },
        ],
      };

      const episodes = segmentIntoEpisodes(session);
      expect(episodes).toHaveLength(1);
      expect(episodes[0].sourceSessionId).toBe("sess-001");
      expect(episodes[0].sourceMessageIds).toHaveLength(3);
      expect(episodes[0].topic).toBeTruthy();
    });

    it("respects maxMessagesPerEpisode", () => {
      const messages: RawMessage[] = [];
      for (let i = 0; i < 25; i++) {
        messages.push({
          id: `msg-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i} about TypeScript and JavaScript development`,
        });
      }

      const session: ParsedSession = {
        sessionId: "sess-long",
        sessionFile: "/test/long-session.jsonl",
        timestamp: "2026-01-28T10:00:00.000Z",
        messages,
      };

      const episodes = segmentIntoEpisodes(session, { maxMessagesPerEpisode: 10 });
      expect(episodes.length).toBeGreaterThanOrEqual(2);
      // Each episode should have at most 10 messages
      for (const episode of episodes) {
        expect(episode.sourceMessageIds.length).toBeLessThanOrEqual(10);
      }
    });

    it("calculates emotional salience for excited conversation", () => {
      const session: ParsedSession = {
        sessionId: "sess-excited",
        sessionFile: "/test/excited.jsonl",
        timestamp: "2026-01-28T10:00:00.000Z",
        messages: [
          { id: "msg-1", role: "user", content: "This is amazing!! I love it!!!" },
          { id: "msg-2", role: "assistant", content: "I'm glad you're excited! It's fantastic!" },
        ],
      };

      const episodes = segmentIntoEpisodes(session);
      expect(episodes[0].emotionalSalience).toBeGreaterThan(0.5);
    });

    it("calculates high utility for problem-solving conversation", () => {
      const session: ParsedSession = {
        sessionId: "sess-solved",
        sessionFile: "/test/solved.jsonl",
        timestamp: "2026-01-28T10:00:00.000Z",
        messages: [
          { id: "msg-1", role: "user", content: "My code has a bug, it's not working" },
          { id: "msg-2", role: "assistant", content: "Try checking the null reference on line 42" },
          { id: "msg-3", role: "user", content: "That fixed it! Thank you, it's working now!" },
        ],
      };

      const episodes = segmentIntoEpisodes(session);
      expect(episodes[0].utilityScore).toBeGreaterThan(0.6);
    });

    it("extracts keywords from conversation", () => {
      const session: ParsedSession = {
        sessionId: "sess-tech",
        sessionFile: "/test/tech.jsonl",
        timestamp: "2026-01-28T10:00:00.000Z",
        messages: [
          { id: "msg-1", role: "user", content: "How do React hooks work with TypeScript?" },
          {
            id: "msg-2",
            role: "assistant",
            content: "React hooks like useState and useEffect work great with TypeScript generics.",
          },
        ],
      };

      const episodes = segmentIntoEpisodes(session);
      expect(episodes[0].keywords).toContain("react");
      expect(episodes[0].keywords).toContain("typescript");
    });

    it("sets appropriate TTL based on scores", () => {
      // High importance conversation
      const importantSession: ParsedSession = {
        sessionId: "sess-important",
        sessionFile: "/test/important.jsonl",
        timestamp: "2026-01-28T10:00:00.000Z",
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "This is critically important! Remember this forever! It must be saved!",
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "Understood! This is essential and I've noted it. Problem solved perfectly!",
          },
        ],
      };

      const importantEpisodes = segmentIntoEpisodes(importantSession);
      expect(["permanent", "90d"]).toContain(importantEpisodes[0].ttl);

      // Trivial conversation
      const trivialSession: ParsedSession = {
        sessionId: "sess-trivial",
        sessionFile: "/test/trivial.jsonl",
        timestamp: "2026-01-28T10:00:00.000Z",
        messages: [
          { id: "msg-1", role: "user", content: "hi" },
          { id: "msg-2", role: "assistant", content: "hello" },
        ],
      };

      const trivialEpisodes = segmentIntoEpisodes(trivialSession);
      expect(["7d", "30d"]).toContain(trivialEpisodes[0].ttl);
    });
  });

  describe("extractEpisodesFromFile", () => {
    it("extracts episodes from a real JSONL file", async () => {
      const sessionFile = join(testDir, "real-session.jsonl");
      const content = [
        JSON.stringify({ type: "session", id: "real-sess", timestamp: "2026-01-28T10:00:00.000Z" }),
        JSON.stringify({
          type: "message",
          id: "msg-1",
          message: {
            role: "user",
            content: "Can you help me understand async/await in JavaScript?",
          },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-2",
          message: {
            role: "assistant",
            content:
              "Of course! Async/await is syntactic sugar over Promises. It makes asynchronous code look synchronous.",
          },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-3",
          message: { role: "user", content: "That makes sense! Can you show me an example?" },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-4",
          message: {
            role: "assistant",
            content:
              "```javascript\nasync function fetchData() {\n  const response = await fetch(url);\n  return response.json();\n}\n```",
          },
        }),
        JSON.stringify({
          type: "message",
          id: "msg-5",
          message: { role: "user", content: "Perfect! Thanks, I understand now!" },
        }),
      ].join("\n");

      writeFileSync(sessionFile, content);

      const episodes = await extractEpisodesFromFile(sessionFile);
      expect(episodes.length).toBeGreaterThanOrEqual(1);

      const episode = episodes[0];
      expect(episode.sourceSessionId).toBe("real-sess");
      expect(episode.participants).toContain("user");
      expect(episode.participants).toContain("assistant");
      expect(episode.keywords.length).toBeGreaterThan(0);
      expect(episode.utilityScore).toBeGreaterThan(0.4); // Code example = high utility
    });

    it("returns empty array for non-existent file", async () => {
      const episodes = await extractEpisodesFromFile("/nonexistent/file.jsonl");
      expect(episodes).toEqual([]);
    });
  });
});
