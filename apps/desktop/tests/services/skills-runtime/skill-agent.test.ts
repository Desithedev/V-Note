import { describe, expect, it } from "vitest";
import { asSchema } from "@ai-sdk/provider-utils";

import { OUTPUT_SCHEMA } from "@/services/skills-runtime/skill-agent";

// OpenAI strict structured outputs reject any schema where a key in
// `properties` is missing from `required`. The default for @ai-sdk/openai
// is `strictJsonSchema: true`, so any optional field in OUTPUT_SCHEMA
// will 400 with "Missing '<field>'" at runtime — caught only when a user
// actually runs a skill against an OpenAI model. This test pins the
// invariant at the Zod-to-JSON-Schema boundary so additions to
// OUTPUT_SCHEMA can't reintroduce PRSM-78.
describe("OUTPUT_SCHEMA JSON Schema", () => {
  it("lists every property in `required` (OpenAI strict mode requirement)", async () => {
    const jsonSchema = (await asSchema(OUTPUT_SCHEMA).jsonSchema) as {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };

    expect(jsonSchema.type).toBe("object");
    const propKeys = Object.keys(jsonSchema.properties).sort();
    const requiredKeys = [...jsonSchema.required].sort();
    expect(requiredKeys).toEqual(propKeys);
  });
});
