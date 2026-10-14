import type { WorkflowAction, WorkflowTrigger } from "@shared/lexi";

export type WorkflowDraft = { trigger: WorkflowTrigger; actions: WorkflowAction[]; conditions: string[]; rationale: string };

const confirmedTemplate: WorkflowDraft = {
  trigger: "payment_confirmed",
  actions: ["create_receipt", "mark_order_paid", "record_event"],
  conditions: ["verified Solana finality", "official USDC mint", "merchant receiving wallet", "amount satisfies request"],
  rationale: "Only a server-verified transfer that satisfies the invoice can create a receipt or mark an order paid.",
};

export function draftWorkflowFromText(instruction: string): WorkflowDraft {
  const text = instruction.toLowerCase();
  const actions = new Set<WorkflowAction>(confirmedTemplate.actions);
  if (/telegram/.test(text)) actions.add("telegram");
  if (/email|receipt by email/.test(text)) actions.add("email");
  if (/webhook/.test(text)) actions.add("webhook");
  if (/redirect/.test(text)) actions.add("redirect");
  const trigger: WorkflowTrigger = /underpaid|incomplete|partial/.test(text) ? "payment_underpaid" : "payment_confirmed";
  return {
    trigger,
    actions: Array.from(actions),
    conditions: ["server-side Solana verification required", "no action runs on transaction submission", "underpayment never fulfills an order"],
    rationale: "Template-based draft; review and confirm it before activation. No AI service is connected.",
  };
}

export function simulateWorkflow(draft: WorkflowDraft) {
  return {
    simulated: true as const,
    liveSideEffectsExecuted: false as const,
    trigger: draft.trigger,
    conditions: draft.conditions,
    actions: draft.actions.map(action => ({ action, status: "WOULD_RUN" as const })),
    note: "Simulation only. No blockchain transaction, notification, webhook, or order update was performed.",
  };
}
