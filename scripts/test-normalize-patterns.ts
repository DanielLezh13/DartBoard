/**
 * Test script to verify regex patterns against actual database examples
 */

import Database from "better-sqlite3";
import path from "path";
import { normalizeText } from "../lib/normalizeText";

const dbPath = path.join(process.cwd(), "dartz_memory.db");

// Test cases from your screenshots
const testCases = [
  "citeturn0search24",
  "cite turn0search1turn0search3",
  "cite turn0search12 turn0search22",
  'entity≡["people","Andrew Cuomo",0]',
  'entity["place", "Thailand", 0]',
  "cite turn0search5",
  "citeturn0search24≡",
  'entity ["fragrance", "Aventus", 0]',
  "cite turn0search10 turn0search22 turn0search8",
];

function testPatterns() {
  console.log("=== Testing Current Patterns Against Known Examples ===\n");
  
  // Test current patterns
  testCases.forEach((testCase) => {
    const cleaned = normalizeText(testCase, false);
    const hasCite = cleaned.includes("cite") || cleaned.includes("turn");
    const hasEntity = cleaned.includes("entity") && cleaned.includes("[");
    const passed = !hasCite && !hasEntity;
    console.log(`${passed ? "✅" : "❌"} "${testCase}"`);
    if (!passed) {
      console.log(`   → Result: "${cleaned}"`);
      console.log(`   → Still has: ${hasCite ? "cite " : ""}${hasEntity ? "entity" : ""}`);
    }
  });
  
  console.log("\n=== Testing Against Real Database Examples ===\n");
  
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  
  // Get actual examples from database
  const examples = db
    .prepare(`
      SELECT id, text 
      FROM archive_messages 
      WHERE (text LIKE '%cite%' OR text LIKE '%entity%')
        AND (text LIKE '%turn%' OR text LIKE '%entity[%')
      LIMIT 10
    `)
    .all() as Array<{ id: number; text: string }>;
  
  console.log(`Found ${examples.length} examples in database\n`);
  
  let passed = 0;
  let failed = 0;
  
  examples.forEach((row, idx) => {
    const before = row.text;
    const after = normalizeText(before, false);
    const hasArtifacts = after.includes("cite") || (after.includes("entity") && after.includes("["));
    
    if (hasArtifacts) {
      failed++;
      console.log(`\n❌ Example ${row.id} (${idx + 1}/${examples.length}):`);
      
      // Find and show the problematic parts
      const citeMatches = before.matchAll(/cite[^\s]*turn\d+\w+/g);
      const entityMatches = before.matchAll(/entity[^\[]*\[[^\]]*\]/gi);
      
      for (const match of citeMatches) {
        const pattern = match[0];
        const stillInAfter = after.includes(pattern);
        console.log(`   Cite pattern: "${pattern}" ${stillInAfter ? "❌ NOT REMOVED" : "✅ removed"}`);
      }
      
      for (const match of entityMatches) {
        const pattern = match[0];
        const stillInAfter = after.includes(pattern);
        console.log(`   Entity pattern: "${pattern}" ${stillInAfter ? "❌ NOT REMOVED" : "✅ removed"}`);
      }
      
      // Show excerpt around the problem
      const citeIndex = before.indexOf("cite");
      const entityIndex = before.indexOf("entity");
      const problemIndex = citeIndex >= 0 ? citeIndex : entityIndex;
      
      if (problemIndex >= 0) {
        const excerptStart = Math.max(0, problemIndex - 50);
        const excerptEnd = Math.min(before.length, problemIndex + 200);
        console.log(`   Before excerpt: ...${before.substring(excerptStart, excerptEnd)}...`);
        
        const afterExcerptStart = Math.max(0, problemIndex - 50);
        const afterExcerptEnd = Math.min(after.length, problemIndex + 200);
        console.log(`   After excerpt:  ...${after.substring(afterExcerptStart, afterExcerptEnd)}...`);
      }
    } else {
      passed++;
      if (idx < 3) {
        console.log(`✅ Example ${row.id}: Cleaned successfully`);
      }
    }
  });
  
  console.log(`\n=== Summary ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total: ${examples.length}`);
  
  db.close();
}

testPatterns();

