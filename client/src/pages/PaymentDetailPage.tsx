import { ArrowUpRight, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import AppShell from "@/components/lexi/AppShell";
import StatusPill from "@/components/lexi/StatusPill";
import { trpc } from "@/lib/trpc";
import { formatDate, formatUsdc } from "@/lib/money";

export default function PaymentDetailPage({ id }: { id: number }) {
  const q = trpc.payments.detail.useQuery({ id });
  const [notice, setNotice] = useState("");
  const reconcile = trpc.payments.reconcile.useMutation({ onSuccess: async result => { setNotice(result.message); await q.refetch(); } });
  if (q.isLoading) return <AppShell title="Payment detail"><div className="loading-state">Loading payment record…</div></AppShell>;
  if (q.error || !q.data) return <AppShell title="Payment detail"><div className="alert-error">{q.error?.message ?? "Payment was not found."}</div></AppShell>;

  const { request, events, transfers, attempts } = q.data;
  const hasPendingAttempt = attempts.some(attempt => ["VERIFYING", "DETECTED"].includes(attempt.status) && Boolean(attempt.signature));
  return <AppShell title="Payment detail" eyebrow="Request lifecycle">
    <div className="page-intro"><div><span className="eyebrow-small">{request.publicId}</span><h2>{request.description}</h2><p>Created {formatDate(request.createdAt)} · Expires {formatDate(request.expiresAt)}</p></div><div className="inline-actions"><StatusPill status={request.status}/><Link href={`/pay/${request.publicId}`} className="secondary-button"><ExternalLink size={13}/>Public checkout</Link></div></div>
    <div className="stats-grid"><Info label="Requested" value={`${formatUsdc(request.amountBaseUnits)} USDC`}/><Info label="Network" value={`Solana ${request.network}`}/><Info label="Receiving wallet" value={`${request.receivingWallet.slice(0,10)}…${request.receivingWallet.slice(-7)}`}/><Info label="Order reference" value={request.orderId || "—"}/></div>
    {hasPendingAttempt && <section className="surface panel reconciliation-panel"><div className="panel-body"><div><b>Pending signature verification</b><p>Recheck unresolved transactions against the configured Solana RPC. RPC uncertainty remains pending and never counts as payment.</p></div><button className="secondary-button" onClick={() => reconcile.mutate({ publicId: request.publicId })} disabled={reconcile.isPending}><RefreshCw size={13} className={reconcile.isPending ? "spin" : ""}/>{reconcile.isPending ? "Checking…" : "Reconcile pending signatures"}</button>{notice && <small role="status">{notice}</small>}</div></section>}
    <div className="detail-columns">
      <section className="surface panel"><div className="panel-head"><div><h3>Lifecycle events</h3><p>Recorded state changes and verification decisions</p></div></div>{!events.length ? <div className="empty-state">No payment events have been recorded.</div> : <div className="event-feed">{events.map((event,index)=><article className="event-item" key={event.id}><span className="event-marker"><i/></span><div className="event-main"><b>{event.eventType.replaceAll("_"," ")}</b><small>{formatDate(event.createdAt)}</small><details><summary>Inspect details</summary><pre>{JSON.stringify(event.payload,null,2)}</pre></details></div><span className="event-index">{String(events.length-index).padStart(2,"0")}</span></article>)}</div>}</section>
      <section className="surface panel"><div className="panel-head"><div><h3>Verified transfers</h3><p>Raw wallet signatures are never accepted as proof alone.</p></div><ShieldCheck size={16}/></div>{transfers.length ? <div className="transfer-list">{transfers.map(t=><article className="transfer-item" key={t.id}><div className="transfer-top"><StatusPill status={t.acceptedForFulfillment ? "CONFIRMED" : "EXPIRED"}/><b className="mono">{formatUsdc(t.amountBaseUnits)} USDC</b></div><code className="mono">{t.transactionSignature}</code><small>{formatDate(t.confirmedAt)} · Mint {t.mint.slice(0,8)}… · Accepted for fulfillment: {t.acceptedForFulfillment ? "yes" : "no"}</small><a href={`https://explorer.solana.com/tx/${t.transactionSignature}${t.network === "devnet" ? "?cluster=devnet" : ""}`} target="_blank" rel="noreferrer" className="quiet-link">Open Solana Explorer <ArrowUpRight size={12}/></a></article>)}</div> : <div className="empty-state"><span className="empty-icon"><ShieldCheck size={17}/></span><b>No verified transfer yet</b><p>Submitted signatures remain untrusted until mint, recipient, amount and finalization are confirmed.</p></div>}
        {!!attempts.length && <div className="attempt-history"><h4>Verification attempts</h4>{attempts.map(attempt=><div className="attempt-row" key={attempt.id}><StatusPill status={attempt.status}/><span className="mono">{attempt.signature ? `${attempt.signature.slice(0,12)}…` : "No signature"}</span><small>{formatDate(attempt.lastCheckedAt ?? attempt.createdAt)}</small>{attempt.failureReason && <small className="error-inline">{attempt.failureReason}</small>}</div>)}</div>}
      </section>
    </div>
  </AppShell>;
}
function Info({label,value}:{label:string;value:string}) { return <article className="surface stat-card"><div className="stat-label">{label}</div><div className="info-value">{value}</div></article>; }
