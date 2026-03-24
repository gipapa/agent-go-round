import { SYSTEM_REQUEST_CONFIRMATION_TOOL_ID, SYSTEM_USER_PROFILE_TOOL_ID } from "../utils/systemBuiltInTools";

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

export const TUTORIAL_CHATGPT_BROWSER_SKILL_NAME = "Google AI Browser Multi-turn Skill";
export const TUTORIAL_CHATGPT_BROWSER_SKILL_ROOT = "google-ai-browser-multi-turn-skill";
export const TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH = "references/google-ai-browser-playbook.md";
export const TUTORIAL_CHATGPT_BROWSER_ASSET_PATH = "assets/google-ai-browser-report-template.md";

export const TUTORIAL_CHATGPT_BROWSER_SKILL_MARKDOWN = `---
name: google-ai-browser-multiturn
description: Use when the task requires multi-turn browser automation with agent-browser MCP, especially for opening Google AI Mode directly, automatically trying a headless flow first, falling back to a visible browser only when verification or consent appears, then sending a prompt and reading the reply.
license: MIT
---

# Google AI Browser Multi-turn Skill

Goal: finish a browser task across multiple MCP steps.

## Rules

- Multi-turn only: keep using MCP tools until the task is complete or clearly blocked.
- First action: open \`https://google.com/ai\` with \`browser_open\` using \`headed: false\`.
- After any page-changing action, immediately use \`browser_snapshot\`.
- If the page is usable, continue in the same run:
  1. locate AI Mode entry or query input
  2. fill the prompt
  3. send it
  4. wait
  5. read the reply
- If the page explicitly says this device, region, or account cannot use AI Mode, treat that as a blocked final state and summarize it clearly instead of looping.
- If the page is blocked by login, verification, consent, or another manual gate, call \`request_user_confirmation\` before switching to a visible browser.
- If the user agrees, reopen with \`headed: true\`, ask the user to finish the manual step, then continue.
- Do not stop after open, snapshot, or fill alone.
- Final answer must summarize the actual page result, not raw MCP output.
- Use [Google AI Browser Playbook](${TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH}) only when you need a short reminder.
- Use [Google AI Browser Report Template](${TUTORIAL_CHATGPT_BROWSER_ASSET_PATH}) for the final report.

## When To Use

Use this skill when:
- the task explicitly needs browser automation
- more than one MCP tool call is required
- the workflow is open -> snapshot -> act -> wait -> read
- the user wants Google AI Mode opened, queried, and summarized in one run

\`\`\`skill-config
{
  "version": "1.0.0",
  "decisionHint": "Use this for advanced browser tasks that need multiple MCP tool calls, especially when opening Google AI Mode, trying headless automation first, switching to a visible browser only if verification or consent is required, typing a prompt, and reading the reply. Also use it for short requests like asking to open Google AI Mode and ask what model it is and today's Taipei weather.",
  "inputSchema": {},
  "workflow": {
    "useSkillDocs": true,
    "useAgentDocs": false,
    "allowMcp": true,
      "allowBuiltInTools": true,
      "allowedBuiltInToolIds": ["${SYSTEM_REQUEST_CONFIRMATION_TOOL_ID}"],
      "bootstrapAction": {
        "toolKind": "mcp",
        "toolName": "browser_open",
        "input": {
          "url": "https://google.com/ai",
          "headed": false
        },
        "reason": "Start the browser workflow by opening Google AI Mode directly in headless mode."
      }
    }
  }
\`\`\`
`;

export const TUTORIAL_CHATGPT_BROWSER_REFERENCE_CONTENT = `# Google AI Browser Playbook

Use this file only when you need a short reminder for the Google AI Mode workflow.

## Core loop

1. Open \`https://google.com/ai\` with \`browser_open\` in headless mode first.
2. Take a snapshot.
3. Inspect the page state:
   - If usable, continue automatically.
   - If the page clearly says AI Mode is unavailable for the current device, region, or account, stop and report that blocked state clearly.
   - If blocked by login, consent, or verification, call \`request_user_confirmation\`.
   - Only if the user agrees, reopen with \`headed: true\`.
4. In headed mode, ask the user to finish the manual step, then resume.
5. Once the page is ready, take a fresh snapshot and locate the question composer.
6. Fill the requested prompt: "你是什麼模型，還有今天台北天氣如何".
7. Click the send button, or use another visible send interaction if needed.
8. Wait for the reply to appear.
9. Snapshot again and capture the response.

## Completion rule

Do not stop after opening the page.
Do not stop after typing the prompt.
The task is only complete when you have extracted the actual reply, or clearly explained a blocked state such as login/verification/manual gate, or that AI Mode is unavailable in the current environment.
`;

export const TUTORIAL_CHATGPT_BROWSER_ASSET_CONTENT = `# Google AI Browser Report Template

When reporting the result of a browser task, use:

【目前狀態】
說明目前頁面是已完成、等待使用者介入、或仍在進行中。

【執行步驟】
用 2 到 5 點簡短列出已完成的關鍵瀏覽器操作。

【取得的回應】
整理 Google AI 的最終回覆；若尚未取得，清楚說明原因。
`;
