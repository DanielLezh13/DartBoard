export type UserPlan = "free" | "plus";

export type PlanLimits = {
  chatTurnsPerMinute: number;
  chatTurnsPerDay: number;
  dailyTokenBudget: number;
  model: string;
  maxInputChars: number;
  maxOutputTokensDefault: number;
  maxOutputTokensBuilderDissect: number;
  maxSessionTokens: number;
  maxMemories: number;
  maxMemoryFolders: number;
  maxChatSessionFolders: number;
  maxSessions: number;
  maxImageUploadsPerDay: number;
  maxImagesPerMessage: number;
  maxImageSizeBytes: number;
  maxAttachedMemoriesPerSession: number;
  maxAttachedMemoryTokensPerSession: number;
  maxMemorySizeTokens: number;
  webSearchEnabled: boolean;
  webSearchesPerDay: number;
};

export const PLAN_LIMITS: Record<UserPlan, PlanLimits> = {
  free: {
    chatTurnsPerMinute: 20,
    chatTurnsPerDay: 120,
    dailyTokenBudget: 250_000,
    model: "gpt-5-mini",
    maxInputChars: 12_000,
    maxOutputTokensDefault: 4096,
    maxOutputTokensBuilderDissect: 8192,
    maxSessionTokens: 500_000,
    maxMemories: 50,
    maxMemoryFolders: 15,
    maxChatSessionFolders: 15,
    maxSessions: 30,
    maxImageUploadsPerDay: 5,
    maxImagesPerMessage: 4,
    maxImageSizeBytes: 5 * 1024 * 1024,
    maxAttachedMemoriesPerSession: 5,
    maxAttachedMemoryTokensPerSession: 8_192,
    maxMemorySizeTokens: 8_192,
    webSearchEnabled: true,
    webSearchesPerDay: 10,
  },
  plus: {
    chatTurnsPerMinute: 30,
    chatTurnsPerDay: 300,
    dailyTokenBudget: 2_000_000,
    model: "gpt-5.1",
    maxInputChars: 12_000,
    maxOutputTokensDefault: 4096,
    maxOutputTokensBuilderDissect: 8192,
    maxSessionTokens: 3_000_000,
    maxMemories: Number.POSITIVE_INFINITY,
    maxMemoryFolders: Number.POSITIVE_INFINITY,
    maxChatSessionFolders: Number.POSITIVE_INFINITY,
    maxSessions: Number.POSITIVE_INFINITY,
    maxImageUploadsPerDay: 50,
    maxImagesPerMessage: 4,
    maxImageSizeBytes: 5 * 1024 * 1024,
    maxAttachedMemoriesPerSession: 16,
    maxAttachedMemoryTokensPerSession: 16_384,
    maxMemorySizeTokens: 8_192,
    webSearchEnabled: true,
    webSearchesPerDay: Number.POSITIVE_INFINITY,
  },
};

