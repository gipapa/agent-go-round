export const TUTORIAL_HARNESS_STABILITY_TOOL_NAME = "教學 Harness 驗證戳記工具";
export const TUTORIAL_HARNESS_STABILITY_TOOL_DESCRIPTION =
  "回傳固定的本地驗證戳記，用於確認 canonical harness 能將 Worker 工具結果回注入同一個 action loop。";
export const TUTORIAL_HARNESS_STABILITY_TOOL_INPUT_SCHEMA = {};
export const TUTORIAL_HARNESS_STABILITY_STAMP = "AGR-HARNESS-STABLE-V1";

// This deliberately has no browser, network, clock, or random dependency.
// Custom readonly tools run in a Worker, so the tutorial covers that effect
// path while remaining suitable for a repeated real-tutorial gate.
export const TUTORIAL_HARNESS_STABILITY_TOOL_CODE = `return {
  stamp: "${TUTORIAL_HARNESS_STABILITY_STAMP}",
  source: "local-worker",
  verified: true
};`;
