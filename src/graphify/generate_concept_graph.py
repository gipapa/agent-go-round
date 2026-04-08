from __future__ import annotations

import json
from pathlib import Path

from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.detect import detect
from graphify.export import to_html, to_json
from graphify.report import generate


ROOT = Path(__file__).resolve().parent
CORPUS = ROOT / "corpus"


def node(
    node_id: str,
    label: str,
    *,
    file_type: str = "document",
    source_file: str,
) -> dict:
    return {
        "id": node_id,
        "label": label,
        "file_type": file_type,
        "source_file": source_file,
        "source_location": None,
        "source_url": None,
        "captured_at": None,
        "author": None,
        "contributor": None,
    }


def edge(
    source: str,
    target: str,
    relation: str,
    *,
    confidence: str = "EXTRACTED",
    confidence_score: float = 1.0,
    source_file: str,
    weight: float = 1.0,
) -> dict:
    return {
        "source": source,
        "target": target,
        "relation": relation,
        "confidence": confidence,
        "confidence_score": confidence_score,
        "source_file": source_file,
        "source_location": None,
        "weight": weight,
    }


def hyperedge(
    edge_id: str,
    label: str,
    nodes: list[str],
    relation: str,
    *,
    confidence: str = "EXTRACTED",
    confidence_score: float = 1.0,
    source_file: str,
) -> dict:
    return {
        "id": edge_id,
        "label": label,
        "nodes": nodes,
        "relation": relation,
        "confidence": confidence,
        "confidence_score": confidence_score,
        "source_file": source_file,
    }


def build_extraction() -> dict:
    nodes = [
        node("product", "AgentGoRound", source_file="README.md"),
        node("browser_first", "Browser-first Frontend-only Playground", source_file="README.md"),
        node("github_pages", "GitHub Pages Deployment", source_file="README.md"),
        node("landing_page", "Landing Page", source_file="src/ui/LandingPage.tsx"),
        node("app_shell", "App.tsx Shell", file_type="code", source_file="src/app/App.tsx"),
        node("agent_workspace", "Agent Workspace", source_file="src/graphify/corpus/02-agent-and-routing.md"),
        node("load_balancer", "Load Balancer", source_file="src/utils/loadBalancer.ts"),
        node("credential_pool", "Credential Pool", source_file="src/storage/settingsStore.ts"),
        node("docs_context", "Docs Context", source_file="README.md"),
        node("mcp_integration", "MCP Integration", source_file="src/ui/McpPanel.tsx"),
        node("built_in_tools", "Built-in Tools", source_file="src/ui/BuiltInToolsPanel.tsx"),
        node("render_anything", "Render Anything Pattern", source_file="render_anything.md"),
        node("dashboard_helper", "Dashboard Helper", file_type="code", source_file="src/utils/toolDashboard.ts"),
        node("skills", "Skills", source_file="README.md"),
        node("multi_turn_runtime", "Multi-turn Skill Runtime", source_file="agentic.md"),
        node("skill_runtime_design", "Skill Runtime Design Draft", source_file="docs/skill-runtime-design.md"),
        node("browser_workflow", "Browser Workflow Skill", source_file="src/graphify/corpus/03-browser-and-skill-runtime.md"),
        node("browser_observation", "Browser Observation Digest", file_type="code", source_file="src/runtime/browserObservation.ts"),
        node("tutorials", "Tutorial Scenarios", source_file="src/onboarding/catalog.ts"),
        node("tutorial_runtime", "Tutorial Runtime", file_type="code", source_file="src/onboarding/runtime.ts"),
        node("case5", "Case 5 Browser MCP Tutorial", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        node("case6", "Case 6 GitHub Trending Tutorial", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        node("magi_mode", "MAGI Mode", source_file="src/orchestrators/magi.ts"),
        node("magi_vote", "Magi Vote", source_file="src/orchestrators/magi.ts"),
        node("magi_consensus", "Magi Consensus", source_file="src/orchestrators/magi.ts"),
        node("magi_skills", "Magi Skills", source_file="src/magi/magiSkills.ts"),
        node("graphify_concept_graph", "Graphify Concept Graph", source_file="src/graphify/corpus/06-visualization-and-rendering.md"),
        node("intro_guide", "Intro Guide", source_file="public/intro/index.html"),
        node("vendored_agent_browser", "Vendored agent-browser", source_file="mcp-test/agent-browser-sse/vendor/agent-browser/README.md"),
        node("local_first_reason", "Local-first experimentation without mandatory backend", source_file="README.md"),
        node("controlled_access_reason", "Controlled access avoids agent behavior drift", source_file="src/graphify/corpus/05-magi-and-special-modes.md"),
        node("concept_first_reason", "Concept-first graph avoids vendor noise and code-only bias", source_file="src/graphify/corpus/06-visualization-and-rendering.md"),
    ]

    edges = [
        edge("product", "browser_first", "references", source_file="README.md"),
        edge("product", "github_pages", "references", source_file="README.md"),
        edge("product", "agent_workspace", "conceptually_related_to", source_file="src/graphify/corpus/01-product-overview.md"),
        edge("product", "docs_context", "conceptually_related_to", source_file="src/graphify/corpus/01-product-overview.md"),
        edge("product", "mcp_integration", "conceptually_related_to", source_file="src/graphify/corpus/01-product-overview.md"),
        edge("product", "built_in_tools", "conceptually_related_to", source_file="src/graphify/corpus/01-product-overview.md"),
        edge("product", "skills", "conceptually_related_to", source_file="src/graphify/corpus/01-product-overview.md"),
        edge("product", "tutorials", "conceptually_related_to", source_file="src/graphify/corpus/01-product-overview.md"),
        edge("product", "magi_mode", "conceptually_related_to", source_file="src/graphify/corpus/01-product-overview.md"),
        edge("product", "graphify_concept_graph", "conceptually_related_to", source_file="src/graphify/corpus/06-visualization-and-rendering.md"),
        edge("browser_first", "github_pages", "conceptually_related_to", source_file="README.md"),
        edge("browser_first", "local_first_reason", "rationale_for", source_file="README.md"),
        edge("app_shell", "agent_workspace", "conceptually_related_to", source_file="src/app/App.tsx"),
        edge("app_shell", "landing_page", "conceptually_related_to", source_file="src/app/App.tsx"),
        edge("app_shell", "magi_mode", "conceptually_related_to", source_file="src/app/App.tsx"),
        edge("landing_page", "tutorials", "references", source_file="src/ui/LandingPage.tsx"),
        edge("landing_page", "intro_guide", "references", source_file="public/intro/index.html"),
        edge("intro_guide", "tutorials", "conceptually_related_to", source_file="public/intro/index.html"),
        edge("agent_workspace", "load_balancer", "conceptually_related_to", source_file="src/graphify/corpus/02-agent-and-routing.md"),
        edge("agent_workspace", "credential_pool", "conceptually_related_to", source_file="src/graphify/corpus/02-agent-and-routing.md"),
        edge("load_balancer", "credential_pool", "shares_data_with", source_file="src/utils/loadBalancer.ts"),
        edge("load_balancer", "skills", "conceptually_related_to", source_file="src/graphify/corpus/02-agent-and-routing.md", confidence="INFERRED", confidence_score=0.74),
        edge("load_balancer", "mcp_integration", "conceptually_related_to", source_file="src/graphify/corpus/02-agent-and-routing.md", confidence="INFERRED", confidence_score=0.67),
        edge("skills", "multi_turn_runtime", "references", source_file="agentic.md"),
        edge("multi_turn_runtime", "skill_runtime_design", "references", source_file="agentic.md"),
        edge("skill_runtime_design", "browser_workflow", "conceptually_related_to", source_file="docs/skill-runtime-design.md"),
        edge("multi_turn_runtime", "browser_workflow", "conceptually_related_to", source_file="src/graphify/corpus/03-browser-and-skill-runtime.md"),
        edge("multi_turn_runtime", "browser_observation", "references", source_file="src/graphify/corpus/03-browser-and-skill-runtime.md"),
        edge("browser_workflow", "mcp_integration", "conceptually_related_to", source_file="src/graphify/corpus/03-browser-and-skill-runtime.md"),
        edge("browser_workflow", "case6", "references", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        edge("browser_workflow", "case5", "references", source_file="src/graphify/corpus/04-tutorials-and-learning.md", confidence="INFERRED", confidence_score=0.71),
        edge("browser_observation", "case6", "conceptually_related_to", source_file="src/runtime/browserObservation.ts"),
        edge("mcp_integration", "vendored_agent_browser", "references", source_file="src/ui/McpPanel.tsx"),
        edge("vendored_agent_browser", "browser_workflow", "conceptually_related_to", source_file="src/graphify/corpus/03-browser-and-skill-runtime.md", confidence="INFERRED", confidence_score=0.61),
        edge("tutorials", "tutorial_runtime", "references", source_file="src/onboarding/runtime.ts"),
        edge("tutorials", "case5", "references", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        edge("tutorials", "case6", "references", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        edge("tutorial_runtime", "case5", "conceptually_related_to", source_file="src/onboarding/runtime.ts"),
        edge("tutorial_runtime", "case6", "conceptually_related_to", source_file="src/onboarding/runtime.ts"),
        edge("case5", "mcp_integration", "conceptually_related_to", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        edge("case6", "browser_workflow", "conceptually_related_to", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        edge("case6", "multi_turn_runtime", "conceptually_related_to", source_file="src/graphify/corpus/04-tutorials-and-learning.md"),
        edge("built_in_tools", "render_anything", "references", source_file="render_anything.md"),
        edge("built_in_tools", "dashboard_helper", "conceptually_related_to", source_file="src/utils/toolDashboard.ts"),
        edge("render_anything", "dashboard_helper", "references", source_file="render_anything.md"),
        edge("render_anything", "graphify_concept_graph", "semantically_similar_to", source_file="src/graphify/corpus/06-visualization-and-rendering.md", confidence="INFERRED", confidence_score=0.72),
        edge("magi_mode", "magi_vote", "references", source_file="src/orchestrators/magi.ts"),
        edge("magi_mode", "magi_consensus", "references", source_file="src/orchestrators/magi.ts"),
        edge("magi_mode", "magi_skills", "conceptually_related_to", source_file="src/magi/magiSkills.ts"),
        edge("magi_vote", "magi_skills", "conceptually_related_to", source_file="src/magi/magiSkills.ts"),
        edge("magi_consensus", "magi_skills", "conceptually_related_to", source_file="src/magi/magiSkills.ts"),
        edge("magi_mode", "controlled_access_reason", "rationale_for", source_file="src/graphify/corpus/05-magi-and-special-modes.md"),
        edge("graphify_concept_graph", "concept_first_reason", "rationale_for", source_file="src/graphify/corpus/06-visualization-and-rendering.md"),
        edge("graphify_concept_graph", "landing_page", "conceptually_related_to", source_file="src/graphify/corpus/06-visualization-and-rendering.md"),
        edge("graphify_concept_graph", "intro_guide", "conceptually_related_to", source_file="src/graphify/corpus/06-visualization-and-rendering.md"),
        edge("docs_context", "skills", "semantically_similar_to", source_file="src/graphify/corpus/01-product-overview.md", confidence="INFERRED", confidence_score=0.63),
    ]

    hyperedges = [
        hyperedge(
            "product_surface",
            "Core Product Surface",
            ["agent_workspace", "docs_context", "mcp_integration", "built_in_tools", "skills", "tutorials"],
            "participate_in",
            source_file="src/graphify/corpus/01-product-overview.md",
        ),
        hyperedge(
            "agent_execution_stack",
            "Agent Execution Stack",
            ["agent_workspace", "load_balancer", "credential_pool", "skills"],
            "form",
            source_file="src/graphify/corpus/02-agent-and-routing.md",
        ),
        hyperedge(
            "browser_automation_loop",
            "Browser Automation Loop",
            ["mcp_integration", "browser_workflow", "multi_turn_runtime", "browser_observation", "case6"],
            "participate_in",
            source_file="src/graphify/corpus/03-browser-and-skill-runtime.md",
        ),
    ]

    return {
        "nodes": nodes,
        "edges": edges,
        "hyperedges": hyperedges,
        "input_tokens": 0,
        "output_tokens": 0,
    }


def infer_community_labels(graph, communities: dict[int, list[str]]) -> dict[int, str]:
    def labels_for(cid: int) -> list[str]:
        return [graph.nodes[node_id].get("label", "").lower() for node_id in communities.get(cid, [])]

    def has_term(bucket: list[str], terms: tuple[str, ...]) -> bool:
        return any(term in label for label in bucket for term in terms)

    labels: dict[int, str] = {}
    used: set[str] = set()

    for cid in communities:
        bucket = labels_for(cid)
        if any("magi" in label for label in bucket):
            name = "Magi Deliberation"
        elif has_term(bucket, ("browser workflow", "multi-turn", "mcp integration", "browser observation", "github trending")):
            name = "Browser Automation"
        elif has_term(bucket, ("built-in", "render anything", "dashboard helper", "graphify concept graph")):
            name = "Tooling & Visualization"
        elif has_term(bucket, ("tutorial", "landing", "intro guide")):
            name = "Learning & Entry"
        elif has_term(bucket, ("agent workspace", "load balancer", "credential pool", "app.tsx shell")):
            name = "Agent Configuration"
        else:
            name = "Product Narrative"

        if name in used:
            name = f"{name} {cid}"
        used.add(name)
        labels[cid] = name

    return labels


def main() -> None:
    detection = detect(CORPUS)
    detection["warning"] = "Concept-first curated corpus; the graph is meant to expose cross-feature links, not just compress a large raw corpus."
    extraction = build_extraction()
    graph = build_from_json(extraction)
    communities = cluster(graph)
    cohesion = score_all(graph, communities)
    labels = infer_community_labels(graph, communities)
    gods = god_nodes(graph, top_n=8)
    surprises = surprising_connections(graph, communities, top_n=8)
    questions = suggest_questions(graph, communities, labels)
    tokens = {"input": 0, "output": 0}

    report = generate(
        graph,
        communities,
        cohesion,
        labels,
        gods,
        surprises,
        detection,
        tokens,
        "AgentGoRound Concept Corpus",
        suggested_questions=questions,
    )

    (ROOT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    (ROOT / "concept_extraction.json").write_text(json.dumps(extraction, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    to_json(graph, communities, str(ROOT / "graph.json"))
    to_html(graph, communities, str(ROOT / "graph.html"), community_labels=labels)

    html_path = ROOT / "graph.html"
    html = html_path.read_text(encoding="utf-8")
    html = html.replace("<title>graphify - " + str(ROOT / "graph.html") + "</title>", "<title>graphify - AgentGoRound Concept Graph</title>")
    html = html.replace("<title>graphify - graph.html</title>", "<title>graphify - AgentGoRound Concept Graph</title>")
    html_path.write_text(html, encoding="utf-8")

    summary = {
        "detection": {
            "total_files": detection.get("total_files", 0),
            "total_words": detection.get("total_words", 0),
        },
        "graph": {
            "nodes": graph.number_of_nodes(),
            "edges": graph.number_of_edges(),
            "communities": len(communities),
        },
        "community_labels": labels,
    }
    (ROOT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
