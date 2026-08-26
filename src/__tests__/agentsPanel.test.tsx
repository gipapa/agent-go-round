import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AgentsPanel from "../ui/AgentsPanel";
import type { AgentConfig } from "../types";

const agent: AgentConfig = {
  id: "agent-1",
  name: "Agent",
  type: "custom",
  enableDocs: false,
  enableMcp: false,
  enableBuiltInTools: false,
  enableSkills: false,
  allowedDocIds: [],
  allowedMcpServerIds: [],
  allowedBuiltInToolIds: [],
  allowedSkillIds: []
};

describe("AgentsPanel access controls", () => {
  it("keeps agent permissions independent when Skills are enabled", () => {
    render(
      <AgentsPanel
        agents={[agent]}
        activeAgentId={agent.id}
        selectedAgentId={agent.id}
        onSelect={vi.fn()}
        onSetMain={vi.fn()}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onDetect={vi.fn()}
        docs={[]}
        mcpServers={[]}
        builtInTools={[]}
        skills={[]}
        loadBalancers={[]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const skillToggle = document.querySelector<HTMLInputElement>('[data-tutorial-id="agent-access-skills-toggle"]');
    expect(skillToggle).not.toBeNull();
    fireEvent.click(skillToggle!);

    for (const id of ["agent-access-docs-toggle", "agent-access-mcp-toggle", "agent-access-builtins-toggle"]) {
      const toggle = document.querySelector<HTMLInputElement>(`[data-tutorial-id="${id}"]`);
      expect(toggle).not.toBeNull();
      expect(toggle).toBeEnabled();
      expect(toggle).not.toBeChecked();
    }
  });
});
