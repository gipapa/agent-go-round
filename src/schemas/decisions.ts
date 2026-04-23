import { z } from "zod";

const unknownInputSchema = z.unknown().optional();
const trimmedString = z.string().transform((value) => value.trim());
const nonEmptyString = trimmedString.refine((value) => value.length > 0);
const stringListSchema = z
  .array(z.string())
  .transform((items) => items.map((item) => item.trim()).filter(Boolean));

function normalizeTypeShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const rawType = typeof record.type === "string" ? record.type : typeof record.action === "string" ? record.action : "";
  return rawType ? { ...record, type: rawType.trim().toLowerCase() } : record;
}

export const McpActionSchema = z.preprocess(
  normalizeTypeShape,
  z.object({
    type: z.literal("mcp_call"),
    tool: nonEmptyString,
    input: unknownInputSchema,
    serverId: trimmedString.optional()
  })
);

export const ToolDecisionSchema = z.preprocess(
  normalizeTypeShape,
  z.union([
    z.object({ type: z.literal("no_tool") }),
    z
      .object({
        type: z.literal("user_profile_call"),
        tool: z.literal("get_user_profile")
      })
      .transform(() => ({ type: "builtin_tool_call" as const, tool: "get_user_profile", input: {} })),
    z.object({
      type: z.literal("builtin_tool_call"),
      tool: nonEmptyString,
      input: unknownInputSchema
    }),
    McpActionSchema
  ])
);

export const SkillDecisionSchema = z.preprocess(
  normalizeTypeShape,
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("no_skill") }),
    z.object({
      type: z.literal("skill_call"),
      skillId: nonEmptyString,
      input: unknownInputSchema
    })
  ])
);

export const SkillBootstrapPlanSchema = z
  .object({
    todo: stringListSchema.transform((items) => items.slice(0, 7)),
    taskSummary: nonEmptyString.optional(),
    startUrl: nonEmptyString.optional(),
    notes: stringListSchema.transform((items) => items.slice(0, 5)).optional()
  })
  .refine((value) => value.todo.length > 0);

export const SkillStepDecisionSchema = z.preprocess(
  normalizeTypeShape,
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("observe"),
      reason: nonEmptyString,
      todoIds: stringListSchema.optional()
    }),
    z.object({
      type: z.literal("act"),
      reason: nonEmptyString,
      toolKind: z.union([z.literal("mcp"), z.literal("builtin")]),
      toolName: nonEmptyString,
      input: unknownInputSchema,
      todoIds: stringListSchema.optional()
    }),
    z.object({
      type: z.literal("ask_user"),
      reason: nonEmptyString,
      message: nonEmptyString,
      todoIds: stringListSchema.optional()
    }),
    z.object({
      type: z.literal("finish"),
      reason: nonEmptyString,
      todoIds: stringListSchema.optional()
    })
  ])
);

export const SkillCompletionDecisionSchema = z.preprocess(
  normalizeTypeShape,
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("complete"),
      reason: trimmedString.optional(),
      todoIds: stringListSchema.optional()
    }),
    z.object({
      type: z.literal("incomplete"),
      reason: nonEmptyString,
      suggestedFocus: nonEmptyString.optional(),
      todoIds: stringListSchema.optional()
    })
  ])
);

export const SkillVerifyDecisionSchema = z.preprocess(
  normalizeTypeShape,
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("pass"),
      reason: trimmedString.optional()
    }),
    z.object({
      type: z.literal("refine"),
      reason: nonEmptyString,
      revisionPrompt: nonEmptyString.optional()
    })
  ])
);

export const LeaderActionSchema = z.preprocess(
  normalizeTypeShape,
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("ask_member"),
      memberId: nonEmptyString,
      message: nonEmptyString
    }),
    z.object({
      type: z.literal("finish"),
      answer: z.string()
    })
  ])
);

const LeaderReactSchema = z.object({
  memberId: nonEmptyString,
  message: nonEmptyString
});

export const LeaderVerifySchema = z
  .object({
    ok: z.boolean(),
    reason: z.string().optional(),
    react: LeaderReactSchema.optional()
  })
  .passthrough();

export const LeaderPlanSchema = z
  .object({
    assignments: z
      .array(
        z.object({
          memberId: nonEmptyString,
          message: nonEmptyString
        })
      )
      .min(1),
    notes: z.string().optional()
  })
  .passthrough();

export type McpAction = z.infer<typeof McpActionSchema>;
export type ToolDecision = z.infer<typeof ToolDecisionSchema>;
export type BuiltInToolAction = Extract<ToolDecision, { type: "builtin_tool_call" }>;
export type SkillDecision = z.infer<typeof SkillDecisionSchema>;
export type SkillBootstrapPlan = z.infer<typeof SkillBootstrapPlanSchema>;
export type LeaderAction = z.infer<typeof LeaderActionSchema>;
export type LeaderVerifyDecision = z.infer<typeof LeaderVerifySchema>;
export type LeaderPlanDecision = z.infer<typeof LeaderPlanSchema>;

export function normalizeMcpAction(obj: unknown): McpAction | null {
  const result = McpActionSchema.safeParse(obj);
  return result.success ? result.data : null;
}

export function normalizeToolDecision(obj: unknown): ToolDecision | null {
  const result = ToolDecisionSchema.safeParse(obj);
  return result.success ? result.data : null;
}

export function normalizeSkillDecision(obj: unknown): SkillDecision | null {
  const result = SkillDecisionSchema.safeParse(obj);
  return result.success ? result.data : null;
}

export function normalizeSkillBootstrapPlan(obj: unknown): SkillBootstrapPlan | null {
  const result = SkillBootstrapPlanSchema.safeParse(obj);
  return result.success ? result.data : null;
}

export function normalizeLeaderAction(obj: unknown): LeaderAction | null {
  const result = LeaderActionSchema.safeParse(obj);
  return result.success ? result.data : null;
}

export function normalizeLeaderVerify(obj: unknown): LeaderVerifyDecision | null {
  const result = LeaderVerifySchema.safeParse(obj);
  return result.success ? result.data : null;
}

export function normalizeLeaderPlan(obj: unknown): LeaderPlanDecision | null {
  const result = LeaderPlanSchema.safeParse(obj);
  return result.success ? result.data : null;
}
