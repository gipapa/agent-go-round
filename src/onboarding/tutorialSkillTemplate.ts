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

export const TUTORIAL_CHATGPT_BROWSER_SKILL_NAME = "Browser Workflow Multi-turn Skill";
export const TUTORIAL_CHATGPT_BROWSER_SKILL_ROOT = "browser-workflow-multi-turn-skill";
export const TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH = "references/browser-workflow-playbook.md";
export const TUTORIAL_CHATGPT_BROWSER_ASSET_PATH = "assets/browser-workflow-report-template.md";

export const TUTORIAL_CHATGPT_BROWSER_SKILL_MARKDOWN = `---
name: browser-workflow-multiturn
description: Use when the task requires multi-turn browser automation with agent-browser MCP, especially for opening a website, navigating through one or more pages, clicking targets, optionally filling forms, and reading back the result.
license: MIT
---

# Browser Workflow Multi-turn Skill

Goal: finish a browser task across multiple MCP steps.

## Rules

- Multi-turn only: keep using MCP tools until the task is complete or clearly blocked.
- Use the most direct stable start URL that satisfies the user request.
- If the user already gave a URL, prefer that URL.
- If the user described a well-known page rather than a raw URL, infer the direct canonical page when it is obvious.
- If the user explicitly asks for a visible window or headed mode, start with \`headed: true\`.
- If the user explicitly asks for headless mode, keep \`headed: false\`.
- If the user does not specify browser visibility, default to \`headed: false\`.
- After any page-changing action, immediately use \`browser_snapshot\`.
- If the page is usable, continue in the same run:
  1. identify the current page and target
  2. navigate toward the requested page or item
  3. click or fill the necessary controls
  4. wait when content is still loading
  5. read the requested result
- If the page explicitly says the requested feature is unavailable for the current device, region, or account, treat that as a blocked final state and summarize it clearly instead of looping.
- If the page is blocked by login, verification, consent, or another manual gate, call \`request_user_confirmation\` before switching to a visible browser.
- If the user agrees, reopen with \`headed: true\`, ask the user to finish the manual step, then continue.
- Do not stop after open, snapshot, fill, or click alone.
- If the user asks for a ranked item, such as the first repo on a trending page, click that item instead of only describing the list page.
- Once you reach the target content page, summarize the visible title, description, and key body content before finishing.
- Final answer must summarize the actual page result, not raw MCP output.
- Use [Browser Workflow Playbook](${TUTORIAL_CHATGPT_BROWSER_REFERENCE_PATH}) only when you need a short reminder.
- Use [Browser Workflow Report Template](${TUTORIAL_CHATGPT_BROWSER_ASSET_PATH}) for the final report.

## When To Use

Use this skill when:
- the task explicitly needs browser automation
- more than one MCP tool call is required
- the workflow is open -> snapshot -> act -> wait -> read
- the user wants a website opened, navigated, and summarized in one run

\`\`\`skill-config
{
  "version": "1.0.0",
  "decisionHint": "Use this for browser tasks that require multiple MCP tool calls, such as opening a site, navigating to a target page, clicking an item, optionally filling a form, and reading back the result. Use it when the user explicitly asks to operate a website or browser. Do not use it for non-browser tasks.",
  "inputSchema": {},
  "workflow": {
    "useSkillDocs": true,
    "useAgentDocs": false,
    "allowMcp": true,
    "allowBuiltInTools": true,
    "allowedBuiltInToolIds": ["${SYSTEM_REQUEST_CONFIRMATION_TOOL_ID}"]
  }
}
\`\`\`
`;

export const TUTORIAL_CHATGPT_BROWSER_REFERENCE_CONTENT = `# Browser Workflow Playbook

Use this file only when you need a short reminder for a browser workflow.

## Core loop

1. Infer the most direct stable start URL for the task.
2. If the user explicitly requests headed or visible browser mode, open with \`headed: true\`.
3. Otherwise open that URL with \`browser_open\` in headless mode first.
4. Take a snapshot.
5. Inspect the page state:
   - If usable, continue automatically.
   - If the page clearly shows a manual gate such as login, consent, or verification, call \`request_user_confirmation\`.
   - Only if the user agrees, reopen with \`headed: true\`.
   - If the page clearly says the feature or route is unavailable for the current environment, stop and report that blocked state clearly.
6. When the user wants a specific page or ranked item, prefer the smallest next action that advances directly to that target.
7. Once the target content is open, take a fresh snapshot and extract the title, description, and main visible content.
8. Summarize the result in Chinese.

## Example: GitHub Trending first repo

1. Prefer \`https://github.com/trending\` over the GitHub homepage.
2. Take a snapshot.
3. Identify the first ranked repository link.
4. Click it.
5. Snapshot the repo page.
6. Summarize the repository title, short description, and main README content.

## Completion rule

Do not stop after opening the page.
Do not stop after only identifying the target.
The task is only complete when you have extracted the requested page result, or clearly explained a blocked/manual stop.
`;

export const TUTORIAL_CHATGPT_BROWSER_ASSET_CONTENT = `# Browser Workflow Report Template

When reporting the result of a browser task, use:

【目前狀態】
說明目前頁面是已完成、等待使用者介入、或仍在進行中。

【執行步驟】
用 2 到 5 點簡短列出已完成的關鍵瀏覽器操作。

【頁面內容】
整理最終讀到的頁面內容；若尚未取得，清楚說明原因。
`;
