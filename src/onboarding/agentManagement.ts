import { isManagedMagiAgent } from "../magi/managedAgents";
import type { AgentConfig, LoadBalancerConfig } from "../types";
import {
  TUTORIAL_AGENT_ROLE,
  TUTORIAL_PRIMARY_LOAD_BALANCER_NAME,
  TUTORIAL_SECONDARY_LOAD_BALANCER_NAME
} from "./runtime";

const TUTORIAL_LOAD_BALANCER_NAMES = new Set([
  TUTORIAL_PRIMARY_LOAD_BALANCER_NAME,
  TUTORIAL_SECONDARY_LOAD_BALANCER_NAME
]);

function isTutorialPrimaryAgent(agent: AgentConfig | null | undefined) {
  return !!agent && agent.tutorialRole === TUTORIAL_AGENT_ROLE && !isManagedMagiAgent(agent);
}

export function usesTutorialLoadBalancer(agent: AgentConfig, loadBalancers: LoadBalancerConfig[]) {
  if (!agent.loadBalancerId) return false;
  const loadBalancer = loadBalancers.find((entry) => entry.id === agent.loadBalancerId) ?? null;
  return !!loadBalancer && TUTORIAL_LOAD_BALANCER_NAMES.has(loadBalancer.name.trim());
}

export function findTutorialAgentBaseInList(agents: AgentConfig[], _loadBalancers: LoadBalancerConfig[]) {
  return agents.find((agent) => isTutorialPrimaryAgent(agent)) ?? null;
}

export function findTutorialAgentInList(agents: AgentConfig[], loadBalancers: LoadBalancerConfig[]) {
  const agent = findTutorialAgentBaseInList(agents, loadBalancers);
  if (!agent) return null;
  if (
    agent.enableDocs === false &&
    agent.enableMcp === false &&
    agent.enableBuiltInTools === false &&
    agent.enableSkills === false
  ) {
    return agent;
  }
  return null;
}

export function normalizeTutorialPrimaryAgentList(agents: AgentConfig[], loadBalancers: LoadBalancerConfig[]) {
  const taggedAgents = agents.filter((agent) => isTutorialPrimaryAgent(agent));
  const preferredTagged = taggedAgents[0] ?? null;
  const legacyCandidates = agents.filter((agent) => !isManagedMagiAgent(agent) && usesTutorialLoadBalancer(agent, loadBalancers));
  const fallbackLegacy = !preferredTagged && legacyCandidates.length === 1 ? legacyCandidates[0] : null;
  const primaryId = preferredTagged?.id ?? fallbackLegacy?.id ?? null;

  let changed = false;
  const next = agents.map((agent) => {
    if (isManagedMagiAgent(agent)) {
      if (agent.tutorialRole !== undefined) {
        changed = true;
        return { ...agent, tutorialRole: undefined };
      }
      return agent;
    }

    const shouldBePrimary = primaryId !== null && agent.id === primaryId;
    const nextRole: AgentConfig["tutorialRole"] = shouldBePrimary ? TUTORIAL_AGENT_ROLE : undefined;
    if (agent.tutorialRole !== nextRole) {
      changed = true;
      return { ...agent, tutorialRole: nextRole };
    }
    return agent;
  });

  return changed ? next : agents;
}
