/**
 * Migration script to fix incorrectly parsed timestamps in archive_messages
 * 
 * This fixes timestamps that were multiplied by 1000 when they were already in milliseconds,
 * resulting in dates in the year 57,857+.
 * 
 * Run with: npx tsx scripts/fix-archive-timestamps.ts
 */

import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "dartz_memory.db");

function fixTimestamp(ts: string): string | null {
  try {
    const date = new Date(ts);
    const year = date.getFullYear();
    
    // If year is > 2100, it's likely a bad timestamp (should be 2020-2025 range)
    if (year > 2100) {
      // Try to fix: if it's a number that was multiplied by 1000, divide by 1000
      // First, try to extract the numeric value from the ISO string
      const timestampMs = date.getTime();
      
      // If the timestamp is way too large, divide by 1000
      if (timestampMs > 1e15) {
        const fixedMs = Math.floor(timestampMs / 1000);
        const fixedDate = new Date(fixedMs);
        const fixedYear = fixedDate.getFullYear();
        
        // Only apply fix if the result is in a reasonable range (2000-2100)
        if (fixedYear >= 2000 && fixedYear <= 2100) {
          return fixedDate.toISOString();
        }
      }
      
      // Alternative: if the ISO string itself contains a huge year, try parsing differently
      // This handles cases where the string is like "+057856-05-12T..."
      if (ts.match(/^\+?\d{5,}/)) {
        // Try to extract and fix the numeric timestamp
        // For now, return null to skip this row (user can re-import)
        console.warn(`Skipping unparseable timestamp: ${ts}`);
        return null;
      }
    }
    
    // Fix: If year is 2025 but messages should be from 2024, subtract 1 year
    // This handles cases where timestamps were incorrectly offset by 1 year
    if (year === 2025) {
      const oneYearMs = 365.25 * 24 * 60 * 60 * 1000; // Approximate 1 year in milliseconds
      const fixedDate = new Date(date.getTime() - oneYearMs);
      const fixedYear = fixedDate.getFullYear();
      
      // Only apply if result is in 2024 (reasonable range)
      if (fixedYear === 2024) {
        return fixedDate.toISOString();
      }
    }
    
    // Timestamp looks fine
    return ts;
  } catch (error) {
    console.warn(`Error parsing timestamp ${ts}:`, error);
    return null;
  }
}

function main() {
  console.log("Opening database...");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  console.log("Fetching all archive messages...");
  const messages = db.prepare(`SELECT id, ts FROM archive_messages`).all() as Array<{
    id: number;
    ts: string;
  }>;

  console.log(`Found ${messages.length} messages to check.`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  const updateStmt = db.prepare(`UPDATE archive_messages SET ts = ? WHERE id = ?`);
  const transaction = db.transaction((updates: Array<{ id: number; ts: string }>) => {
    for (const { id, ts } of updates) {
      updateStmt.run(ts, id);
    }
  });

  const updates: Array<{ id: number; ts: string }> = [];

  for (const msg of messages) {
    const fixedTs = fixTimestamp(msg.ts);
    
    if (fixedTs === null) {
      skipped++;
      continue;
    }
    
    if (fixedTs !== msg.ts) {
      updates.push({ id: msg.id, ts: fixedTs });
      fixed++;
    }
  }

  if (updates.length > 0) {
    console.log(`\nFixing ${updates.length} timestamps...`);
    try {
      transaction(updates);
      console.log(`✓ Successfully fixed ${fixed} timestamps.`);
    } catch (error) {
      console.error("Error applying fixes:", error);
      errors++;
    }
  } else {
    console.log("No timestamps need fixing.");
  }

  console.log(`\nSummary:`);
  console.log(`  Fixed: ${fixed}`);
  console.log(`  Skipped (unparseable): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total: ${messages.length}`);

  // Show sample of fixed timestamps
  if (fixed > 0) {
    console.log("\nSample of fixed timestamps:");
    const samples = db
      .prepare(`SELECT id, ts FROM archive_messages ORDER BY ts DESC LIMIT 5`)
      .all() as Array<{ id: number; ts: string }>;
    samples.forEach((s) => {
      const date = new Date(s.ts);
      console.log(`  ID ${s.id}: ${s.ts} (${date.toLocaleString()})`);
    });
  }

  db.close();
  console.log("\nDone!");
}

if (require.main === module) {
  main();
}

export { fixTimestamp };

