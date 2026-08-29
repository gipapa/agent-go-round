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
- If the user asks who they are, what you know about them, or asks for a profile-based introduction, you must call the built-in tool \`get_user_profile\` before answering; do not guess or claim you lack access before trying it.
- If the user asks for advanced reasoning tactics such as revise, branch, or changing approach, read [Advanced Usage](${TUTORIAL_SEQUENTIAL_ADVANCED_PATH}).
- If the user asks for a concrete walkthrough or practical example, read [Examples](${TUTORIAL_SEQUENTIAL_EXAMPLES_PATH}).
- If one request asks for both advanced guidance and an example, read both references before answering; do not stop after reading only one.
- After each reference read, continue with any other required reference read before composing the final answer.
- Keep the final answer concise unless the user explicitly asks for a long explanation.
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
description: Use when the task requires a multi-step browser workflow with agent-browser MCP, especially for opening a website, navigating through one or more pages, clicking targets, optionally filling forms, and reading back the result.
license: MIT
---

# Browser Workflow Skill

Goal: finish a browser task across multiple MCP steps in one canonical action loop.

## Rules

- Continue using MCP tools until the task is complete or clearly blocked; keep each tool result in the same transcript.
- Use the most direct stable start URL that satisfies the user request.
- If the user already gave a URL, prefer that URL.
- If the user described a well-known page rather than a raw URL, infer the direct canonical page when it is obvious.
- If the user explicitly asks for a visible window or headed mode, start with \`headed: true\`.
- If the user explicitly asks for headless mode, keep \`headed: false\`.
- If the user does not specify browser visibility, default to \`headed: false\`.
- For GitHub Trending tasks, prefer \`https://github.com/trending?since=daily\` and keep language / spoken language at the default any filters unless the user explicitly asks otherwise.
- After \`browser_open\` or any other page-changing action, your very next tool call must be \`browser_snapshot\`; never finish immediately after the action.
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

1. Prefer \`https://github.com/trending?since=daily\` over the GitHub homepage or an unfixed Trending URL.
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

export const TUTORIAL_HARNESS_STABILITY_SKILL_NAME = "Harness Stability Tutorial Skill";
export const TUTORIAL_HARNESS_STABILITY_SKILL_ROOT = "harness-stability-tutorial-skill";
export const TUTORIAL_HARNESS_STABILITY_ASSET_PATH = "assets/harness-stability-report-template.md";

export const TUTORIAL_HARNESS_STABILITY_SKILL_MARKDOWN = `---
name: harness-stability
description: Use when the user asks to verify the local harness stability flow with their profile and a deterministic local verification stamp.
license: MIT
---

# Harness Stability Skill

Goal: verify one canonical action loop can complete two deterministic local tool calls before producing a final report.

## Rules

- First call \`get_user_profile\` with an empty input object.
- After its successful result is present in the transcript, call \`教學 Harness 驗證戳記工具\` with an empty input object.
- Do not call either tool more than once.
- Do not answer before both tool results are successful.
- The verification tool must return \`AGR-HARNESS-STABLE-V1\`; if it does not, report the unexpected result instead of claiming success.
- Use [Harness Stability Report Template](${TUTORIAL_HARNESS_STABILITY_ASSET_PATH}) for the final response.
- Keep the final response concise and in Chinese.

## When To Use

Use this skill only when the user explicitly asks to verify the local harness stability flow, profile lookup, or the local verification stamp.

\`\`\`skill-config
{
  "version": "1.0.0",
  "decisionHint": "Use only for an explicit local harness stability verification. Call get_user_profile first, then 教學 Harness 驗證戳記工具, and do not finish before both successful results are in the transcript.",
  "inputSchema": {},
  "workflow": {
    "useSkillDocs": true,
    "useAgentDocs": false,
    "allowMcp": false,
    "allowBuiltInTools": true
  }
}
\`\`\`
`;

export const TUTORIAL_HARNESS_STABILITY_ASSET_CONTENT = `# Harness Stability Report Template

After both tools succeed, use exactly these sections:

【Harness 狀態】
說明本地 canonical action loop 已完成兩個工具步驟。

【Profile】
簡短列出 get_user_profile 回傳的使用者名稱。

【驗證戳記】
列出教學 Harness 驗證戳記工具回傳的 stamp。
`;

export const TUTORIAL_GRILLING_INVEST_SKILL_NAME = "Grilling Invest Tutorial Skill";
export const TUTORIAL_GRILLING_INVEST_SKILL_ROOT = "grilling-invest-tutorial-skill";
export const TUTORIAL_GRILLING_INVEST_RISK_REFERENCE_PATH = "references/risk-framework.md";
export const TUTORIAL_GRILLING_INVEST_INDEX_REFERENCE_PATH = "references/twse-top10-index.md";
export const TUTORIAL_GRILLING_INVEST_COMPANY_REFERENCE_PATHS = [
  "references/companies/2330.md",
  "references/companies/2317.md",
  "references/companies/2308.md",
  "references/companies/2454.md",
  "references/companies/2881.md",
  "references/companies/2882.md",
  "references/companies/3711.md",
  "references/companies/2382.md",
  "references/companies/2412.md",
  "references/companies/2891.md"
] as const;

export const TUTORIAL_GRILLING_INVEST_SKILL_MARKDOWN = `---
name: grilling-invest
description: Use when the user wants a structured, risk-aware discussion of Taiwan stock investing; interview the user one question at a time before comparing at most two companies.
license: MIT
---

# Grilling Invest

Goal: understand the investor before discussing a company. This is an educational risk-matching conversation, not an execution or guaranteed-return service.

This tutorial is an adapted frontend-only version of Matt Pocock's grill-me skill. Copyright (c) 2026 Matt Pocock; used under the MIT License. Source: https://github.com/mattpocock/skills/tree/main/skills/productivity/grill-me

## Workflow

- Before producing the first interview answer, call internal:skill.read with path \`${TUTORIAL_GRILLING_INVEST_RISK_REFERENCE_PATH}\` and wait for a successful result. Do not read company profiles yet.
- HARD OUTPUT RULE: during the interview, the final answer must contain exactly one question mark (\`?\` or \`？\`) total. Ask exactly one short main question in one sentence. Do not add examples, parenthetical text, alternatives, colons, semicolons, or a second question after a clarification; briefly restate what the user said only in a separate statement without question marks.
- Treat each interview turn as one field only, never a compound question joined by "and", "or", "以及", or "或". The first user message already states an eight-year retirement goal, so ask only about one new field such as whether the funds may be needed before retirement; do not ask about goal and horizon together. A compliant first-turn ending is: \`這筆退休資金在未來八年內是否可能需要提領？\`
- Until the user explicitly requests the final comparison and says it is now time to read the TWSE index, never read the TWSE index or any company reference. During all interview turns, read only \`${TUTORIAL_GRILLING_INVEST_RISK_REFERENCE_PATH}\`, even if the user asks whether another risk question is necessary.
- Resolve goal, horizon, liquidity needs, income/emergency-fund stability, prior experience, emotional response to drawdowns, and concentration tolerance before analysing companies.
- If the user's answers conflict, name the conflict and ask one clarifying question instead of guessing.
- Once the risk profile is sufficiently clear, read [TWSE Top 10 Index](${TUTORIAL_GRILLING_INVEST_INDEX_REFERENCE_PATH}) and select no more than two relevant companies.
- After reading the index, do not produce a final answer from the index alone: call internal:skill.read for at least one selected path under \`references/companies/\` and no more than two selected company paths before answering. Read only the selected company references from the index. Never load all ten company profiles for a single conversation.
- Keep the existing conversation context bounded. If a reference or comparison would exceed the available context, narrow the comparison and say why.
- Finish with the user's stated assumptions, risk profile, suitable and unsuitable risk characteristics, candidate comparison, diversification considerations, facts to verify, and a clear educational-analysis disclaimer.
- Keep the final comparison concise (no more than 400 words): summarize the selected references instead of quoting or reproducing them.
- Answer in the user's language when possible; this tutorial is written for Traditional Chinese users, so prefer Traditional Chinese and make the educational disclaimer explicit.
- Never claim to have live prices, live rankings, private account data, or certainty about future returns. Do not issue a guaranteed buy/sell instruction.

## Reference routing

- Read the risk framework reference (${TUTORIAL_GRILLING_INVEST_RISK_REFERENCE_PATH}) with internal:skill.read before the first interview question; do not answer from the skill-load resource index alone.
- Read the TWSE index reference (${TUTORIAL_GRILLING_INVEST_INDEX_REFERENCE_PATH}) only after the risk interview is complete.
- After reading the index, read at least one and at most two paths under references/companies/ before producing a final answer; select them from the index.
- Do not reread a reference unless a bounded chunk is genuinely needed.

\`\`\`skill-config
{
  "version": "1.0.0",
  "decisionHint": "Use for a one-question-at-a-time, risk-aware educational discussion of Taiwan stocks. Interview the investor before reading at most two relevant company references.",
  "inputSchema": {},
  "workflow": {
    "useSkillDocs": true,
    "useAgentDocs": false,
    "allowMcp": false,
    "allowBuiltInTools": false
  }
}
\`\`\`
`;

export const TUTORIAL_GRILLING_INVEST_RISK_REFERENCE_CONTENT = `# Investor Risk Framework

Use this compact framework before reading company data. It is a conversation aid, not a regulated suitability assessment.

## Questions to resolve

- Goal and time horizon: retirement, education, income, preservation, or another goal; record years rather than vague labels.
- Liquidity: whether this money may be needed within the next one to three years.
- Capacity: income stability, emergency reserve, debt pressure, and whether a temporary loss would change essential spending.
- Tolerance: the largest temporary decline the user could stay invested through without panic-selling.
- Experience: prior products, diversification habits, and understanding of equity volatility.
- Concentration: willingness to accept exposure to one company, sector, export market, or semiconductor cycle.

## Interpretation

- A long horizon does not automatically mean high risk capacity.
- Risk tolerance (what feels bearable) and risk capacity (what finances can bear) may disagree; use the more conservative constraint until clarified.
- A user who needs the money soon should not be matched with a highly volatile equity thesis merely because its long-term story is attractive.
- Treat answers as stated assumptions, not verified financial facts.
`;

export const TUTORIAL_GRILLING_INVEST_INDEX_REFERENCE_CONTENT = `# TWSE Top 10 Market-Capitalization Snapshot

Source: Taiwan Stock Exchange FACT BOOK 2026, Top 30 Companies for Stock by Market Capitalization in 2025 (https://wwwc.twse.com.tw/downloads/zh/about/company/factbook/2026/1.04.html). Snapshot date: end of 2025. Market capitalization unit: NTD million. Special stocks are excluded.

Use this index only after the investor interview. It is a stable historical reference, not a live ranking or price feed.

1. 2330 Taiwan Semiconductor Manufacturing Co., Ltd. — semiconductor foundry — NTD 40,195,412 million — references/companies/2330.md
2. 2317 Hon Hai Precision Industry Co., Ltd. — electronics manufacturing / supply chain — NTD 3,218,753 million — references/companies/2317.md
3. 2308 Delta Electronics, Inc. — power and energy-management electronics — NTD 2,501,434 million — references/companies/2308.md
4. 2454 MediaTek Inc. — fabless semiconductors — NTD 2,293,594 million — references/companies/2454.md
5. 2881 Fubon Financial Holding Co., Ltd. — financial holding — NTD 1,346,108 million — references/companies/2881.md
6. 2882 Cathay Financial Holding Co., Ltd. — financial holding — NTD 1,111,926 million — references/companies/2882.md
7. 3711 ASE Industrial Holding Co., Ltd. — semiconductor packaging and testing — NTD 1,111,253 million — references/companies/3711.md
8. 2382 Quanta Computer Inc. — electronics manufacturing / servers — NTD 1,050,635 million — references/companies/2382.md
9. 2412 Chunghwa Telecom Co., Ltd. — telecommunications — NTD 1,012,347 million — references/companies/2412.md
10. 2891 CTBC Financial Holding Co., Ltd. — financial holding — NTD 986,418 million — references/companies/2891.md

Selection rule: compare no more than two companies, and explain why their risk characteristics match or conflict with the user's answers.
`;

export const TUTORIAL_GRILLING_INVEST_COMPANY_REFERENCE_CONTENT: Record<string, string> = {
  "references/companies/2330.md": `# 2330 台灣積體電路製造（TSMC）\n\n產業：半導體晶圓代工。\n\n分析重點：全球先進製程與高資本支出帶來技術和規模優勢，但營收與估值對 AI、電子景氣、出口需求、地緣政治、能源與資本支出週期敏感。適合討論長期成長與集中風險的取捨；不應把龍頭地位當成沒有回撤風險。`,
  "references/companies/2317.md": `# 2317 鴻海\n\n產業：電子製造服務與供應鏈整合。\n\n分析重點：客戶與產品多元、製造規模大，但毛利通常受競爭、客戶集中、全球製造配置、匯率與消費電子週期影響。適合討論較分散的營收來源與景氣循環風險。`,
  "references/companies/2308.md": `# 2308 台達電\n\n產業：電源、散熱、自動化與能源管理電子。\n\n分析重點：受高效能運算、資料中心與能源效率需求支持，產品與技術布局可提供成長題材；仍須考慮工業景氣、資本支出、競爭、估值與供應鏈風險。`,
  "references/companies/2454.md": `# 2454 聯發科\n\n產業：無晶圓半導體設計。\n\n分析重點：智慧裝置、連網與邊緣運算產品組合帶來成長機會；需求、客戶產品週期、競爭、研發投入與半導體景氣會造成波動。適合用來討論高研發與產品週期風險。`,
  "references/companies/2881.md": `# 2881 富邦金\n\n產業：金融控股。\n\n分析重點：銀行、保險與證券等金融業務提供不同收入來源，利率、信用循環、資本市場、保險理賠與監管會影響獲利。金融股的穩定感不等於沒有景氣與市場風險。`,
  "references/companies/2882.md": `# 2882 國泰金\n\n產業：金融控股。\n\n分析重點：金融與保險業務受利率、債券與股票市場、信用品質、匯率及監管影響。討論時應區分配息期待、資本韌性與市場波動，避免只用殖利率判斷安全性。`,
  "references/companies/3711.md": `# 3711 日月光投控\n\n產業：半導體封裝測試與相關製造服務。\n\n分析重點：受晶片出貨、先進封裝與電子週期影響，能受惠於半導體需求但也承擔資本支出、客戶集中、景氣反轉與技術競爭風險。`,
  "references/companies/2382.md": `# 2382 廣達\n\n產業：電子製造服務、伺服器與雲端硬體。\n\n分析重點：伺服器與 AI 基礎建設需求可能支持成長，但客戶集中、訂單週期、供應鏈、毛利率與資本支出變化會造成波動。`,
  "references/companies/2412.md": `# 2412 中華電\n\n產業：電信。\n\n分析重點：通訊服務具有較穩定的基本需求與現金流特徵，但仍有資本支出、價格競爭、監管、技術升級與成長速度有限等取捨。適合討論防禦性與成長性之間的平衡。`,
  "references/companies/2891.md": `# 2891 中信金\n\n產業：金融控股。\n\n分析重點：銀行、保險與資產管理業務受利率、信用循環、資本市場、匯率、監管與海外布局影響。適合討論金融業分散效果與系統性風險。`
};
