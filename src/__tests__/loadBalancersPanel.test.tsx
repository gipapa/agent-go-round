import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoadBalancersPanel from "../ui/LoadBalancersPanel";
import type { LoadBalancerConfig } from "../types";

describe("LoadBalancersPanel harness capability", () => {
  it("exposes a stable selector for configuring an instance capability", () => {
    const onChange = vi.fn<(next: LoadBalancerConfig[]) => void>();
    render(
      <LoadBalancersPanel
        loadBalancers={[]}
        credentials={[]}
        selectedId={null}
        onSelect={vi.fn()}
        onChange={onChange}
        onLoadModels={vi.fn(async () => [])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Instance" }));

    const capability = document.querySelector<HTMLSelectElement>('[data-tutorial-id="load-balancer-instance-capability-0"]');
    expect(capability).not.toBeNull();
    if (!capability) return;
    expect(capability.value).toBe("disabled");
    fireEvent.change(capability, { target: { value: "native_only" } });
    expect(capability.value).toBe("native_only");

    const maxTotal = document.querySelector<HTMLInputElement>('[data-tutorial-id="load-balancer-instance-context-budget-maxTotalChars-0"]');
    expect(maxTotal).not.toBeNull();
    if (!maxTotal) return;
    fireEvent.change(maxTotal, { target: { value: "12000" } });
    expect(maxTotal.value).toBe("12000");
  });
});
