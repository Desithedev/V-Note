import {
  generateText,
  Output,
  ToolLoopAgent,
  type LanguageModelUsage,
  type ToolSet,
} from "ai";
import type {
  LanguageModelV3,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
} from "@ai-sdk/provider";
import { z } from "zod";

import type { Skill } from "@/db/schema";
import { logger } from "@/main/logger";
import { resolveTools } from "./resolve-tools";

// Shared output schema for skill runs. Lives here (not in skill-runner)
// because both the single-shot and tool-loop paths emit the same shape —
// keeping it next to the agent prevents the two paths drifting.
//
// Plain `z.string()` — see skill-runner.ts comment about OpenAI strict
// mode rejecting `minLength`. Non-empty is validated post-parse.
//
// `reasoning` is `.nullable()`, not `.optional()`. OpenAI strict
// structured outputs (the default for @ai-sdk/openai) require every key
// in `properties` to appear in `required` — `.optional()` omits the
// field from `required` and the request 400s with "Missing 'reasoning'".
// `.nullable()` keeps the key required while letting the model return
// `null` when it has nothing to add. (PRSM-78)
export const OUTPUT_SCHEMA = z.object({
  markdown: z.string(),
  reasoning: z.string().nullable(),
});

export type SkillAgentOutput = z.infer<typeof OUTPUT_SCHEMA>;

export interface SkillAgentArgs {
  model: LanguageModelV3;
  systemPrompt: string;
  providerOptions?: SharedV3ProviderOptions;
  signal: AbortSignal;
  skill: Skill;
}

export interface SkillAgentResult {
  output: SkillAgentOutput;
  usage: LanguageModelUsage | undefined;
  providerMetadata: SharedV3ProviderMetadata | undefined;
}

/**
 * Run a skill via the agent surface. Today the no-tool path is the same
 * single-shot `generateText` call the runner used to make inline; the
 * tool-loop branch is shaped so a future MCP/native-tool enablement (see
 * resolve-tools.ts) plugs in without changing this file's shape — and
 * without changing the skill-runner's call site.
 *
 * Pre-resolution (registry lookup, middleware wrap, providerOptions
 * compose) and post-processing (markdown → tiptap children, audit row
 * write) live in skill-runner.ts. The agent only owns the model call.
 */
export async function runSkillAgent(
  args: SkillAgentArgs,
): Promise<SkillAgentResult> {
  const tools: ToolSet = await resolveTools(args.skill);

  if (Object.keys(tools).length === 0) {
    try {
      const result = await generateText({
        model: args.model,
        system: args.systemPrompt,
        prompt: "Run the skill as instructed in the system prompt.",
        output: Output.object({ schema: OUTPUT_SCHEMA }),
        abortSignal: args.signal,
        providerOptions: args.providerOptions,
      });
      return {
        output: result.output,
        usage: result.usage,
        providerMetadata: result.providerMetadata,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isStructuredOutputError =
        errMsg.toLowerCase().includes("structured output") ||
        errMsg.toLowerCase().includes("json_schema") ||
        errMsg.toLowerCase().includes("response_format") ||
        errMsg.toLowerCase().includes("not support") ||
        errMsg.toLowerCase().includes("unsupported");

      if (isStructuredOutputError) {
        logger.pipeline.warn(
          "Model does not support strict structured outputs, falling back to prompt-guided JSON mode",
          { error: errMsg },
        );

        const fallbackSystem = `${args.systemPrompt}\n\nIMPORTANT: Return ONLY a valid JSON object with the exact keys: {"markdown": "your generated markdown content here", "reasoning": null}. Do NOT include explanations outside the JSON.`;
        const textResult = await generateText({
          model: args.model,
          system: fallbackSystem,
          prompt: "Run the skill as instructed in the system prompt and return the JSON object.",
          abortSignal: args.signal,
          providerOptions: args.providerOptions,
        });

        let rawText = textResult.text.trim();
        if (rawText.startsWith("```json")) {
          rawText = rawText.slice(7);
        } else if (rawText.startsWith("```")) {
          rawText = rawText.slice(3);
        }
        if (rawText.endsWith("```")) {
          rawText = rawText.slice(0, -3);
        }
        rawText = rawText.trim();

        try {
          const parsed = JSON.parse(rawText);
          const validated = OUTPUT_SCHEMA.parse(parsed);
          return {
            output: validated,
            usage: textResult.usage,
            providerMetadata: textResult.providerMetadata,
          };
        } catch {
          // If JSON.parse fails, treat entire text as markdown
          return {
            output: {
              markdown: textResult.text.trim() || rawText,
              reasoning: null,
            },
            usage: textResult.usage,
            providerMetadata: textResult.providerMetadata,
          };
        }
      }

      throw err;
    }
  }

  // Tool-loop path
  logger.pipeline.info("Running skill via ToolLoopAgent", {
    skill: args.skill.slug,
    toolNames: Object.keys(tools),
  });
  const agent = new ToolLoopAgent({
    model: args.model,
    instructions: args.systemPrompt,
    tools,
    output: Output.object({ schema: OUTPUT_SCHEMA }),
    providerOptions: args.providerOptions,
  });
  const result = await agent.generate({
    prompt: "Run the skill as instructed.",
    abortSignal: args.signal,
  });
  return {
    output: result.output,
    usage: result.usage,
    providerMetadata: result.providerMetadata,
  };
}
