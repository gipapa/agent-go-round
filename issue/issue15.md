# Issue 15 — MAGI consensus 模式：無 deadlock detection、無 global / round timeout

## 嚴重度
Medium

## 觀察到的問題
`src/orchestrators/magi.ts` 的 consensus 模式有兩個 reliability 問題：

### 問題 1：可能 deadlock，仍跑滿 maxRounds
consensus 流程：
```
Round 1: Unit A=APPROVE, B=REJECT, C=ABSTAIN
Round 2: 根據 round 1 的 ballots 重新表決 → A 還是 APPROVE, B 還是 REJECT, C 還是 ABSTAIN
Round 3: 同上
...
```
每個 unit 可能基於自己的 reasoning 持續持守相同立場，三方無共識。

目前實作（`src/orchestrators/magi.ts:90+`）：
- 用 `for (let round = 1; round <= maxRounds; round++)` 跑滿
- **沒有 early-exit**：即使連續 N 輪所有 ballots 都跟上一輪相同，仍繼續跑下一輪
- 每一輪都打 model API（每 unit 一次），燒 token
- 最終 deadlock 會落到 `args.mode === "magi_vote" ? 1 : maxRounds` 的最大值才結束

理想應該是：
- 偵測到「本輪所有 ballot 與上輪完全相同」→ 視為 deadlock，提早結束並輸出「無法達成共識」
- 偵測到「已達多數共識」（例如 2/3 同 verdict）→ 提早結束

### 問題 2：一個 unit hang 整輪卡住
```ts
const roundResults = await Promise.all(
  args.units.map(async (unit) => { ... })
);
```
- `Promise.all` 等待最慢的 unit
- 結合 Issue 11（fetch 無 timeout）→ 一個 unit 卡 5 分鐘，整個 MAGI consensus 卡 5 分鐘
- 結合 Issue 13（無 deadline）→ maxRounds × 最慢 unit = 全 hang

### 問題 3：每輪都重打全部 unit
即使某些 unit 在前一輪已經明確「不會改變立場」（例如 ballot 內含「我堅持」），下一輪還是會重新詢問。沒有 short-circuit。

### 問題 4：error 處理 silent
```ts
} catch (error: any) {
  return {
    unit,
    result: { ok: false, raw: "", error: String(error?.message ?? error) }
  };
}
```
- 一個 unit 拋錯，那一輪就有 ballot.ok === false
- 但 consensus 邏輯怎麼處理「2 ok + 1 error」？沒看到明確策略
- 可能會繼續跑下一輪期望 retry，但 error unit 的 prompt 仍會用 null ballot 帶下去

## 來源檔案
- `src/orchestrators/magi.ts`（整個主迴圈，特別是 ~L90-200）
- `src/magi/magiSkills.ts`（ballot / consensus 規則）
- `src/__tests__/magi.test.ts`（既有測試，可能沒涵蓋 deadlock case）

## 建議做法

### Step 1：加 deadlock detection
```ts
function ballotsAreIdentical(a: Map<MagiUnitId, ParsedBallot>, b: Map<MagiUnitId, ParsedBallot>): boolean {
  if (a.size !== b.size) return false;
  for (const [unitId, ballotA] of a) {
    const ballotB = b.get(unitId);
    if (!ballotB) return false;
    if (ballotA.verdict !== ballotB.verdict) return false;
    // 必要時也比對 reasoning hash
  }
  return true;
}

// 主迴圈內：
let stuckRounds = 0;
for (let round = 1; round <= maxRounds; round++) {
  // ... 跑這一輪 ...
  const currentBallots = collectBallots(roundResults);
  if (round > 1 && ballotsAreIdentical(previousBallots, currentBallots)) {
    stuckRounds++;
    if (stuckRounds >= 2) {  // 連續兩輪沒變化
      log({ message: "MAGI consensus deadlock detected", round });
      state.outcome = "deadlock";
      break;
    }
  } else {
    stuckRounds = 0;
  }
  previousBallots = currentBallots;
}
```

### Step 2：加 majority early-exit
```ts
function checkMajority(ballots: Map<MagiUnitId, ParsedBallot>, threshold = 2): MagiVerdict | null {
  const counts = new Map<MagiVerdict, number>();
  for (const ballot of ballots.values()) {
    counts.set(ballot.verdict, (counts.get(ballot.verdict) ?? 0) + 1);
  }
  for (const [verdict, count] of counts) {
    if (count >= threshold) return verdict;
  }
  return null;
}

// 主迴圈內：
const majority = checkMajority(currentBallots);
if (majority) {
  state.outcome = majority;
  break;
}
```

### Step 3：每輪加 timeout + 個別 unit timeout
```ts
const ROUND_TIMEOUT_MS = 60_000;
const UNIT_TIMEOUT_MS = 30_000;

const roundResults = await Promise.race([
  Promise.all(args.units.map(async (unit) => {
    return await Promise.race([
      runUnit(unit),
      timeoutAfter(UNIT_TIMEOUT_MS, "unit timeout")
    ]);
  })),
  timeoutAfter(ROUND_TIMEOUT_MS, "round timeout")
]);
```

更穩的做法：用 `Promise.allSettled` + 個別 timeout，讓快的 unit 結果保留，慢的 unit 標記為 timeout（fallback verdict 或要求 retry）。

### Step 4：error unit 處理策略寫清楚
明確定義：
- 錯誤 unit 是否可以 retry？最多幾次？
- 連續 N 個錯誤 unit 應放棄整個 MAGI 並回傳 error
- 錯誤 unit 在下一輪 prompt 內如何呈現給其他 unit

### Step 5：補測試（搭配 Issue 9）
- deadlock case：mock unit 永遠回相同 ballot
- majority case：3 輪內達成 2/3 多數
- timeout case：mock unit 故意 hang
- error case：mock unit 拋錯

## 與其他 issue 的關聯
- 屬於 Batch 4 的「reliability / resource limits」範疇
- timeout 機制與 Issue 13 共用同一套 deadline helper
- error handling 與 Issue 11（fetch 取消 / retry）綁

## 驗收條件
- mock 三個永不改變立場的 unit，consensus 應在連續 2 輪相同後結束（不跑滿 maxRounds）
- mock 一個 hang 的 unit，整輪在 round timeout 內結束，其他 unit 結果保留
- 已達 2/3 多數時提早結束，不再進下一輪
- 所有 magi.test.ts 既有測試仍綠

## 影響
- token 浪費：deadlock 時跑滿 maxRounds 而不是 early-exit
- 體驗：一個 unit hang 整個 MAGI 卡死
- 缺乏 deadlock 訊號：使用者看不到「為什麼這次沒結論」的明確原因
