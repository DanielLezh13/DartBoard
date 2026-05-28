/**
 * Migration script to clean up [object Object] artifacts and citation objects
 * in existing archive_messages table
 * 
 * Usage: npx tsx scripts/clean-archive-text.ts
 */

import Database from "better-sqlite3";
import path from "path";
import { normalizeText } from "../lib/normalizeText";

const dbPath = path.join(process.cwd(), "dartz_memory.db");

function cleanArchiveText() {
  console.log("Starting archive text cleanup...");
  
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  try {
    // Find all rows that might have issues
    // Check for [object Object], citation objects, entity references, or special symbols
    const problematicRows = db
      .prepare(`
        SELECT id, text 
        FROM archive_messages 
        WHERE text LIKE '%object Object%' 
           OR text LIKE '%[object%'
           OR text LIKE '%✔%'
           OR text LIKE '%🧪%'
           OR text LIKE '%🔍%'
           OR text LIKE '%citation%'
           OR text LIKE '%cite turn%'
           OR text LIKE '%entity[%'
           OR text LIKE '%entity=%'
        ORDER BY id
      `)
      .all() as Array<{ id: number; text: string }>;

    console.log(`Found ${problematicRows.length} rows that may need cleaning...`);

    if (problematicRows.length === 0) {
      console.log("No rows need cleaning. Exiting.");
      db.close();
      return;
    }

    const updateStmt = db.prepare(`
      UPDATE archive_messages 
      SET text = ? 
      WHERE id = ?
    `);

    let cleaned = 0;
    let unchanged = 0;
    let errors = 0;

    // Show a sample of what we're dealing with
    if (problematicRows.length > 0) {
      const sample = problematicRows[0];
      const hasCite = sample.text.includes("cite turn");
      const hasEntity = sample.text.includes("entity[") || sample.text.includes("entity=");
      console.log(`\nSample row check:`);
      console.log(`  Has "cite turn": ${hasCite}`);
      console.log(`  Has "entity[": ${hasEntity}`);
      if (hasCite || hasEntity) {
        const excerpt = sample.text.substring(
          Math.max(0, (sample.text.indexOf("cite") || sample.text.indexOf("entity")) - 50),
          Math.min(sample.text.length, (sample.text.indexOf("cite") || sample.text.indexOf("entity")) + 150)
        );
        console.log(`  Excerpt: ...${excerpt}...`);
      }
    }

    for (const row of problematicRows) {
      try {
        // Normalize the text directly (it's already a string in the database)
        const normalized = normalizeText(row.text);
        
        // Only update if the text actually changed
        if (normalized !== row.text && normalized.trim().length > 0) {
          updateStmt.run(normalized, row.id);
          cleaned++;
          
          if (cleaned <= 5) {
            console.log(`\nRow ${row.id}:`);
            const beforeExcerpt = row.text.includes("cite") || row.text.includes("entity") 
              ? row.text.substring(Math.max(0, row.text.indexOf("cite") || row.text.indexOf("entity") - 30), Math.min(row.text.length, (row.text.indexOf("cite") || row.text.indexOf("entity")) + 100))
              : row.text.substring(0, 100);
            const afterExcerpt = normalized.includes("cite") || normalized.includes("entity")
              ? normalized.substring(Math.max(0, normalized.indexOf("cite") || normalized.indexOf("entity") - 30), Math.min(normalized.length, (normalized.indexOf("cite") || normalized.indexOf("entity")) + 100))
              : normalized.substring(0, 100);
            console.log(`  Before: ...${beforeExcerpt}...`);
            console.log(`  After:  ...${afterExcerpt}...`);
          }
        } else {
          unchanged++;
        }
      } catch (error) {
        console.error(`Error processing row ${row.id}:`, error);
        errors++;
      }
    }

    console.log(`\n✅ Cleanup complete!`);
    console.log(`   Cleaned: ${cleaned} rows`);
    console.log(`   Unchanged: ${unchanged} rows`);
    console.log(`   Errors: ${errors} rows`);

    db.close();
  } catch (error) {
    console.error("Error during cleanup:", error);
    db.close();
    process.exit(1);
  }
}

// Run the cleanup
cleanArchiveText();

