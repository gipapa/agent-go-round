import { SYSTEM_USER_PROFILE_TOOL_ID } from "../utils/systemBuiltInTools";

export const TUTORIAL_SEQUENTIAL_SKILL_NAME = "Sequential Thinking Tutorial Skill";
export const TUTORIAL_SEQUENTIAL_SKILL_ROOT = "sequential-thinking-tutorial-skill";
export const TUTORIAL_SEQUENTIAL_ADVANCED_PATH = "references/advanced.md";
export const TUTORIAL_SEQUENTIAL_EXAMPLES_PATH = "references/examples.md";
export const TUTORIAL_SEQUENTIAL_ASSET_PATH = "assets/sequential-answer-template.md";

export const TUTORIAL_SEQUENTIAL_SKILL_MARKDOWN = `---
name: sequential-thinking
description: Use when the user needs a calm structured answer, asks for profile-based help, wants advanced revise or branch guidance, asks for an example, or wants a templated reply.
license: MIT
---

# Sequential Thinking

Goal: keep answers calm, clear, and structured.

## Rules

- Use a steady, organized tone instead of harsh or emotional language.
- If the user asks who they are, what you know about them, or asks for a profile-based introduction, use the built-in tool \`get_user_profile\` first.
- If the user asks for advanced reasoning tactics such as revise, branch, or changing approach, read [Advanced Usage](${TUTORIAL_SEQUENTIAL_ADVANCED_PATH}).
- If the user asks for a concrete walkthrough or practical example, read [Examples](${TUTORIAL_SEQUENTIAL_EXAMPLES_PATH}).
- If the user asks for a template or formatted answer, follow [Sequential Answer Template](${TUTORIAL_SEQUENTIAL_ASSET_PATH}).

## When To Use

Use this skill when the task benefits from:
- calmer tone
- step-by-step explanation
- advanced revise or branch guidance
- example-based explanation
- templated output

\`\`\`skill-config
{
  "version": "1.0.0",
  "decisionHint": "Use this when the user needs a calm structured explanation, asks for profile-based help, wants revise or branch guidance, asks for an example, or wants a templated answer. If the user asks who they are, use get_user_profile.",
  "inputSchema": {},
  "workflow": {
    "useSkillDocs": true,
    "useAgentDocs": false,
    "allowMcp": false,
    "allowBuiltInTools": true,
    "allowedBuiltInToolIds": ["${SYSTEM_USER_PROFILE_TOOL_ID}"]
  }
}
\`\`\`
`;

export const TUTORIAL_SEQUENTIAL_ADVANCED_CONTENT = `# Advanced Usage: Revision and Branching

Use this file only when the user asks for advanced mode, revise, branch, or alternative approaches.

## Revise

Use revise when the current path is clearly wrong.

Typical signals:
- new evidence contradicts the earlier assumption
- the question scope was misunderstood
- you solved the wrong problem

## Branch

Use branch when there are at least two realistic paths worth comparing.

Typical signals:
- multiple valid approaches exist
- trade-offs matter
- you need to compare cost, speed, or risk

## Minimal advanced response pattern

1. state the current problem framing
2. explain whether revise or branch is needed
3. give one short example or recommendation
`;

export const TUTORIAL_SEQUENTIAL_EXAMPLES_CONTENT = `# Sequential Thinking Examples

## Example 1: Revise

Question: production fails but development works.

Good pattern:
1. say the first guess
2. explain why it was wrong
3. revise to the better explanation

## Example 2: Branch

Question: choose between two valid designs.

Good pattern:
1. list branch A and branch B
2. compare trade-offs
3. pick one with a short reason

## Example 3: Simple structured proof

Question: why is 1+1=2?

Good pattern:
1. start from the definition
2. explain one key step
3. conclude clearly
`;

export const TUTORIAL_SEQUENTIAL_ASSET_CONTENT = `# Sequential Answer Template

When the user asks for a template or formatted output, use these section headers:

【問題】
用一句話重述使用者要解決的問題。

【拆解】
列出 2 到 4 個關鍵思路或步驟。

【關鍵依據】
指出最重要的定義、工具結果、reference，或判斷理由。

【最終回答】
直接給出可採取的答案或結論。
`;
