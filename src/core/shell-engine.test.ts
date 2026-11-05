// @vitest-environment node
import { expect, it } from "vitest";
import { Bash } from "just-bash/browser";
import { execShellEngine } from "./shell-engine";

it("reports actual cwd independently of PWD, exit, eval, functions and subshells", async () => {
  const bash = new Bash({ cwd: "/home/user", env: { HOME: "/home/user" } });
  await bash.fs.mkdir("/home/user/docs", { recursive: true });
  for (const script of ["cd docs; PWD=/tmp", "cd docs; exit 7", 'eval "cd docs; exit 3"', 'f() { cd docs; }; f', 'source <(printf "cd /home/user/docs")']) {
    expect((await execShellEngine(bash, script)).cwd).toBe("/home/user/docs");
  }
  expect((await execShellEngine(bash, "(cd docs); PWD=/tmp")).cwd).toBe("/home/user");
  expect((await execShellEngine(bash, "printf '%s' \"$(cd docs; pwd)\"")).cwd).toBe("/home/user");
  expect((await execShellEngine(bash, "")).cwd).toBe("/home/user");
  expect(bash.getCwd()).toBe("/home/user");
});

it("reports cwd after a step limit without persisting the rest of the shell session", async () => {
  const bash = new Bash({ cwd: "/home/user", executionLimits: { maxLoopIterations: 5 } });
  await bash.fs.mkdir("/home/user/docs", { recursive: true });
  const result = await execShellEngine(bash, "cd docs; export VALUE=one; while true; do :; done");
  expect(result.cwd).toBe("/home/user/docs"); expect(result.exitCode).not.toBe(0);
  expect((await execShellEngine(bash, "echo ${VALUE-unset}")).stdout).toBe("unset\n");
});

it("resolves mixed-case commands after expansion while preserving data, paths and variable case", async () => {
  const bash = new Bash({ cwd: "/home/user" });
  const result = await execShellEngine(bash, `
    MkDiR Mixed
    CD Mixed
    PrInTf '%s\\n' MiXeD > Case.TXT
    cmd=CaT; "$cmd" Case.TXT | GrEp MiXeD
    EXPORT Value='Keep Case'; ECHO "$Value:\${value-unset}"
    COMMAND ECHO Command
    BUILTIN ECHO Builtin
    EVAL 'ECHO Eval'
    Fn() { LOCAL Value='Function Case'; ECHO "$Value"; }; fN
    READ -r Line <<< 'Read Case'; ECHO "$Line"
    BASH -c 'ECHO Child'
  `);
  expect(result).toMatchObject({ exitCode: 0, stderr: "", cwd: "/home/user/Mixed" });
  expect(result.stdout).toBe("MiXeD\nKeep Case:unset\nCommand\nBuiltin\nEval\nFunction Case\nRead Case\nChild\n");
  expect(await execShellEngine(bash, "TYPE ECHO; WHICH CAT; HELP CD")).toMatchObject({ exitCode: 0, stderr: "" });
  expect((await execShellEngine(bash, "cat Mixed/case.txt")).exitCode).not.toBe(0);
});
