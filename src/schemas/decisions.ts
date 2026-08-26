import { z } from "zod";

const trimmedString = z.string().transform((value) => value.trim());
const nonEmptyString = trimmedString.refine((value) => value.length > 0);

function normalizeTypeShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const rawType = typeof record.type === "string" ? record.type : typeof record.action === "string" ? record.action : "";
  return rawType ? { ...record, type: rawType.trim().toLowerCase() } : record;
}

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

export type LeaderAction = z.infer<typeof LeaderActionSchema>;
export type LeaderVerifyDecision = z.infer<typeof LeaderVerifySchema>;
export type LeaderPlanDecision = z.infer<typeof LeaderPlanSchema>;

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
