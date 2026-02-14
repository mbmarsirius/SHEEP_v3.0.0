#!/usr/bin/env node
import * as fs from "fs";

// Load .env
const envContent = fs.readFileSync(".env", "utf-8");
for (const line of envContent.split("\n")) {
  const eq = line.indexOf("=");
  if (eq > 0 && !line.startsWith("#")) {
    const k = line.substring(0, eq).trim();
    let v = line.substring(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

import { GoogleGenerativeAI } from "@google/generative-ai";

async function main() {
  console.log("GOOGLE_AI_API_KEY set:", !!process.env.GOOGLE_AI_API_KEY);
  
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY!);
  // Use gemini-2.0-flash (not 2.5 which has thinking mode that hangs)
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  
  console.log("Testing Gemini 2.0 Flash...");
  const start = Date.now();
  const result = await model.generateContent('Return JSON only: {"greeting":"hello"}');
  console.log(`Response in ${Date.now() - start}ms:`);
  console.log(result.response.text().substring(0, 300));
}

main().catch(err => { console.error("ERROR:", err.message); process.exit(1); });
