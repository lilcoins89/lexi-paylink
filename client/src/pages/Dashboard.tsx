import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, CircleDollarSign, Clock3, FilePlus2, Link2, Percent, RefreshCw, ShieldAlert } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/money";
import StatusPill from "@/components/lexi/StatusPill";
import AppShell from "@/components/lexi/AppShell";

const money = (units: string) => {
  const base = BigInt(units);
  const whole = base / 1_000_000n;
  const frac = (base % 1_000_000n).toString().padStart(6,"0").replace(/0+$/,"");
  return `${whole}${frac ? `.${frac}` : ""}`;
};

export default function Dashboard() {
  const stats = trpc.dashboard.stats.useQuery(undefined, { refetchInterval: 20_000 });
  if (stats.isLoading) return <AppShell title="Overview"><div className="loading-state"><RefreshCw size={15} className="spin"/>Loading merchant records…</div></AppShell>;
  if (stats.error) return <AppShell title="Overview"><div className="alert-error">Your merchant workspace could not be loaded. {stats.error.message}</div></AppShell>;
  const data = stats.data!;
  const cards = [
    { label: "Confirmed volume", value: `${money(data.totalVolumeBaseUnits)} USDC`, foot: "Accepted, verified transfers", icon: CircleDollarSign },
    { label: "Payment requests", value: data.requestCount.toLocaleString(), foot: `${data.pending} currently awaiting payment`, icon: Link2 },
    { label: "Conversion rate", value: `${data.conversionRate}%`, foot: "Confirmed requests ÷ requests created", icon: Percent },
    { label: "Needs attention", value: (data.workflowFailures + data.failed + data.pendingReconciliation).toLocaleString(), foot: `${data.pendingReconciliation} signature checks pending · ${data.workflowFailures + data.failed} failures`, icon: ShieldAlert },
  ];
  return <AppShell title="Overview">
    <div className="page-intro"><div><span className="eyebrow-small">Your business at a glance</span><h2>Good to see you, {data.merchant.name}.</h2><p>Payment activity and verified settlement, in one place.</p></div><Link href="/create" className="button button-primary"><FilePlus2 size={16}/> Create payment request</Link></div>
    <div className="stats-grid">{cards.map(({label,value,foot,icon:Icon})=><article className="surface stat-card" key={label}><div className="stat-label"><span>{label}</span><span className="stat-icon"><Icon size={15}/></span></div><div className="stat-value">{value}</div><div className="stat-foot">{foot}</div></article>)}</div>
    <div className="dashboard-columns">
      <section className="surface panel"><div className="panel-head"><div><h3>Recent payment requests</h3><p>Live records from your merchant account</p></div><Link href="/activity" className="quiet-link">View activity <ArrowRight size={13}/></Link></div>
        {data.recent.length === 0 ? <div className="empty-state"><span className="empty-icon"><Link2 size={19}/></span><b>Your first payment link starts here</b><p>Create a request and share the link anywhere you do business. LEXI verifies the payment before anything is marked complete.</p><Link href="/create" className="button button-primary button-small">Create a request <ArrowUpRight size={14}/></Link></div> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Request</th><th>Amount</th><th>Created</th><th>Status</th><th/></tr></thead><tbody>{data.recent.map(request=><tr key={request.id}><td><Link href={`/payments/${request.id}`} className="data-primary">{request.description}</Link><span className="data-secondary mono">{request.publicId.slice(0,10)}…</span></td><td className="mono">{money(request.amountBaseUnits)} USDC</td><td>{formatDate(request.createdAt)}</td><td><StatusPill status={request.status}/></td><td><Link href={`/pay/${request.publicId}`} aria-label="Open public checkout"><ArrowUpRight size={14}/></Link></td></tr>)}</tbody></table></div>}
      </section>
      <aside className="surface panel"><div className="panel-head"><div><h3>Settlement pulse</h3><p>Current request state mix</p></div><Activity size={16} color="var(--muted-foreground)"/></div><div className="panel-body"><div className="pulse-list"><Pulse label="Confirmed" count={data.confirmed} color="mint"/><Pulse label="Awaiting payment" count={data.pending} color="gold"/><Pulse label="Underpaid" count={data.underpaid} color="orange"/><Pulse label="Expired" count={data.expired} color="gray"/><Pulse label="Failed / rejected" count={data.failed} color="red"/></div><div className="dashboard-note"><CheckCircle2 size={15}/><span>Only server-verified transfers count toward confirmed volume.</span></div></div>
        <div className="panel-head"><div><h3>Recent workflow runs</h3><p>Durable retries; settlement remains idempotent</p></div><Link href="/workflows" className="quiet-link">Open <ArrowUpRight size={12}/></Link></div>
        {data.executions.length ? <div className="execution-list">{data.executions.slice(0,3).map(item=><div className="execution-row" key={item.id}><span className="execution-icon"><Clock3 size={13}/></span><span className="execution-copy"><b>{item.eventType.replaceAll("_"," ")}</b><small>{formatDate(item.createdAt)}</small></span><StatusPill status={item.status}/></div>)}</div> : <div className="mini-empty">No workflow runs yet.</div>}
      </aside>
    </div>
    <div className="dashboard-bottom"><span><ShieldAlert size={14}/> {data.workflowFailures} workflow actions need attention</span><Link href="/workflows">Review operations <ArrowDownRight size={14}/></Link></div>
  </AppShell>;
}
function Pulse({label,count,color}:{label:string;count:number;color:string}) { return <div className="pulse-row"><span className={`pulse-dot ${color}`}/><span>{label}</span><b>{count}</b></div>; }
