import {
  AgentConfig,
  ChatMessage,
  MagiMode,
  MagiRenderState,
  MagiTranscriptEntry,
  MagiUnitId,
  MagiUnitVerdict,
  MagiVerdict
} from "../types";
import { generateId } from "../utils/id";

export const MAGI_META = {
  code: "473",
  file: "MAGI_SYS",
  ext: "STBY",
  exMode: "OFF",
  priority: "AAA"
} as const;

export const MAGI_UNIT_LAYOUT: Array<{ unitId: MagiUnitId; unitNumber: 1 | 2 | 3 }> = [
  { unitId: "Melchior", unitNumber: 1 },
  { unitId: "Balthasar", unitNumber: 2 },
  { unitId: "Casper", unitNumber: 3 }
];

export type MagiPreparedUnit = {
  unitId: MagiUnitId;
  unitNumber: 1 | 2 | 3;
  agent: AgentConfig;
  system: string;
};

type ParsedBallot = {
  verdict: MagiUnitVerdict;
  confidence: number;
  summary: string;
  rationale: string;
  concerns: string[];
  critique?: string;
  changedMind?: boolean;
};

type MagiUnitResult =
  | {
      ok: true;
      raw: string;
      ballot: ParsedBallot;
    }
  | {
      ok: false;
      raw: string;
      error: string;
    };

type MagiLogEntry = {
  unitId?: MagiUnitId;
  round?: number;
  ok?: boolean;
  message: string;
  details?: string;
};

export async function runMagi(args: {
  mode: MagiMode;
  question: string;
  units: MagiPreparedUnit[];
  history: ChatMessage[];
  maxConsensusRounds?: number;
  invokeUnit: (args: {
    unit: MagiPreparedUnit;
    prompt: string;
    requestLabel: string;
  }) => Promise<string>;
  onState?: (state: MagiRenderState) => void;
  onLog?: (entry: MagiLogEntry) => void;
}) {
  let state = createInitialState(args.mode, args.question, args.units);

  const publish = () => {
    args.onState?.({
      ...state,
      units: state.units.map((unit) => ({ ...unit, concerns: unit.concerns ? [...unit.concerns] : undefined })),
      transcript: state.transcript.map((entry) => ({ ...entry }))
    });
  };

  const log = (entry: MagiLogEntry) => args.onLog?.(entry);
  const maxRounds = Math.max(2, args.maxConsensusRounds ?? 3);

  publish();
  log({ message: `MAGI started (${args.mode})`, details: args.question });

  let previousBallots = new Map<MagiUnitId, ParsedBallot>();

  for (let round = 1; round <= (args.mode === "magi_vote" ? 1 : maxRounds); round++) {
    state.round = round;
    appendTranscript(state, {
      round,
      speaker: "SYSTEM",
      label: round === 1 ? "ROUND START" : "CONSENSUS ROUND",
      content: round === 1 ? "三賢人開始獨立審議。" : `開始第 ${round} 輪共識協商。`,
      kind: "system"
    });
    log({ round, message: "MAGI round start" });

    for (const unit of state.units) {
      unit.status = round === 1 ? "thinking" : "revised";
      unit.error = undefined;
    }
    publish();

    const roundResults = await Promise.all(
      args.units.map(async (unit) => {
        const prompt =
          round === 1
            ? buildVotePrompt({ question: args.question, unit })
            : buildConsensusPrompt({
                question: args.question,
                unit,
                round,
                previous: previousBallots.get(unit.unitId) ?? null,
                peers: args.units
                  .filter((peer) => peer.unitId !== unit.unitId)
                  .map((peer) => ({
                    unitId: peer.unitId,
                    ballot: previousBallots.get(peer.unitId) ?? null
                  }))
              });

        log({
          unitId: unit.unitId,
          round,
          message: "Unit request started"
        });

        try {
          const raw = await args.invokeUnit({
            unit,
            prompt,
            requestLabel: `magi ${unit.unitId} round ${round}`
          });
          const parsed = parseBallot(raw);
          if (!parsed.ok) {
            return {
              unit,
              result: {
                ok: false,
                raw,
                error: parsed.error
              } as MagiUnitResult
            };
          }
          return {
            unit,
            result: {
              ok: true,
              raw,
              ballot: parsed.ballot
            } as MagiUnitResult
          };
        } catch (error: any) {
          return {
            unit,
            result: {
              ok: false,
              raw: "",
              error: String(error?.message ?? error)
            } as MagiUnitResult
          };
        }
      })
    );

    let roundHasError = false;
    const nextBallots = new Map<MagiUnitId, ParsedBallot>();

    for (const { unit, result } of roundResults) {
      const stateUnit = state.units.find((entry) => entry.unitId === unit.unitId);
      if (!stateUnit) continue;

      if (!result.ok) {
        roundHasError = true;
        stateUnit.status = "error";
        stateUnit.verdict = "DEADLOCK";
        stateUnit.error = result.error;
        appendTranscript(state, {
          round,
          speaker: unit.unitId,
          label: `${unit.unitId} ERROR`,
          content: result.error,
          kind: "error"
        });
        log({
          unitId: unit.unitId,
          round,
          ok: false,
          message: "Unit failed",
          details: [result.error, result.raw].filter(Boolean).join("\n\n")
        });
        continue;
      }

      nextBallots.set(unit.unitId, result.ballot);
      stateUnit.status = round === 1 ? "voted" : "revised";
      stateUnit.verdict = result.ballot.verdict;
      stateUnit.confidence = result.ballot.confidence;
      stateUnit.summary = result.ballot.summary;
      stateUnit.rationale = result.ballot.rationale;
      stateUnit.concerns = result.ballot.concerns;
      stateUnit.critique = result.ballot.critique;
      stateUnit.changedMind = result.ballot.changedMind;

      appendTranscript(state, {
        round,
        speaker: unit.unitId,
        label: round === 1 ? `${unit.unitId} BALLOT` : `${unit.unitId} REVISION`,
        content: [
          `判定：${result.ballot.verdict}`,
          `信心：${result.ballot.confidence}`,
          `摘要：${result.ballot.summary}`,
          `理由：${result.ballot.rationale}`,
          result.ballot.critique ? `評論：${result.ballot.critique}` : "",
          result.ballot.concerns.length ? `保留：${result.ballot.concerns.join(" / ")}` : "",
          result.ballot.changedMind !== undefined ? `改變立場：${result.ballot.changedMind ? "是" : "否"}` : ""
        ]
          .filter(Boolean)
          .join("\n"),
        kind: round === 1 ? "ballot" : "critique"
      });
      log({
        unitId: unit.unitId,
        round,
        ok: true,
        message: "Unit responded",
        details: [
          `verdict=${result.ballot.verdict}`,
          `confidence=${result.ballot.confidence}`,
          `changed_mind=${result.ballot.changedMind ? "true" : "false"}`
        ].join("\n")
      });
    }

    publish();

    if (roundHasError) {
      state.status = "failed";
      state.finalVerdict = "DEADLOCK";
      state.finalSummary = "至少一位 MAGI 單位執行失敗，系統無法完成有效裁決。";
      state.informationText = "ERROR DETECTED";
      appendTranscript(state, {
        round,
        speaker: "SYSTEM",
        label: "DEADLOCK",
        content: state.finalSummary,
        kind: "error"
      });
      publish();
      log({ round, ok: false, message: "MAGI terminated by unit failure", details: state.finalSummary });
      return {
        state,
        answer: buildFinalAnswer({ question: args.question, state })
      };
    }

    previousBallots = nextBallots;
    const resolved = resolveFinalVerdict([...nextBallots.values()]);
    const unanimous = hasConsensus([...nextBallots.values()]);
    state.finalVerdict = resolved;
    state.finalSummary = buildFinalSummary({
      question: args.question,
      ballots: state.units
        .map((unit) => ({
          unitId: unit.unitId,
          verdict: unit.verdict,
          confidence: unit.confidence,
          summary: unit.summary,
          rationale: unit.rationale
        }))
        .filter((item): item is {
          unitId: MagiUnitId;
          verdict: MagiVerdict;
          confidence: number | undefined;
          summary: string | undefined;
          rationale: string | undefined;
        } => !!item.verdict),
      finalVerdict: resolved,
      mode: args.mode,
      round
    });
    state.informationText = unanimous
      ? "ALL THREE SYSTEMS ALIGNED"
      : resolved === "DEADLOCK"
      ? "CONSENSUS NOT REACHED"
      : "MAJORITY DECISION ACTIVE";

    appendTranscript(state, {
      round,
      speaker: "SYSTEM",
      label: "ROUND SUMMARY",
      content: `第 ${round} 輪結束，暫定決議：${resolved}`,
      kind: "system"
    });
    log({
      round,
      ok: true,
      message: "Consensus round summary",
      details: `temporary_verdict=${resolved}\nunanimous=${unanimous}`
    });
    publish();

    if (args.mode === "magi_vote" || unanimous) {
      state.status = "completed";
      publish();
      log({
        round,
        ok: true,
        message: "MAGI completed",
        details: `final_verdict=${resolved}`
      });
      return {
        state,
        answer: buildFinalAnswer({ question: args.question, state })
      };
    }
  }

  state.status = "completed";
  state.finalVerdict = resolveFinalVerdict(
    state.units
      .map((unit) => unit.verdict)
      .filter((verdict): verdict is MagiUnitVerdict => verdict === "APPROVE" || verdict === "REJECT" || verdict === "ABSTAIN")
      .map((verdict) => ({
        verdict,
        confidence: 0,
        summary: "",
        rationale: "",
        concerns: []
      }))
  );
  state.finalSummary =
    state.finalSummary ??
    "三賢人完成最大輪數的協商，系統已根據最新票型輸出最終決議。";
  publish();
  log({
    round: state.round,
    ok: true,
    message: "MAGI completed at max rounds",
    details: `final_verdict=${state.finalVerdict}`
  });
  return {
    state,
    answer: buildFinalAnswer({ question: args.question, state })
  };
}

export function createInitialState(mode: MagiMode, question: string, units: MagiPreparedUnit[]): MagiRenderState {
  return {
    mode,
    status: "running",
    question,
    round: 1,
    finalVerdict: undefined,
    finalSummary: "三賢人正在審議中。",
    informationText: "THREE SYSTEMS THINKING",
    code: MAGI_META.code,
    file: MAGI_META.file,
    ext: MAGI_META.ext,
    exMode: MAGI_META.exMode,
    priority: MAGI_META.priority,
    units: units.map((unit) => ({
      unitId: unit.unitId,
      unitNumber: unit.unitNumber,
      agentName: unit.agent.name,
      avatarUrl: unit.agent.avatarUrl,
      status: "thinking",
      summary: "思考中…"
    })),
    transcript: [
      {
        id: generateId(),
        round: 1,
        speaker: "SYSTEM",
        label: "BOOT",
        content: "S.C. MAGI 已完成啟動，三賢人開始同步審議。",
        kind: "system"
      }
    ]
  };
}

export function resolveFinalVerdict(ballots: Array<{ verdict: MagiUnitVerdict }>) {
  const counts = new Map<MagiUnitVerdict, number>([
    ["APPROVE", 0],
    ["REJECT", 0],
    ["ABSTAIN", 0]
  ]);
  ballots.forEach((ballot) => {
    counts.set(ballot.verdict, (counts.get(ballot.verdict) ?? 0) + 1);
  });
  if ((counts.get("APPROVE") ?? 0) >= 2) return "APPROVE" as const;
  if ((counts.get("REJECT") ?? 0) >= 2) return "REJECT" as const;
  if ((counts.get("ABSTAIN") ?? 0) >= 2) return "ABSTAIN" as const;
  return "DEADLOCK" as const;
}

function hasConsensus(ballots: ParsedBallot[]) {
  if (ballots.length !== 3) return false;
  return ballots.every((ballot) => ballot.verdict === ballots[0]?.verdict);
}

function buildVotePrompt(args: {
  question: string;
  unit: MagiPreparedUnit;
}) {
  return [
    `你是 S.C. MAGI 的 ${args.unit.unitId}。`,
    "現在是第一輪獨立裁決，不能依賴其他兩位的意見。",
    "請只根據你的角色設定與問題內容，給出結構化裁定。",
    "",
    "使用者提問：",
    args.question
  ].join("\n");
}

function buildConsensusPrompt(args: {
  question: string;
  unit: MagiPreparedUnit;
  round: number;
  previous: ParsedBallot | null;
  peers: Array<{ unitId: MagiUnitId; ballot: ParsedBallot | null }>;
}) {
  return [
    `你是 S.C. MAGI 的 ${args.unit.unitId}。`,
    `現在進入第 ${args.round} 輪共識協商。`,
    "請閱讀另外兩位上一輪的立場，指出你是否改變判斷，並給出新的結構化裁定。",
    "",
    "使用者提問：",
    args.question,
    "",
    "你上一輪的立場：",
    args.previous
      ? [
          `verdict=${args.previous.verdict}`,
          `confidence=${args.previous.confidence}`,
          `summary=${args.previous.summary}`,
          `rationale=${args.previous.rationale}`
        ].join("\n")
      : "(none)",
    "",
    "另外兩位上一輪的立場：",
    args.peers
      .map((peer) =>
        [
          `[${peer.unitId}]`,
          peer.ballot
            ? [
                `verdict=${peer.ballot.verdict}`,
                `confidence=${peer.ballot.confidence}`,
                `summary=${peer.ballot.summary}`,
                `rationale=${peer.ballot.rationale}`
              ].join("\n")
            : "no previous ballot"
        ].join("\n")
      )
      .join("\n\n")
  ].join("\n");
}

function sanitizeJsonText(text: string) {
  return text
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "\"")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(sanitizeJsonText(match[0])) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function normalizeUnitVerdict(value: unknown): MagiUnitVerdict | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "APPROVE" || normalized === "REJECT" || normalized === "ABSTAIN") {
    return normalized;
  }
  return null;
}

function normalizeConcerns(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .slice(0, 4);
  }
  const single = String(value ?? "").trim();
  return single ? [single] : [];
}

function parseBallot(text: string): { ok: true; ballot: ParsedBallot } | { ok: false; error: string } {
  const object = extractJsonObject(text);
  if (!object) {
    return { ok: false, error: "Invalid JSON ballot." };
  }

  const verdict = normalizeUnitVerdict(object.verdict);
  if (!verdict) {
    return { ok: false, error: "Ballot missing valid verdict." };
  }

  const confidenceRaw = Number(object.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(100, Math.round(confidenceRaw))) : 50;
  const summary = String(object.summary ?? "").trim();
  const rationale = String(object.rationale ?? "").trim();
  if (!summary || !rationale) {
    return { ok: false, error: "Ballot missing summary or rationale." };
  }

  return {
    ok: true,
    ballot: {
      verdict,
      confidence,
      summary,
      rationale,
      concerns: normalizeConcerns(object.concerns),
      critique: String(object.critique ?? "").trim() || undefined,
      changedMind: typeof object.changedMind === "boolean" ? object.changedMind : undefined
    }
  };
}

function appendTranscript(state: MagiRenderState, entry: Omit<MagiTranscriptEntry, "id">) {
  state.transcript = [...state.transcript, { id: generateId(), ...entry }];
}

function buildFinalSummary(args: {
  question: string;
  ballots: Array<{
    unitId: MagiUnitId;
    verdict: MagiVerdict;
    confidence?: number;
    summary?: string;
    rationale?: string;
  }>;
  finalVerdict: MagiVerdict;
  mode: MagiMode;
  round: number;
}) {
  const leading = args.ballots
    .filter((ballot) => ballot.verdict === args.finalVerdict)
    .map((ballot) => `${ballot.unitId}：${ballot.summary ?? ballot.rationale ?? "未提供摘要"}`)
    .slice(0, 2);

  if (args.finalVerdict === "DEADLOCK") {
    return `三賢人在${args.mode === "magi_vote" ? "同步表決" : `第 ${args.round} 輪協商`}後仍無法形成多數決，系統判定為膠着。`;
  }

  return [
    `S.C. MAGI 最終裁定為 ${args.finalVerdict}。`,
    leading.length ? `主要支持理由：${leading.join("；")}` : "",
    args.mode === "magi_consensus" ? `共識輪數：${args.round}` : "模式：同步表決"
  ]
    .filter(Boolean)
    .join(" ");
}

function buildFinalAnswer(args: { question: string; state: MagiRenderState }) {
  const lines = [
    "【S.C. MAGI 決議】",
    `問題：${args.question}`,
    `最終決議：${args.state.finalVerdict ?? "DEADLOCK"}`,
    args.state.finalSummary ? `摘要：${args.state.finalSummary}` : "",
    "",
    "【三賢人投票】",
    ...args.state.units.map((unit) => {
      const parts = [
        `${unit.unitId}：${unit.verdict ?? "ERROR"}`,
        unit.confidence !== undefined ? `信心 ${unit.confidence}` : "",
        unit.summary ? `摘要：${unit.summary}` : "",
        unit.error ? `錯誤：${unit.error}` : ""
      ].filter(Boolean);
      return `- ${parts.join(" ｜ ")}`;
    })
  ];

  return lines.filter(Boolean).join("\n");
}
