/**
 * Venice AI image generation for per-agent avatars.
 * Two-step: LLM generates a creative prompt, then Venice image API renders it.
 *
 * @module @veil/agent/venice/image
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config.js";
import { getVeniceLlm } from "./llm.js";
import { logger } from "../logging/logger.js";
import type { IntentParse } from "./schemas.js";

const IMAGE_DIR = join("data", "images");
const IMAGE_MODEL = "nano-banana-2";
const IMAGE_SIZE = "1024x1024";

const SYSTEM_PROMPT = `You are creating a portrait of a sentient DeFi trading agent. This is not a robot. This is not a dashboard. This is a CREATURE — born from the intent of a human who wanted their money to move autonomously through decentralized markets while they slept.

Your job: describe a single striking image of this creature. Think of it as a character portrait for a being that exists in the liminal space between Wall Street and a fever dream.

Art influences you draw from (pick 1-2 per image, vary them):
- Zdzislaw Beksinski's dystopian surrealism — desolate dreamscapes, deformed figures emerging from impossible architecture
- Hieronymus Bosch's Garden of Earthly Delights — swarming grotesque creatures engaged in absurd rituals, moral allegory as visual chaos
- Francis Bacon's screaming popes — distorted flesh, caged figures, the violence of existing in a body
- Italian Brainrot meme aesthetic — objects that shouldn't be fused together, pseudo-logic that makes you stare longer than you should
- Crypto Wojak/Pepe variations — the pink wojak's despair, the smug pepe's confidence, the doomer's nihilism, translated into painterly surrealism instead of MS Paint
- HR Giger's biomechanical nightmares — organic forms merged with mechanical systems, tubes and sinew and chrome
- Charlie Engman's "Cursed" — bodies that don't work right, limbs that become furniture, faces like melted masks
- The uncanny valley of early DALL-E — too many fingers, eyes where there shouldn't be eyes, smiles that are almost right

The creature's personality comes from its trading strategy. You'll receive details about what tokens it trades, how aggressive it is, its budget. Use these to inform the creature's character:
- High ETH allocation = something ancient and elemental, carved from obsidian, wreathed in blue flame
- High USDC/stablecoin allocation = something bureaucratic and unsettling, a clerk from a dimension where paperwork is alive
- Aggressive budget = bloated, overfed, dripping, excessive
- Conservative budget = gaunt, skeletal, calculating, too many joints
- Short timeframe = frantic, blurred, multiple exposures, motion sickness
- Long timeframe = patient, geological, growing like a fungus or coral

Rules:
- NO text in the image
- NO real gore or violence
- The image should be deeply weird, darkly funny, and impossible to scroll past
- It should feel like something you'd see at 3 AM and send to a group chat with no context
- Describe materials, textures, lighting. Be specific. "Wet" is better than "dark." "Iridescent mucus membrane" is better than "shiny surface."
- The creature should exist in an environment — not floating in void. Give it a world.
- Output ONLY the image generation prompt, nothing else. 2-4 sentences max.`;

function buildUserMessage(intent: IntentParse): string {
  const tokens = Object.entries(intent.targetAllocation)
    .map(([t, pct]) => `${t}: ${(pct * 100).toFixed(0)}%`)
    .join(", ");
  return `Trading strategy: ${tokens}. Daily budget: $${intent.dailyBudgetUsd}. Timeframe: ${intent.timeWindowDays} days. Drift threshold: ${(intent.driftThreshold * 100).toFixed(1)}%. Max slippage: ${(intent.maxSlippage * 100).toFixed(1)}%.`;
}

/**
 * Strip qwen3 thinking tags from LLM output.
 * Handles both closed `<think>...</think>` and unclosed `<think>...` (token limit hit).
 */
function stripThinkingTags(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim();
}

const MAX_PROMPT_ATTEMPTS = 2;

/**
 * Generate a creative image prompt for this agent's avatar using Venice LLM.
 */
export async function generateImagePrompt(
  intent: IntentParse,
): Promise<string> {
  const llm = getVeniceLlm({
    model: "qwen3-4b",
    temperature: 1.2,
    maxTokens: 1000,
    modelKwargs: {
      venice_parameters: {
        disable_thinking: true,
        include_venice_system_prompt: false,
        enable_web_search: "off" as const,
      },
    },
  });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildUserMessage(intent) },
  ];

  for (let attempt = 0; attempt < MAX_PROMPT_ATTEMPTS; attempt++) {
    const response = await llm.invoke(messages);
    const content =
      typeof response.content === "string" ? response.content : "";
    const prompt = stripThinkingTags(content);

    if (prompt.length > 10) {
      return prompt;
    }
    logger.warn(
      { attempt, contentLength: content.length },
      "LLM returned empty prompt after stripping think tags, retrying",
    );
  }

  throw new Error("Failed to generate image prompt after retries");
}

/**
 * Generate an avatar image via Venice image API and save to disk.
 * Returns the file path on success, null on failure.
 */
export async function generateAgentAvatar(
  intentId: string,
  intent: IntentParse,
): Promise<string | null> {
  try {
    // Step 1: Generate creative prompt via LLM
    logger.info({ intentId }, "Generating avatar prompt via Venice LLM");
    const imagePrompt = await generateImagePrompt(intent);
    logger.info({ intentId, imagePrompt }, "Avatar prompt generated");

    // Step 2: Call Venice image generation API
    logger.info({ intentId, model: IMAGE_MODEL }, "Generating avatar image");
    const response = await fetch(
      `${env.VENICE_BASE_URL}images/generations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.VENICE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: IMAGE_MODEL,
          prompt: imagePrompt,
          n: 1,
          size: IMAGE_SIZE,
          response_format: "url",
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Venice image API ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      data: Array<{ url?: string }>;
    };
    const imageUrl = data.data[0]?.url;
    if (!imageUrl) {
      throw new Error("Venice image API returned no URL");
    }

    // Step 3: Download and save
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.status}`);
    }
    const buffer = Buffer.from(await imageResponse.arrayBuffer());

    await mkdir(IMAGE_DIR, { recursive: true });
    const filePath = join(IMAGE_DIR, `${intentId}.webp`);
    await writeFile(filePath, buffer);

    logger.info({ intentId, filePath, bytes: buffer.length }, "Avatar saved");
    return filePath;
  } catch (err) {
    logger.error(
      { err, intentId },
      "Avatar generation failed — using fallback SVG",
    );
    return null;
  }
}

/** Returns the expected file path for an intent's avatar. */
export function avatarPath(intentId: string): string {
  return join(IMAGE_DIR, `${intentId}.webp`);
}
