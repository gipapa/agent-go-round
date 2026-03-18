import { BuiltInToolConfig } from "../types";

export type BuiltInToolHelpers = {
  system?: {
    get_user_profile?: () => Promise<any> | any;
    pick_best_agent_for_question?: (question: string) => Promise<string> | string;
  };
};

export async function runBuiltInScriptTool(tool: Pick<BuiltInToolConfig, "code">, input: any, helpers: BuiltInToolHelpers = {}) {
  const runner = new Function(
    "input",
    "helpers",
    `
      "use strict";
      const system = helpers.system ?? {};
      const pick_best_agent_for_question = system.pick_best_agent_for_question;
      const get_user_profile = system.get_user_profile;
      return (async () => {
        ${tool.code}
      })();
    `
  ) as (input: any, helpers: BuiltInToolHelpers) => Promise<any>;

  return await runner(input, helpers);
}
