// Configuration file for API keys and settings
// Note: process.env is only available on the server side in Next.js
// For client-side usage, create API routes that use these values

export const getConfig = () => {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    modelId: process.env.DART_MODEL_ID || "gpt-5.1",
  };
};

