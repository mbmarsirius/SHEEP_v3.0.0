/**
 * HaluMem extraction CLI command
 * Run SHEEP extraction on HaluMem test cases
 */

import * as fs from "fs";
import { join } from "path";
import { extractFactsWithLLM, createSheepLLMProvider } from "../extraction/llm-extractor.js";

type TestCase = {
  id: string;
  category: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  expectedFacts: Array<{ subject: string; predicate: string; object: string; category: string }>;
  expectedCausalLinks: any[];
};

async function main() {
  console.log("🐑 SHEEP HaluMem Extraction Test");
  console.log("=".repeat(60));

  // Load test cases
  const testCasesPath =
    "/Users/mustafabulutoglulari/Desktop/countingsheep/halumem_benchmark/halumem-test-cases.json";
  const testCases: TestCase[] = JSON.parse(fs.readFileSync(testCasesPath, "utf-8"));

  console.log(`Loaded ${testCases.length} test cases\n`);

  // Create LLM provider
  const llmProvider = await createSheepLLMProvider("extraction");
  console.log("✅ LLM provider ready");
  console.log(`   Provider name: ${llmProvider.name}`);
  console.log(`   Has complete: ${typeof llmProvider.complete}\n`);

  const results: any[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`[${i + 1}/${testCases.length}] ${tc.id}...`);

    try {
      const startTime = Date.now();

      // Convert messages to conversation text
      const conversationText = tc.messages
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n");

      // Run SHEEP extraction (args: llm, conversationText, episodeId)
      const extractedFacts = await extractFactsWithLLM(
        llmProvider,
        conversationText,
        `halumem-${tc.id}`,
      );

      const duration = Date.now() - startTime;
      console.log(`  Extracted ${extractedFacts.length} facts in ${duration}ms`);

      // Print extracted facts
      for (const f of extractedFacts) {
        console.log(`    → ${f.subject} ${f.predicate} ${f.object}`);
      }

      // Compare with expected
      let matched = 0;

      for (const expected of tc.expectedFacts) {
        const expectedStr =
          `${expected.subject} ${expected.predicate} ${expected.object}`.toLowerCase();

        for (const extracted of extractedFacts) {
          const extractedStr =
            `${extracted.subject} ${extracted.predicate} ${extracted.object}`.toLowerCase();

          // Check for overlap in key terms
          const expectedTerms = expectedStr.split(/\s+/).filter((t) => t.length > 2);
          const extractedTerms = extractedStr.split(/\s+/).filter((t) => t.length > 2);

          const overlap = expectedTerms.filter((t) =>
            extractedTerms.some((e) => e.includes(t) || t.includes(e)),
          );

          if (overlap.length >= 2) {
            matched++;
            break;
          }
        }
      }

      // Metrics
      const precision = extractedFacts.length > 0 ? matched / extractedFacts.length : 0;
      const recall = tc.expectedFacts.length > 0 ? matched / tc.expectedFacts.length : 1;
      const f1 = precision + recall > 0 ? (2 * (precision * recall)) / (precision + recall) : 0;

      console.log(`  Expected: ${tc.expectedFacts.length}, Matched: ${matched}`);
      console.log(
        `  P: ${(precision * 100).toFixed(0)}%, R: ${(recall * 100).toFixed(0)}%, F1: ${(f1 * 100).toFixed(0)}%\n`,
      );

      results.push({
        id: tc.id,
        expected: tc.expectedFacts.length,
        extracted: extractedFacts.length,
        matched,
        precision,
        recall,
        f1,
        duration,
        extractedFacts: extractedFacts.map((f) => ({ s: f.subject, p: f.predicate, o: f.object })),
      });
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}\n`);
      results.push({ id: tc.id, error: error.message });
    }
  }

  // Aggregate
  console.log("=".repeat(60));
  console.log("AGGREGATE RESULTS");
  console.log("=".repeat(60));

  const valid = results.filter((r) => !r.error);

  const totalExp = valid.reduce((s, r) => s + r.expected, 0);
  const totalExt = valid.reduce((s, r) => s + r.extracted, 0);
  const totalMatch = valid.reduce((s, r) => s + r.matched, 0);

  const microP = totalExt > 0 ? totalMatch / totalExt : 0;
  const microR = totalExp > 0 ? totalMatch / totalExp : 0;
  const microF1 = microP + microR > 0 ? (2 * (microP * microR)) / (microP + microR) : 0;

  console.log(`\nTest Cases: ${valid.length}`);
  console.log(`Total Expected: ${totalExp}`);
  console.log(`Total Extracted: ${totalExt}`);
  console.log(`Total Matched: ${totalMatch}`);

  console.log(`\n📊 Micro-Averaged Results:`);
  console.log(`   Precision: ${(microP * 100).toFixed(1)}%`);
  console.log(`   Recall:    ${(microR * 100).toFixed(1)}%`);
  console.log(`   F1:        ${(microF1 * 100).toFixed(1)}%`);

  console.log(`\n📋 Comparison:`);
  console.log(`   SHEEP Golden Dataset: 88.5% F1`);
  console.log(`   HaluMem (this run):   ${(microF1 * 100).toFixed(1)}% F1`);

  // Save results
  const outputPath =
    "/Users/mustafabulutoglulari/Desktop/countingsheep/halumem_benchmark/sheep-halumem-results.json";
  fs.writeFileSync(
    outputPath,
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
  );
  console.log(`\n✅ Results saved to ${outputPath}`);
}

main().catch(console.error);
