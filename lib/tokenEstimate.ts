/**
 * Token estimation utility
 * 
 * Provides a simple heuristic for estimating token counts from text.
 * Uses a conservative approximation: ~4 characters per token (English average).
 * 
 * For code blocks, we apply a slight multiplier since code tends to be more token-dense.
 */

/**
 * Estimates the number of tokens in a given text string.
 * 
 * Uses a character-based heuristic: Math.ceil(text.length / 4)
 * This is a conservative estimate that works well for English text.
 * 
 * For code blocks (```...```), applies a 1.2x multiplier since code
 * tends to be more token-dense (more punctuation, symbols, etc.).
 * 
 * @param text - The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;

  // Base estimate: ~4 characters per token
  let baseEstimate = Math.ceil(text.length / 4);

  // Check for code blocks and apply multiplier
  const codeBlockMatches = text.match(/```[\s\S]*?```/g);
  if (codeBlockMatches) {
    // Count code block characters separately
    const codeBlockChars = codeBlockMatches.reduce((sum, block) => sum + block.length, 0);
    const regularChars = text.length - codeBlockChars;
    
    // Regular text: /4, code blocks: /4 * 1.2 (more token-dense)
    baseEstimate = Math.ceil(regularChars / 4) + Math.ceil((codeBlockChars / 4) * 1.2);
  }

  return baseEstimate;
}

/**
 * Estimates tokens for an array of message objects.
 * 
 * @param messages - Array of messages with role and content
 * @returns Total estimated token count
 */
export function estimateTokensForMessages(
  messages: Array<{ role: string; content: string }>
): number {
  return messages.reduce((total, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return total + estimateTokens(content);
  }, 0);
}

/**
 * Context window limits for different models
 */
export const CONTEXT_LIMIT_TOKENS = 110000;

/**
 * Session lifetime token limit (independent from context window)
 */
export const SESSION_TOKEN_LIMIT = 3_000_000;




