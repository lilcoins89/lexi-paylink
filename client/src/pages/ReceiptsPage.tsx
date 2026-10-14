import { ArrowUpRight, Download, FileText, Printer, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import AppShell from "@/components/lexi/AppShell";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/money";

function downloadSnapshot(snapshot: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${String(snapshot.receiptNumber ?? "lexi-receipt")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ReceiptsPage() {
  const query = trpc.receipts.list.useQuery();
  return <AppShell title="Receipts" eyebrow="Verified payments">
    <div className="page-intro"><div><span className="eyebrow-small">Confirmed settlements only</span><h2>Receipts</h2><p>Receipt snapshots are created after server-confirmed, amount-satisfied payment.</p></div></div>
    {query.isLoading ? <div className="loading-state">Loading receipts…</div> : query.error ? <div className="alert-error">{query.error.message}</div> : !query.data?.length ? <section className="surface empty-state"><span className="empty-icon"><FileText size={19}/></span><b>No receipts yet</b><p>A printable receipt is created only after LEXI verifies a finalized USDC transfer that satisfies its payment request.</p></section> : <section className="surface panel">
      <div className="panel-head"><div><h3>Verified receipt records</h3><p>{query.data.length} confirmed receipt{query.data.length === 1 ? "" : "s"}</p></div><span className="status-pill status-confirmed"><i/>Verified only</span></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Receipt</th><th>Merchant / purpose</th><th>Amount</th><th>Confirmed at</th><th>Network</th><th>Record</th></tr></thead><tbody>{query.data.map(receipt => {
        const snapshot = receipt.snapshot as Record<string, unknown>;
        const paymentId = String(snapshot.paymentRequestId ?? "");
        const receiptPath = paymentId ? `/receipt/${paymentId}` : "#";
        return <tr key={receipt.id}>
          <td><b className="data-primary mono">{receipt.receiptNumber}</b><span className="data-secondary mono">{String(snapshot.transactionSignature ?? "").slice(0, 10)}…</span></td>
          <td><b className="data-primary">{String(snapshot.merchant ?? "Merchant")}</b><span className="data-secondary">{String(snapshot.description ?? "Verified payment")}</span></td>
          <td className="mono">{String(snapshot.amount ?? "—")} USDC</td><td>{formatDate(String(snapshot.confirmedAt ?? receipt.createdAt))}</td><td>{String(snapshot.network ?? "solana")}</td>
          <td><div className="inline-actions"><a className="quiet-link" href={String(snapshot.explorerUrl ?? "#")} target="_blank" rel="noreferrer">Explorer <ArrowUpRight size={12}/></a>{paymentId && <Link className="icon-button" href={receiptPath} aria-label="Open shareable receipt"><ShieldCheck size={13}/></Link>}<button className="icon-button" onClick={() => downloadSnapshot(snapshot)} aria-label="Download receipt JSON"><Download size={13}/></button><button className="icon-button" onClick={() => window.print()} aria-label="Print receipt"><Printer size={13}/></button></div></td>
        </tr>;
      })}</tbody></table></div>
      <div className="panel-body"><div className="notice"><ShieldCheck size={14}/><span>Each receipt preserves the verified transaction facts at creation time. Corrections are recorded as separate audit events.</span></div></div>
    </section>}
  </AppShell>;
}
