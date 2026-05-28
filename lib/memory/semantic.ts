import { createHash } from "crypto";
import type Database from "better-sqlite3";
import type OpenAI from "openai";

type OwnerContext = {
  column: "user_id" | "guest_id";
  value: string;
};

type SemanticMemoryRow = {
  id: number;
  title: string | null;
  summary: string;
  excerpt: string | null;
  tags: string | null;
  folder_name: string | null;
  embedding_vector: string | null;
  embedding_model: string | null;
  embedding_source_hash: string | null;
};

export type SemanticMemoryMatch = {
  id: number;
  title: string | null;
  summary: string;
  excerpt: string | null;
  folderName: string | null;
  score: number;
};

const MEMORY_EMBEDDING_MODEL =
  process.env.OPENAI_MEMORY_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
const MEMORY_EMBEDDING_BATCH_SIZE = 25;
const MEMORY_SEMANTIC_MAX_MATCHES = 3;
const MEMORY_SEMANTIC_MIN_QUERY_CHARS = 4;
const MEMORY_SEMANTIC_MIN_SCORE = 0.28;
const MEMORY_SEMANTIC_SCORE_WINDOW = 0.08;
const MEMORY_CONTEXT_BODY_MAX_CHARS = 420;

function compactWhitespace(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function buildEmbeddingSourceText(memory: Pick<SemanticMemoryRow, "title" | "summary" | "excerpt" | "tags" | "folder_name">): string {
  const title = compactWhitespace(memory.title);
  const summary = compactWhitespace(memory.summary);
  const excerpt = compactWhitespace(memory.excerpt);
  const tags = compactWhitespace(memory.tags);
  const folderName = compactWhitespace(memory.folder_name);

  const sections = [
    title ? `Title: ${title}` : "",
    folderName ? `Folder: ${folderName}` : "",
    tags ? `Tags: ${tags}` : "",
    excerpt ? `Excerpt: ${excerpt}` : "",
    summary ? `Summary: ${summary}` : "",
  ].filter(Boolean);

  return sections.join("\n");
}

function buildEmbeddingSourceHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function parseEmbeddingVector(raw: string | null | undefined): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    const values = parsed
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter((value) => Number.isFinite(value));
    return values.length === parsed.length && values.length > 0 ? values : null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return -1;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }

  if (normA <= 0 || normB <= 0) {
    return -1;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function createEmbeddings(
  openai: OpenAI,
  inputs: string[],
  model = MEMORY_EMBEDDING_MODEL
): Promise<number[][]> {
  if (inputs.length === 0) {
    return [];
  }

  const response = await openai.embeddings.create({
    model,
    input: inputs,
  });

  return response.data.map((item) => item.embedding);
}

async function refreshMissingEmbeddings(
  db: Database.Database,
  openai: OpenAI,
  staleRows: Array<SemanticMemoryRow & { embeddingSourceText: string; embeddingSourceHash: string }>
): Promise<void> {
  if (staleRows.length === 0) {
    return;
  }

  const updateStmt = db.prepare(
    `UPDATE memories
     SET embedding_vector = ?, embedding_model = ?, embedding_source_hash = ?, embedding_updated_at = ?
     WHERE id = ?`
  );

  for (let index = 0; index < staleRows.length; index += MEMORY_EMBEDDING_BATCH_SIZE) {
    const batch = staleRows.slice(index, index + MEMORY_EMBEDDING_BATCH_SIZE);
    const embeddings = await createEmbeddings(
      openai,
      batch.map((row) => row.embeddingSourceText)
    );
    const updatedAt = new Date().toISOString();

    batch.forEach((row, batchIndex) => {
      updateStmt.run(
        JSON.stringify(embeddings[batchIndex] || []),
        MEMORY_EMBEDDING_MODEL,
        row.embeddingSourceHash,
        updatedAt,
        row.id
      );
    });
  }
}

function buildContextSnippet(match: SemanticMemoryMatch): string {
  const title = compactWhitespace(match.title) || "Untitled";
  const folder = compactWhitespace(match.folderName) || "Unsorted";
  const body = compactWhitespace(match.excerpt) || compactWhitespace(match.summary);

  return [
    `Memory #${match.id}`,
    `Folder: ${folder}`,
    `Title: ${title}`,
    body ? `Summary: ${truncate(body, MEMORY_CONTEXT_BODY_MAX_CHARS)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function syncMemoryEmbeddingById({
  db,
  openai,
  memoryId,
}: {
  db: Database.Database;
  openai: OpenAI;
  memoryId: number;
}): Promise<void> {
  const row = db
    .prepare(
      `SELECT m.id, m.title, m.summary, m.excerpt, m.tags,
              COALESCE(mf.name, 'Unsorted') AS folder_name,
              m.embedding_vector, m.embedding_model, m.embedding_source_hash
       FROM memories m
       LEFT JOIN memory_folders mf ON m.folder_id = mf.id
       WHERE m.id = ?`
    )
    .get(memoryId) as SemanticMemoryRow | undefined;

  if (!row) {
    return;
  }

  const embeddingSourceText = buildEmbeddingSourceText(row);
  const embeddingSourceHash = buildEmbeddingSourceHash(embeddingSourceText);

  if (
    row.embedding_model === MEMORY_EMBEDDING_MODEL &&
    row.embedding_source_hash === embeddingSourceHash &&
    parseEmbeddingVector(row.embedding_vector)
  ) {
    return;
  }

  await refreshMissingEmbeddings(db, openai, [{ ...row, embeddingSourceText, embeddingSourceHash }]);
}

export async function findSemanticMemoryMatches({
  db,
  openai,
  owner,
  query,
  excludeMemoryIds = [],
  limit = MEMORY_SEMANTIC_MAX_MATCHES,
}: {
  db: Database.Database;
  openai: OpenAI;
  owner: OwnerContext;
  query: string;
  excludeMemoryIds?: number[];
  limit?: number;
}): Promise<SemanticMemoryMatch[]> {
  const normalizedQuery = compactWhitespace(query);
  if (normalizedQuery.length < MEMORY_SEMANTIC_MIN_QUERY_CHARS) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT m.id, m.title, m.summary, m.excerpt, m.tags,
              COALESCE(mf.name, 'Unsorted') AS folder_name,
              m.embedding_vector, m.embedding_model, m.embedding_source_hash
       FROM memories m
       LEFT JOIN memory_folders mf ON m.folder_id = mf.id
       WHERE m.${owner.column} = ?
       ORDER BY COALESCE(m.importance, 0) DESC, m.created_at DESC`
    )
    .all(owner.value) as SemanticMemoryRow[];

  if (rows.length === 0) {
    return [];
  }

  const excludedIds = new Set(excludeMemoryIds);
  const rowsWithSource = rows.map((row) => {
    const embeddingSourceText = buildEmbeddingSourceText(row);
    return {
      ...row,
      embeddingSourceText,
      embeddingSourceHash: buildEmbeddingSourceHash(embeddingSourceText),
    };
  });

  const staleRows = rowsWithSource.filter((row) => {
    const parsedVector = parseEmbeddingVector(row.embedding_vector);
    return (
      !parsedVector ||
      row.embedding_model !== MEMORY_EMBEDDING_MODEL ||
      row.embedding_source_hash !== row.embeddingSourceHash
    );
  });

  if (staleRows.length > 0) {
    await refreshMissingEmbeddings(db, openai, staleRows);
  }

  const queryEmbedding = (await createEmbeddings(openai, [normalizedQuery]))[0];
  if (!queryEmbedding) {
    return [];
  }

  const storedEmbeddings = db
    .prepare(
      `SELECT id, embedding_vector
       FROM memories
       WHERE ${owner.column} = ?`
    )
    .all(owner.value) as Array<{ id: number; embedding_vector: string | null }>;
  const embeddingById = new Map(
    storedEmbeddings.map((row) => [row.id, parseEmbeddingVector(row.embedding_vector)])
  );

  const scored = rowsWithSource
    .filter((row) => !excludedIds.has(row.id))
    .map((row) => ({
      row,
      score: cosineSimilarity(embeddingById.get(row.id) || [], queryEmbedding),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    return [];
  }

  const bestScore = scored[0].score;
  const scoreFloor = Math.max(MEMORY_SEMANTIC_MIN_SCORE, bestScore - MEMORY_SEMANTIC_SCORE_WINDOW);

  return scored
    .filter((entry) => entry.score >= scoreFloor)
    .slice(0, Math.max(1, limit))
    .map(({ row, score }) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      excerpt: row.excerpt,
      folderName: row.folder_name,
      score,
    }));
}

export function buildSemanticMemoryContextBlock(matches: SemanticMemoryMatch[]): string {
  if (matches.length === 0) {
    return "";
  }

  return [
    "AUTO-RETRIEVED MEMORIES (semantic similarity):",
    "Use these only if they materially help with the user's current message. Prefer directly attached memories if there is any conflict.",
    ...matches.map((match, index) => `${index + 1}.\n${buildContextSnippet(match)}`),
  ].join("\n\n");
}
