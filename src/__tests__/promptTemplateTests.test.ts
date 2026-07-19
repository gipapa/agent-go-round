import { describe, expect, it } from "vitest";
import { getDefaultPromptTemplate, type PromptTemplateBaseId } from "../promptTemplates/store";
import { buildPromptTemplateApiTestSpec } from "../runtime/promptTemplateTests";

const baseIds: PromptTemplateBaseId[] = [
  "tool-decision",
  "skill-decision",
  "skill-runtime-system",
  "skill-verify",
  "skill-bootstrap-plan",
  "skill-planner-step",
  "skill-completion-gate"
];

describe("prompt template API test specs", () => {
  it("builds complete bilingual specs for every prompt family", () => {
    for (const language of ["zh", "en"] as const) {
      for (const baseId of baseIds) {
        const spec = buildPromptTemplateApiTestSpec({
          baseId,
          language,
          template: getDefaultPromptTemplate(`${baseId}.${language}`)
        });
        expect(spec.title).not.toBe("");
        expect(spec.description).not.toBe("");
        expect(spec.expected).not.toBe("");
        expect(spec.prompt).not.toBe("");
      }
    }
  });

  it("validates representative success and failure outputs", () => {
    const toolSpec = buildPromptTemplateApiTestSpec({ baseId: "tool-decision", language: "en", template: "" });
    expect(toolSpec.validate('{"type":"builtin_tool_call","tool":"get_user_profile","input":{}}').pass).toBe(true);
    expect(toolSpec.validate('{"type":"no_tool"}').pass).toBe(false);

    const verifySpec = buildPromptTemplateApiTestSpec({ baseId: "skill-verify", language: "zh", template: "" });
    expect(verifySpec.validate('{"type":"pass","reason":"ok"}').pass).toBe(true);

    const plannerSpec = buildPromptTemplateApiTestSpec({ baseId: "skill-planner-step", language: "en", template: "" });
    expect(plannerSpec.validate('{"type":"observe","reason":"refresh"}').pass).toBe(true);

    const completionSpec = buildPromptTemplateApiTestSpec({ baseId: "skill-completion-gate", language: "en", template: "" });
    expect(completionSpec.validate('{"type":"complete","reason":"done"}').pass).toBe(true);
  });
});
