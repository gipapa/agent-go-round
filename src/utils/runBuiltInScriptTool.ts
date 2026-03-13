import { BuiltInToolConfig } from "../types";

export async function runBuiltInScriptTool(tool: Pick<BuiltInToolConfig, "code">, input: any) {
  const runner = new Function(
    "input",
    `
      "use strict";
      return (async () => {
        ${tool.code}
      })();
    `
  ) as (input: any) => Promise<any>;

  return await runner(input);
}
