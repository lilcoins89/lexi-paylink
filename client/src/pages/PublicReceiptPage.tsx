import { ArrowLeft, ArrowUpRight, Check, Download, Printer, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import Brand from "@/components/lexi/Brand";
import StatusPill from "@/components/lexi/StatusPill";
import { trpc } from "@/lib/trpc";
import { formatDate } from "@/lib/money";

export default function PublicReceiptPage({ paymentId }: { paymentId: string }) {
  const query = trpc.payments.publicGet.useQuery({ publicId: paymentId }, { retry: false });
  const receipt = query.data?.receipt as Record<string, unknown> | null | undefined;
  const transfers = Array.isArray(receipt?.transfers) ? receipt.transfers as Array<Record<string, unknown>> : [];
  const download = () => {
    if (!receipt) return;
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${String(receipt.receiptNumber ?? "lexi-receipt")}.json`;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  return <div className="checkout-page">
    <header className="checkout-nav"><Link href="/"><Brand/></Link><small>Verified payment receipt</small></header>
    <main className="checkout-content receipt-public-main">
      {query.isLoading ? <section className="checkout-card loading-state">Loading receipt…</section> : query.error || !query.data ? <section className="checkout-card"><h2>Receipt unavailable</h2><p>This payment link is invalid or could not be loaded.</p><Link className="secondary-button" href="/"><ArrowLeft size={14}/>Back to LEXI</Link></section> : !receipt ? <section className="checkout-card"><span className="empty-icon"><ShieldCheck size={18}/></span><h2>No paid receipt is available</h2><p>This request is currently <b>{query.data.status.replaceAll("_", " ")}</b>. LEXI only issues receipts after finalized, amount-satisfied USDC settlement.</p><Link className="secondary-button" href={`/pay/${paymentId}`}>View payment status</Link></section> : <section className="checkout-card printable-receipt">
        <div className="receipt-brand-row"><Brand/><StatusPill status="CONFIRMED"/></div>
        <div className="receipt-heading"><span className="success-mark"><Check size={20}/></span><span><small>LEXI verified settlement</small><h1>Payment receipt</h1></span></div>
        <div className="receipt-number"><span>Receipt number</span><b className="mono">{String(receipt.receiptNumber ?? "—")}</b></div>
        <div className="receipt-public-fields">
          <ReceiptField label="Merchant" value={receipt.merchant}/>
          <ReceiptField label="Description" value={receipt.description}/>
          <ReceiptField label="Order reference" value={receipt.orderReference}/>
          <ReceiptField label="Amount" value={`${String(receipt.amount ?? "—")} ${String(receipt.token ?? "USDC")}`}/>
          <ReceiptField label="Network" value={`Solana ${String(receipt.network ?? "")}`}/>
          <ReceiptField label="Verified at" value={formatDate(String(receipt.confirmedAt ?? ""))}/>
          <ReceiptField label="Receiving wallet" value={receipt.receivingWallet} mono/>
          <ReceiptField label="Transaction signature" value={receipt.transactionSignature} mono/>
          <ReceiptField label="Verification" value={receipt.verificationStatus}/>
          <ReceiptField label="Created at" value={formatDate(String(receipt.receiptCreatedAt ?? ""))}/>
        </div>
        {transfers.length > 1 && <section className="receipt-transfer-list"><h2>Verified transfer signatures</h2>{transfers.map((transfer, index) => <div className="receipt-transfer" key={String(transfer.transactionSignature)}><span>Transfer {index + 1} · {String(transfer.amount ?? "verified amount")} USDC</span><a href={String(transfer.explorerUrl)} target="_blank" rel="noreferrer" className="mono">{String(transfer.transactionSignature)} <ArrowUpRight size={12}/></a></div>)}</section>}
        {typeof receipt.explorerUrl === "string" && <a className="quiet-link receipt-explorer" href={receipt.explorerUrl} target="_blank" rel="noreferrer">View verified transaction <ArrowUpRight size={13}/></a>}
        <div className="notice"><ShieldCheck size={14}/><span>This is an immutable snapshot of the verified payment facts recorded by LEXI. It is not a refund or custody claim.</span></div>
        <div className="inline-actions receipt-actions"><button className="button button-primary" onClick={download}><Download size={14}/>Download JSON</button><button className="secondary-button" onClick={() => window.print()}><Printer size={14}/>Print / Save PDF</button><Link className="secondary-button" href={`/pay/${paymentId}`}>Payment status</Link></div>
      </section>}
    </main>
    <footer className="checkout-footer"><span><ShieldCheck size={12}/>Server-verified settlement</span><span>USDC · Solana</span><span>Powered by LEXI PayLink</span></footer>
  </div>;
}

function ReceiptField({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return <div className="receipt-field"><span>{label}</span><b className={mono ? "mono" : undefined}>{value == null || value === "" ? "—" : String(value)}</b></div>;
}
