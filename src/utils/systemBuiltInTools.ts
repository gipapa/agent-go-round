import { BuiltInToolConfig } from "../types";

export const SYSTEM_USER_PROFILE_TOOL_ID = "system:get_user_profile";
export const SYSTEM_AGENT_DIRECTORY_TOOL_ID = "system:pick_best_agent_for_question";
export const SYSTEM_REQUEST_CONFIRMATION_TOOL_ID = "system:request_user_confirmation";

export const SYSTEM_BUILT_IN_TOOLS: BuiltInToolConfig[] = [
  {
    id: SYSTEM_USER_PROFILE_TOOL_ID,
    name: "get_user_profile",
    displayLabel: "[系統工具]允許存取使用者資訊(get_user_profile)",
    description: "讀取目前使用者在 Profile 頁設定的名稱、自我描述，以及是否有設定大頭照。",
    inputSchema: {},
    code: `return await system.get_user_profile();`,
    requireConfirmation: false,
    updatedAt: 0,
    source: "system",
    readonly: true,
    systemHandler: "user_profile"
  },
  {
    id: SYSTEM_AGENT_DIRECTORY_TOOL_ID,
    name: "pick_best_agent_for_question",
    displayLabel: "[系統工具]允許存取所有Agent清單(pick_best_agent_for_question)",
    description:
      "根據使用者問題與各 agent description，回傳最適合處理該問題的 agent 名稱；若沒有明顯匹配，則回傳第一個 agent 名稱。",
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "使用者原始問題"
        }
      },
      required: ["question"]
    },
    code: `const question = String(input?.question ?? "").trim();

if (!question) {
  throw new Error("Input must include question.");
}

return await system.pick_best_agent_for_question(question);`,
    requireConfirmation: false,
    updatedAt: 0,
    source: "system",
    readonly: true,
    systemHandler: "agent_directory"
  },
  {
    id: SYSTEM_REQUEST_CONFIRMATION_TOOL_ID,
    name: "request_user_confirmation",
    displayLabel: "[系統工具]請求使用者確認(request_user_confirmation)",
    description:
      "當流程需要使用者即時確認時，彈出確認視窗並回傳是否同意。適合在自動流程受阻時，詢問是否切換到可見瀏覽器或是否繼續高風險操作。",
    inputSchema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "要顯示給使用者的確認訊息"
        }
      },
      required: ["message"]
    },
    code: `const message = String(input?.message ?? "").trim();

if (!message) {
  throw new Error("Input must include message.");
}

return await system.request_user_confirmation(message);`,
    requireConfirmation: false,
    updatedAt: 0,
    source: "system",
    readonly: true
  }
];
