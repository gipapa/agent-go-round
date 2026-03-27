export const TUTORIAL_CLOCK_TOOL_NAME = "教學用時鐘工具";
export const TUTORIAL_CLOCK_TOOL_DESCRIPTION = "在頁面右下角打開可持續更新的時鐘 dashboard，顯示目前時間與時區。";
export const TUTORIAL_CLOCK_TOOL_INPUT_SCHEMA = {};
export const TUTORIAL_CLOCK_TOOL_CHAT_PROMPT = "請使用工具打開一個會持續更新的時鐘 dashboard，並告訴我目前時區。";

export const TUTORIAL_CLOCK_TOOL_CODE = `if (!dashboard) {
  throw new Error("目前環境沒有提供 dashboard helper。");
}

// 建立或重用教學用時鐘卡片，避免每次呼叫都疊出新的視窗。
const panel = dashboard.show({
  key: "tutorial-clock",
  title: "教學用時鐘",
  subtitle: "Built-in Tools 即時 dashboard"
});

panel.body.innerHTML = \`
  <style>
    .agr-clock {
      display: grid;
      gap: 14px;
      justify-items: center;
      color: #f5f8ff;
    }

    .agr-clock-face {
      position: relative;
      width: 220px;
      height: 220px;
      border-radius: 999px;
      background:
        radial-gradient(circle at 50% 42%, rgba(124, 155, 255, 0.18), transparent 58%),
        linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow:
        inset 0 0 0 1px rgba(255,255,255,0.04),
        0 18px 42px rgba(0, 0, 0, 0.32);
      overflow: hidden;
    }

    .agr-clock-ring {
      position: absolute;
      inset: 12px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.08);
    }

    .agr-clock-scale {
      position: absolute;
      left: 50%;
      top: 8px;
      width: 2px;
      height: 12px;
      transform-origin: center 102px;
      background: rgba(240, 245, 255, 0.55);
      border-radius: 999px;
      margin-left: -1px;
    }

    .agr-clock-scale--major {
      height: 18px;
      width: 3px;
      background: rgba(255, 255, 255, 0.92);
      margin-left: -1.5px;
    }

    .agr-clock-hand {
      position: absolute;
      left: 50%;
      bottom: 50%;
      transform-origin: center bottom;
      border-radius: 999px;
      translate: -50% 0;
    }

    .agr-clock-hand--hour {
      width: 7px;
      height: 56px;
      background: linear-gradient(180deg, #f6fbff, #87a8ff);
    }

    .agr-clock-hand--minute {
      width: 5px;
      height: 78px;
      background: linear-gradient(180deg, #f6fbff, #74d2ff);
    }

    .agr-clock-hand--second {
      width: 2px;
      height: 88px;
      background: linear-gradient(180deg, #ffd2a3, #ff7d58);
      box-shadow: 0 0 14px rgba(255, 125, 88, 0.38);
    }

    .agr-clock-center {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 14px;
      height: 14px;
      border-radius: 999px;
      background: #f5f8ff;
      box-shadow: 0 0 0 4px rgba(134, 166, 255, 0.24);
      translate: -50% -50%;
    }

    .agr-clock-meta {
      width: 100%;
      display: grid;
      gap: 8px;
      justify-items: center;
      text-align: center;
    }

    .agr-clock-digital {
      font-size: 30px;
      font-weight: 800;
      letter-spacing: 0.08em;
      font-variant-numeric: tabular-nums;
    }

    .agr-clock-date {
      font-size: 13px;
      opacity: 0.78;
    }

    .agr-clock-timezone {
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(255,255,255,0.05);
      font-size: 12px;
      letter-spacing: 0.04em;
      opacity: 0.9;
    }
  </style>
  <div class="agr-clock">
    <div class="agr-clock-face" data-clock-face>
      <div class="agr-clock-ring"></div>
      <div class="agr-clock-hand agr-clock-hand--hour" data-hour-hand></div>
      <div class="agr-clock-hand agr-clock-hand--minute" data-minute-hand></div>
      <div class="agr-clock-hand agr-clock-hand--second" data-second-hand></div>
      <div class="agr-clock-center"></div>
    </div>
    <div class="agr-clock-meta">
      <div class="agr-clock-digital" data-digital-time>--:--:--</div>
      <div class="agr-clock-date" data-date-label>載入中...</div>
      <div class="agr-clock-timezone" data-timezone-label>載入中...</div>
    </div>
  </div>
\`;

const face = panel.body.querySelector("[data-clock-face]");
const hourHand = panel.body.querySelector("[data-hour-hand]");
const minuteHand = panel.body.querySelector("[data-minute-hand]");
const secondHand = panel.body.querySelector("[data-second-hand]");
const digitalTime = panel.body.querySelector("[data-digital-time]");
const dateLabel = panel.body.querySelector("[data-date-label]");
const timezoneLabel = panel.body.querySelector("[data-timezone-label]");

if (!face || !hourHand || !minuteHand || !secondHand || !digitalTime || !dateLabel || !timezoneLabel) {
  throw new Error("時鐘 dashboard 初始化失敗。");
}

// 產生 60 個刻度，每 5 格加長，對應鐘面的整點刻度。
for (let index = 0; index < 60; index += 1) {
  const scale = document.createElement("div");
  scale.className = \`agr-clock-scale\${index % 5 === 0 ? " agr-clock-scale--major" : ""}\`;
  scale.style.transform = \`rotate(\${index * 6}deg)\`;
  face.appendChild(scale);
}

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function updateClock() {
  const now = new Date();
  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours() % 12;

  // 秒針、分針、時針都用角度旋轉，這是傳統鐘面最直觀的做法。
  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = hours * 30 + minutes * 0.5;

  hourHand.style.transform = \`translateX(-50%) rotate(\${hourDeg}deg)\`;
  minuteHand.style.transform = \`translateX(-50%) rotate(\${minuteDeg}deg)\`;
  secondHand.style.transform = \`translateX(-50%) rotate(\${secondDeg}deg)\`;

  digitalTime.textContent = now.toLocaleTimeString("zh-TW", { hour12: false });
  dateLabel.textContent = now.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });
  timezoneLabel.textContent = timezone;
}

updateClock();

const timer = window.setInterval(updateClock, 1000);
dashboard.registerCleanup(panel.id, () => {
  window.clearInterval(timer);
});

return {
  dashboardId: panel.id,
  started: true,
  timezone,
  message: "已在頁面右下角打開可持續更新的時鐘 dashboard。"
};`;

export const TUTORIAL_TIME_TOOL_NAME = TUTORIAL_CLOCK_TOOL_NAME;
export const TUTORIAL_TIME_TOOL_DESCRIPTION = TUTORIAL_CLOCK_TOOL_DESCRIPTION;
export const TUTORIAL_TIME_TOOL_INPUT_SCHEMA = TUTORIAL_CLOCK_TOOL_INPUT_SCHEMA;
export const TUTORIAL_TIME_TOOL_CODE = TUTORIAL_CLOCK_TOOL_CODE;
