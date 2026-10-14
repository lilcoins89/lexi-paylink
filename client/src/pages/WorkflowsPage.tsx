import { Activity, Check, Play, Plus, RotateCcw, Sparkles, Workflow } from "lucide-react";
import { useState } from "react";
import AppShell from "@/components/lexi/AppShell";
import StatusPill from "@/components/lexi/StatusPill";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/money";

const triggers = ["payment_confirmed", "payment_underpaid", "payment_expired", "verification_failed", "request_created", "payment_detected"] as const;
const actions = ["create_receipt", "mark_order_paid", "telegram", "email", "webhook", "redirect", "record_event"] as const;
type Trigger = (typeof triggers)[number];
type Action = (typeof actions)[number];

export default function WorkflowsPage({ simulatorOnly = false }: { simulatorOnly?: boolean }) {
  const list = trpc.workflows.list.useQuery();
  const executions = trpc.workflows.executions.useQuery(undefined, { refetchInterval: 10_000 });
  const draft = trpc.workflows.draft.useMutation();
  const create = trpc.workflows.create.useMutation({ onSuccess: () => { void list.refetch(); setNotice("Workflow saved. Review its conditions, actions and activation state below."); } });
  const setEnabled = trpc.workflows.setEnabled.useMutation({ onSuccess: () => void list.refetch() });
  const simulate = trpc.workflows.simulate.useMutation();
  const retry = trpc.workflows.retry.useMutation({ onSuccess: () => void executions.refetch() });
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("payment_confirmed");
  const [instruction, setInstruction] = useState("");
  const [selectedActions, setSelectedActions] = useState<Action[]>(["create_receipt", "mark_order_paid"]);
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [requireOrderId, setRequireOrderId] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [simulationResult, setSimulationResult] = useState<unknown>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState("");

  const makeDraft = async () => {
    setError("");
    try {
      const value = await draft.mutateAsync({ instruction });
      setTrigger(value.trigger as Trigger);
      setSelectedActions(value.actions as Action[]);
      setName(current => current || `Automation for ${value.trigger.replaceAll("_", " ")}`);
      setVerifiedOnly(true);
      setNotice(value.rationale);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not draft workflow.");
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await create.mutateAsync({ name, trigger, actions: selectedActions, conditions: { verifiedOnly, requireOrderId }, enabled });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save workflow.");
    }
  };

  const runSimulation = async () => {
    setError("");
    try {
      const result = await simulate.mutateAsync(selectedWorkflow ? { workflowId: Number(selectedWorkflow) } : { instruction });
      setSimulationResult(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Simulation failed.");
    }
  };

  return <AppShell title={simulatorOnly ? "Workflow simulator" : "Workflows"} eyebrow="PayLink Autopilot">
    <div className="page-intro">
      <div><span className="eyebrow-small">{simulatorOnly ? "Dry run only" : "Automate the next step"}</span><h2>{simulatorOnly ? "Preview before you activate" : "Payment workflows"}</h2><p>{simulatorOnly ? "A simulation never sends a transaction, email, Telegram message or webhook." : "Turn plain-English instructions into reviewed, deterministic actions."}</p></div>
      {!simulatorOnly && <a href="#new-workflow" className="button button-primary"><Plus size={15}/>New workflow</a>}
    </div>
    <div className="workflow-layout">
      {!simulatorOnly && <section className="surface panel" id="new-workflow">
        <div className="panel-head"><div><h3><Sparkles size={14}/> Build a workflow</h3><p>PayLink Autopilot drafts; you review and confirm before activation.</p></div></div>
        <form className="panel-body" onSubmit={save}>
          <div className="field"><label htmlFor="instruction">Describe the automation in plain English</label><textarea className="control" id="instruction" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="When a payment is verified, create a receipt and send me a Telegram notification." maxLength={2000}/><small className="field-hint">Template-based draft assistant; the payment verifier and worker are deterministic. No configured LLM is assumed.</small></div>
          <button className="secondary-button" type="button" onClick={() => void makeDraft()} disabled={draft.isPending || instruction.trim().length < 5}><Sparkles size={13}/>{draft.isPending ? "Drafting…" : "Draft from instructions"}</button>
          {notice && <div className="notice" style={{ marginTop: 12 }}><Check size={13}/><span>{notice}</span></div>}
          <div className="field-grid" style={{ marginTop: 15 }}>
            <div className="field"><label htmlFor="workflow-name">Workflow name</label><input id="workflow-name" className="control" value={name} onChange={event => setName(event.target.value)} placeholder="Verified payment follow-up" required maxLength={120}/></div>
            <div className="field"><label htmlFor="trigger">Trigger</label><select id="trigger" className="control" value={trigger} onChange={event => setTrigger(event.target.value as Trigger)}>{triggers.map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
          </div>
          <div className="field"><label>Conditions</label><div className="action-checklist">
            <label className="check-row"><input type="checkbox" checked={verifiedOnly} onChange={event => setVerifiedOnly(event.target.checked)}/><span><b>Require verified transfer evidence</b><small>Confirmed/underpaid transfer events require server verification; request-created, detected, expired and failed triggers remain available. Order fulfillment always requires amount-satisfied settlement.</small></span></label>
            <label className="check-row"><input type="checkbox" checked={requireOrderId} onChange={event => setRequireOrderId(event.target.checked)}/><span><b>Only run when an order reference exists</b><small>Requests without an order/custom ID will be skipped.</small></span></label>
          </div></div>
          <div className="field"><label>Actions to run in order</label><div className="action-checklist">{actions.map(action => <label key={action} className="check-row"><input type="checkbox" checked={selectedActions.includes(action)} onChange={event => setSelectedActions(previous => event.target.checked ? [...previous, action] : previous.filter(value => value !== action))}/><span><b>{action.replaceAll("_", " ")}</b><small>{action === "mark_order_paid" ? "Only after amount-satisfied verification; order update is idempotent" : action === "create_receipt" ? "Receipt is created once in the settlement transaction" : action === "record_event" ? "Writes one idempotent payment-history event" : action === "redirect" ? "Requires a validated HTTPS redirect and verified checkout status" : action === "webhook" ? "Signed delivery includes a stable key; the receiver should deduplicate" : "Retryable notification; a provider timeout can make delivery outcome ambiguous"}</small></span></label>)}</div></div>
          <label className="check-row activation-row"><input type="checkbox" checked={enabled} onChange={event => setEnabledState(event.target.checked)}/><span><b>Activate after saving</b><small>Confirm only after reviewing the trigger, conditions and actions.</small></span></label>
          {error && <div className="alert-error">{error}</div>}
          <button className="button button-primary" type="submit" disabled={create.isPending || selectedActions.length === 0}><Check size={14}/>{create.isPending ? "Saving…" : "Confirm and save workflow"}</button>
        </form>
      </section>}

      <section className="surface panel">
        <div className="panel-head"><div><h3><Play size={14}/> Workflow simulator</h3><p>Preview conditions and action outcomes with no external side effects.</p></div><span className="status-pill status-simulated"><i/>Simulation</span></div>
        <div className="panel-body">
          <div className="field"><label htmlFor="sim-workflow">Saved workflow</label><select id="sim-workflow" className="control" value={selectedWorkflow} onChange={event => setSelectedWorkflow(event.target.value)}><option value="">Use current plain-English instructions</option>{list.data?.map(workflow => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></div>
          {!selectedWorkflow && <div className="field"><label htmlFor="sim-instruction">Scenario</label><textarea id="sim-instruction" className="control" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="Describe what should happen after payment confirmation." maxLength={2000}/></div>}
          <button className="button button-primary button-small" onClick={() => void runSimulation()} disabled={simulate.isPending || (!selectedWorkflow && instruction.trim().length < 5)}><Play size={13}/>{simulate.isPending ? "Simulating…" : "Run dry simulation"}</button>
          {simulationResult !== null && <div className="simulation-result"><b>Preview — no actions were sent</b><pre>{JSON.stringify(simulationResult, null, 2)}</pre></div>}
          {error && <div className="alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
      </section>

      {!simulatorOnly && <>
        <section className="surface panel"><div className="panel-head"><div><h3>Saved workflows</h3><p>Each workflow and its execution rules are scoped to this merchant.</p></div></div>
          {list.isLoading ? <div className="loading-state">Loading workflows…</div> : !list.data?.length ? <div className="mini-empty">No saved workflows yet.</div> : list.data.map(workflow => <article className="workflow-row" key={workflow.id}>
            <span className="integration-icon"><Workflow size={17}/></span><div className="workflow-copy"><b>{workflow.name}</b><small>On {workflow.trigger.replaceAll("_", " ")} · {workflow.actions.map(action => action.kind.replaceAll("_", " ")).join(" · ")}</small><small>Conditions: {workflow.conditionJson?.verifiedOnly === false ? "verified transfer not required for non-settlement triggers" : "verified evidence required for underpaid/confirmed events"}{workflow.conditionJson?.requireOrderId ? " · order reference required" : ""}</small></div>
            <StatusPill status={workflow.enabled ? "SUCCEEDED" : "CREATED"}/><button className="secondary-button" onClick={() => setEnabled.mutate({ id: workflow.id, enabled: !workflow.enabled })} disabled={setEnabled.isPending}>{workflow.enabled ? "Pause" : "Activate"}</button>
          </article>)}
        </section>
        <section className="surface panel"><div className="panel-head"><div><h3><Activity size={14}/>Execution history</h3><p>Retries skip successful actions and never repeat settlement credit.</p></div></div>
          {executions.isLoading ? <div className="loading-state">Loading workflow executions…</div> : !executions.data?.length ? <div className="mini-empty">No workflow runs yet. Simulations do not appear as real executions.</div> : <div className="execution-history">{executions.data.map(job => <article className="execution-history-row" key={job.id}><div><b>{job.eventType.replaceAll("_", " ")}</b><small>{formatDate(job.createdAt)} · {job.attempts} attempt{job.attempts === 1 ? "" : "s"}</small>{job.lastError && <small className="error-inline">{job.lastError}</small>}</div><StatusPill status={job.status}/>{["FAILED", "DEAD_LETTER"].includes(job.status) && <button className="icon-button" onClick={() => retry.mutate({ id: job.id })} disabled={retry.isPending} aria-label="Retry workflow execution"><RotateCcw size={14}/></button>}</article>)}</div>}
        </section>
      </>}
    </div>
  </AppShell>;
}
