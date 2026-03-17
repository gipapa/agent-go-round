import { BuiltInToolConfig } from "../types";

export type BuiltInToolHelpers = {
  pick_best_agent_for_question?: (question: string) => Promise<string> | string;
};

export async function runBuiltInScriptTool(tool: Pick<BuiltInToolConfig, "code">, input: any, helpers: BuiltInToolHelpers = {}) {
  const runner = new Function(
    "input",
    "helpers",
    `
      "use strict";
      const { pick_best_agent_for_question } = helpers;
      return (async () => {
        ${tool.code}
      })();
    `
  ) as (input: any, helpers: BuiltInToolHelpers) => Promise<any>;

  return await runner(input, helpers);
}
