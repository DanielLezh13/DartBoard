/**
 * Memory attachment limits
 * 
 * Only token-based caps are enforced server-side to prevent exceeding context budget.
 */

export const MAX_MEMORY_SAVE_TOKENS = 8192; // Max size when saving/editing a memory
export const MAX_MEMORY_TOKENS_TOTAL = 16384; // Total attached memories per session
// Per-memory token cap when injecting full content (prevents one huge memory from dominating)
export const MAX_MEMORY_CONTENT_TOKENS = 1200; // DEPRECATED - no longer used for injection

/**
 * Universal chat/upload constraints
 */
export const MAX_INPUT_CHARS = 12_000;
export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
