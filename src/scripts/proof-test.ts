#!/usr/bin/env node
/**
 * SHEEP AI - 5 Dakikalık Kanıt Testi
 *
 * Soru: "Doğru yolda mıyım? Buna değer mi?"
 * Bu script: 5 test senaryosu, ~$1 maliyet, ~90 saniye.
 * Sonuç: Fact F1 > %60 = evet, devam et.
 *
 * Kullanım:
 *   OPENROUTER_API_KEY=sk-xxx npx tsx src/scripts/proof-test.ts
 *
 * Gerekli: OPENROUTER_API_KEY veya .env'de API key
 */

import {
  measureExtractionAccuracy,
  formatAccuracyReport,
} from "../tests/accuracy/extraction-accuracy.js";

const LIMIT = parseInt(process.env.SHEEP_PROOF_LIMIT ?? "5", 10); // 5 = ~$1, 20 = ~$4

async function main() {
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SHEEP - 5 DAKİKALIK KANIT TESTİ");
  console.log("  Soru: Bu memory yaklaşımı işe yarıyor mu?");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`\n  ${LIMIT} test senaryosu çalıştırılıyor (~$${LIMIT * 0.1}-${LIMIT * 0.2} maliyet)...\n`);

  const start = Date.now();

  const report = await measureExtractionAccuracy({
    limit: LIMIT,
    useMock: false,
    verbose: true,
    onProgress: (cur, total, id) => {
      process.stdout.write(`  [${cur}/${total}] ${id}...\r`);
    },
  });

  const durationSec = ((Date.now() - start) / 1000).toFixed(0);

  console.log("\n\n--- SONUÇ ---\n");
  console.log(formatAccuracyReport(report));

  // Karar kriteri
  const factF1 = report.overall.factF1;
  const causalF1 = report.overall.causalF1;
  const factOk = factF1 >= 0.6;
  const causalOk = causalF1 >= 0.4; // Causal daha zor

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  KARAR:");
  console.log("═══════════════════════════════════════════════════════════\n");

  if (factOk) {
    console.log("  ✅ Fact çıkarımı çalışıyor (F1 ≥ %60)");
    console.log("  → YAKLAŞIM DOĞRU. Devam etmeye değer.\n");
  } else {
    console.log("  ⚠️  Fact F1 düşük (%" + (factF1 * 100).toFixed(0) + ")");
    console.log("  → Prompt/model tuning gerekebilir.\n");
  }

  if (causalOk) {
    console.log("  ✅ Causal çıkarımı makul (F1 ≥ %40)");
  } else {
    console.log("  ⚠️  Causal F1 düşük - beklenen, daha zor bir task.");
  }

  console.log(`\n  Süre: ${durationSec} saniye`);
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Test başarısız:", err.message);
  if (err.message?.includes("API") || err.message?.includes("401")) {
    console.error("\n💡 OPENROUTER_API_KEY gerekli. .env veya export ile ver.");
  }
  process.exit(1);
});
