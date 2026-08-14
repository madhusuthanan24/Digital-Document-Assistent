/**
 * NVIDIA NIM API Configuration
 *
 * 1. Go to https://build.nvidia.com/
 * 2. Sign in to your NVIDIA account.
 * 3. Create an API Key.
 * 4. Replace YOUR_NVIDIA_API_KEY below.
 */

export const NVIDIA_API_KEY = "YOUR_NVIDIA_API_KEY";

/**
 * NVIDIA NIM OpenAI-compatible endpoint
 */
export const NVIDIA_ENDPOINT =
  "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * Vision model
 *
 * Recommended:
 * meta/llama-3.2-90b-vision-instruct
 *
 * You can change this later if you choose another vision model.
 */
export const NVIDIA_MODEL =
  "meta/llama-3.2-90b-vision-instruct";

/**
 * Default request configuration
 */
export const NVIDIA_CONFIG = {
  max_tokens: 512,
  temperature: 0.1,
  stream: false,
};