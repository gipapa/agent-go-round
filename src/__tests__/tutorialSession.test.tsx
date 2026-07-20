import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTutorialSession } from "../onboarding/useTutorialSession";
import { TutorialRuntimeState, TutorialScenarioDefinition } from "../onboarding/types";
import { AgentConfig } from "../types";

const scenario: TutorialScenarioDefinition = {
  id: "scenario",
  title: "Scenario",
  description: "",
  exitTitle: "Exit",
  exitBody: "Done",
  steps: [
    {
      id: "intro",
      title: "Intro",
      checklistLabel: "Read",
      instructionTitle: "Read",
      instructionBody: "Read this",
      behavior: "manual_info",
      automation: { activeAgentPreset: "tutorial_agent_base" }
    }
  ]
};

function runtimeBase(): Omit<TutorialRuntimeState, "scenarioId" | "openedToolResultMessageIds"> {
  return {
    agents: [],
    skills: [],
    activeAgentId: "",
    credentials: [],
    credentialTestResults: {},
    history: [],
    currentChatInput: "",
    historyMessageLimit: 10,
    builtInTools: [],
    docs: [],
    loadBalancers: [],
    mcpServers: [],
    mcpToolsByServer: {},
    userProfile: { name: "You", description: "", hasAvatar: false }
  };
}

describe("tutorial session", () => {
  it("derives the active step and evaluation from the selected scenario", () => {
    const { result } = renderHook(() => useTutorialSession({ runtimeBase: runtimeBase(), agents: [], loadBalancers: [] }));
    act(() => {
      result.current.setTutorialScenario(scenario);
      result.current.setTutorialScenarioIndex(0);
    });

    expect(result.current.tutorialActive).toBe(true);
    expect(result.current.tutorialPreviewLocked).toBe(true);
    expect(result.current.tutorialShowLandingPreview).toBe(true);
    expect(result.current.currentTutorialStep?.id).toBe("intro");
    expect(result.current.currentTutorialEvaluation).toMatchObject({ completed: true, canContinue: true });
  });

  it("derives locked-agent hints and warnings without mutating agents", () => {
    const base = runtimeBase();
    const { result, rerender } = renderHook(
      ({ agents }: { agents: AgentConfig[] }) => useTutorialSession({ runtimeBase: { ...base, agents }, agents, loadBalancers: [] }),
      { initialProps: { agents: [] as AgentConfig[] } }
    );
    act(() => result.current.setTutorialScenario(scenario));
    expect(result.current.tutorialActiveAgentHint).toBe("案例鎖定：尚未找到教學用主要 Agent");
    expect(result.current.tutorialActiveAgentWarning).toContain("找不到這個案例需要的主要 Agent");

    const tutorialAgent: AgentConfig = {
      id: "tutorial-agent",
      name: "Tutorial Agent",
      type: "openai_compat",
      tutorialRole: "primary"
    };
    rerender({ agents: [tutorialAgent] });
    expect(result.current.tutorialExpectedAgent).toBe(tutorialAgent);
    expect(result.current.tutorialActiveAgentHint).toBe("案例鎖定：Tutorial Agent");
    expect(result.current.tutorialActiveAgentWarning).toBeNull();
  });

  it("tracks opened tool results idempotently and resets session state", () => {
    const { result } = renderHook(() => useTutorialSession({ runtimeBase: runtimeBase(), agents: [], loadBalancers: [] }));
    act(() => {
      result.current.setTutorialScenario(scenario);
      result.current.setTutorialScenarioIndex(0);
      result.current.setTutorialStepIndex(0);
      result.current.setTutorialComposerSeed({ value: "prompt", token: 1 });
      result.current.setShowTutorialExitPrompt(true);
      result.current.markToolResultOpened("message-1");
      result.current.markToolResultOpened("message-1");
    });
    expect(result.current.tutorialOpenedToolResultMessageIds).toEqual(["message-1"]);

    act(() => result.current.resetTutorialSession());
    expect(result.current.tutorialScenario).toBeNull();
    expect(result.current.tutorialScenarioIndex).toBeNull();
    expect(result.current.tutorialComposerSeed).toBeNull();
    expect(result.current.tutorialOpenedToolResultMessageIds).toEqual([]);
    expect(result.current.showTutorialExitPrompt).toBe(false);
  });
});
