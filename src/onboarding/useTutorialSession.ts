import { useMemo, useState } from "react";
import { AgentConfig, LoadBalancerConfig } from "../types";
import { findTutorialAgentBaseInList, findTutorialAgentInList } from "./agentManagement";
import { evaluateTutorialStep } from "./runtime";
import {
  TutorialRuntimeState,
  TutorialScenarioDefinition,
  TutorialStepEvaluation
} from "./types";

type TutorialRuntimeBase = Omit<TutorialRuntimeState, "scenarioId" | "openedToolResultMessageIds">;

type UseTutorialSessionArgs = {
  runtimeBase: TutorialRuntimeBase;
  agents: AgentConfig[];
  loadBalancers: LoadBalancerConfig[];
};

export function useTutorialSession({ runtimeBase, agents, loadBalancers }: UseTutorialSessionArgs) {
  const [tutorialScenario, setTutorialScenario] = useState<TutorialScenarioDefinition | null>(null);
  const [tutorialScenarioIndex, setTutorialScenarioIndex] = useState<number | null>(null);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [showTutorialExitPrompt, setShowTutorialExitPrompt] = useState(false);
  const [tutorialUnavailableMessage, setTutorialUnavailableMessage] = useState<string | null>(null);
  const [tutorialComposerSeed, setTutorialComposerSeed] = useState<{ value: string; token: number } | null>(null);
  const [tutorialOpenedToolResultMessageIds, setTutorialOpenedToolResultMessageIds] = useState<string[]>([]);

  const tutorialRuntimeState = useMemo<TutorialRuntimeState>(() => ({
    ...runtimeBase,
    scenarioId: tutorialScenario?.id,
    openedToolResultMessageIds: tutorialOpenedToolResultMessageIds
  }), [runtimeBase, tutorialOpenedToolResultMessageIds, tutorialScenario?.id]);

  const tutorialEvaluations = useMemo<TutorialStepEvaluation[]>(
    () => tutorialScenario?.steps.map((step) => evaluateTutorialStep(step, tutorialRuntimeState)) ?? [],
    [tutorialRuntimeState, tutorialScenario]
  );
  const currentTutorialStep = tutorialScenario?.steps[tutorialStepIndex] ?? null;
  const currentTutorialEvaluation = tutorialScenario ? tutorialEvaluations[tutorialStepIndex] ?? null : null;
  const tutorialExpectedAgent = useMemo(() => {
    const preset = currentTutorialStep?.automation?.activeAgentPreset;
    if (preset === "tutorial_agent") return findTutorialAgentInList(agents, loadBalancers);
    if (preset === "tutorial_agent_base") return findTutorialAgentBaseInList(agents, loadBalancers);
    return null;
  }, [agents, currentTutorialStep, loadBalancers]);

  const tutorialActiveAgentHint = useMemo(() => {
    const preset = currentTutorialStep?.automation?.activeAgentPreset;
    if (!preset) return null;
    if (tutorialExpectedAgent) return `案例鎖定：${tutorialExpectedAgent.name}`;
    return "案例鎖定：尚未找到教學用主要 Agent";
  }, [currentTutorialStep, tutorialExpectedAgent]);
  const tutorialActiveAgentWarning = useMemo(() => {
    const preset = currentTutorialStep?.automation?.activeAgentPreset;
    if (!preset || tutorialExpectedAgent) return null;
    return "目前找不到這個案例需要的主要 Agent。若你略過案例 1 的建立 Agent，後續案例將無法完成。";
  }, [currentTutorialStep, tutorialExpectedAgent]);

  function markToolResultOpened(messageId: string) {
    setTutorialOpenedToolResultMessageIds((current) => current.includes(messageId) ? current : [...current, messageId]);
  }

  function resetTutorialSession() {
    setTutorialScenario(null);
    setTutorialScenarioIndex(null);
    setTutorialStepIndex(0);
    setTutorialComposerSeed(null);
    setTutorialOpenedToolResultMessageIds([]);
    setShowTutorialExitPrompt(false);
  }

  return {
    tutorialScenario,
    setTutorialScenario,
    tutorialScenarioIndex,
    setTutorialScenarioIndex,
    tutorialStepIndex,
    setTutorialStepIndex,
    showTutorialExitPrompt,
    setShowTutorialExitPrompt,
    tutorialUnavailableMessage,
    setTutorialUnavailableMessage,
    tutorialComposerSeed,
    setTutorialComposerSeed,
    tutorialOpenedToolResultMessageIds,
    setTutorialOpenedToolResultMessageIds,
    tutorialRuntimeState,
    tutorialEvaluations,
    currentTutorialStep,
    currentTutorialEvaluation,
    tutorialExpectedAgent,
    tutorialActiveAgentHint,
    tutorialActiveAgentWarning,
    tutorialActive: !!tutorialScenario,
    tutorialPreviewLocked: !!tutorialScenario && tutorialStepIndex === 0,
    tutorialShowLandingPreview: !!tutorialScenario && tutorialStepIndex === 0 && tutorialScenarioIndex === 0,
    markToolResultOpened,
    resetTutorialSession
  };
}
