import { describe, expect, it } from "vitest";
import { draftWorkflowFromText, simulateWorkflow } from "./engine";

describe("PayLink Autopilot deterministic drafting and simulation", () => {
  it("creates a reviewed verified-payment template from plain language", () => {
    const draft = draftWorkflowFromText("After payment, send a Telegram notification and email receipt");
    expect(draft.trigger).toBe("payment_confirmed");
    expect(draft.actions).toContain("telegram");
    expect(draft.actions).toContain("email");
    expect(draft.rationale).toMatch(/Template-based draft/);
  });

  it("keeps simulations isolated from all live side effects", () => {
    const simulation = simulateWorkflow(draftWorkflowFromText("When underpaid, send email"));
    expect(simulation).toMatchObject({ simulated: true, liveSideEffectsExecuted: false, trigger: "payment_underpaid" });
    expect(simulation.actions.every(action => action.status === "WOULD_RUN")).toBe(true);
    expect(simulation.note).toMatch(/No blockchain transaction/);
  });
});
