import { Check, Copy, ExternalLink, FilePlus2, Link2, Share2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Link } from "wouter";
import AppShell from "@/components/lexi/AppShell";
import { trpc } from "@/lib/trpc";

export default function CreateRequest() {
  const settings = trpc.settings.get.useQuery();
  const workflows = trpc.workflows.list.useQuery();
  const create = trpc.payments.create.useMutation();
  const [amount,setAmount]=useState("");
  const [description,setDescription]=useState("");
  const [orderId,setOrderId]=useState("");
  const [customerReference,setCustomerReference]=useState("");
  const [network,setNetwork]=useState<"mainnet"|"devnet">("mainnet");
  const [wallet,setWallet]=useState("");
  const [expiresInHours,setExpiresInHours]=useState(24);
  const [overpaymentPolicy,setOverpaymentPolicy]=useState<"reject"|"accept">("reject");
  const [redirectUrl,setRedirectUrl]=useState("");
  const [workflowId,setWorkflowId]=useState("");
  const [idempotencyKey,setIdempotencyKey]=useState(()=>crypto.randomUUID());
  const [error,setError]=useState("");
  const [copied,setCopied]=useState(false);
  const result=create.data;
  const absoluteLink=useMemo(()=>result ? `${window.location.origin}${result.url}` : "",[result]);
  const [qr,setQr]=useState("");
  useEffect(()=>{ if(absoluteLink) void QRCode.toDataURL(absoluteLink,{width:350,margin:1,color:{dark:"#17372e",light:"#ffffff"}}).then(setQr); },[absoluteLink]);
  useEffect(()=>{ if(settings.data){const conf=settings.data.settings;setWallet(conf.receivingWallet);setNetwork(conf.network);setOverpaymentPolicy(conf.overpaymentPolicy);} },[settings.data]);
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();setError("");
    try { await create.mutateAsync({idempotencyKey,amount,description,orderId,customerReference,network,receivingWallet:wallet,expiresInHours,overpaymentPolicy,redirectUrl,workflowId:workflowId?Number(workflowId):undefined}); }
    catch(cause){setError(cause instanceof Error?cause.message:"The payment request could not be created.");}
  };
  const copy=async(text:string)=>{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),1800);};
  const downloadQr=()=>{if(!qr)return;const anchor=document.createElement("a");anchor.href=qr;anchor.download="lexi-payment-link-qr.png";anchor.click();};
  const share=async()=>{if(navigator.share) await navigator.share({title:"LEXI PayLink payment request",url:absoluteLink}); else await copy(absoluteLink);};
  return <AppShell title="New payment request" eyebrow="Payment links">
    <div className="page-intro"><div><span className="eyebrow-small">A link, not a storefront</span><h2>Create a payment request</h2><p>Make an invoice, then share its unique checkout link anywhere.</p></div></div>
    <div className="form-layout">
      <form className="surface form-card" onSubmit={submit} onChange={()=>{if(create.data){create.reset();setIdempotencyKey(crypto.randomUUID());}}}>
        <h3 className="form-section-title">Request details</h3><p className="form-section-copy">Amounts are stored in exact USDC base units. No card, bank, or store setup is needed.</p>
        <div className="field"><label htmlFor="amount">Amount</label><div className="amount-input-wrap"><input id="amount" className="control" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00" required/><span className="amount-currency">USDC</span></div><small className="field-hint">Up to 6 decimal places. Never rounded through floating-point math.</small></div>
        <div className="field"><label htmlFor="description">What is this payment for?</label><input id="description" className="control" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Brand identity project" maxLength={500} required/></div>
        <div className="field-row"><div className="field"><label htmlFor="orderId">Order / invoice reference <span className="muted-inline">(optional)</span></label><input id="orderId" className="control" value={orderId} onChange={e=>setOrderId(e.target.value)} placeholder="INV-1042" maxLength={120}/></div><div className="field"><label htmlFor="customerRef">Customer reference <span className="muted-inline">(optional)</span></label><input id="customerRef" className="control" value={customerReference} onChange={e=>setCustomerReference(e.target.value)} placeholder="Email or order note" maxLength={255}/></div></div>
        <div className="field-row"><div className="field"><label htmlFor="network">Solana network</label><select id="network" className="control" value={network} onChange={e=>setNetwork(e.target.value as "mainnet"|"devnet")}><option value="mainnet">Solana Mainnet — real funds</option><option value="devnet">Solana Devnet — test only</option></select></div><div className="field"><label htmlFor="expires">Expires after</label><select id="expires" className="control" value={expiresInHours} onChange={e=>setExpiresInHours(Number(e.target.value))}><option value={1}>1 hour</option><option value={24}>24 hours</option><option value={72}>3 days</option><option value={168}>7 days</option><option value={720}>30 days</option></select></div></div>
        <div className="field"><label htmlFor="wallet">Merchant receiving wallet</label><input id="wallet" className="control mono" value={wallet} onChange={e=>setWallet(e.target.value)} placeholder="Solana wallet address" required/><small className="field-hint">This public wallet address receives the funds. LEXI never asks for a seed phrase or private key.</small></div>
        <div className="field-row"><div className="field"><label htmlFor="overpay">Overpayment policy</label><select id="overpay" className="control" value={overpaymentPolicy} onChange={e=>setOverpaymentPolicy(e.target.value as "reject"|"accept")}><option value="reject">Do not fulfill automatically</option><option value="accept">Accept and fulfill</option></select></div><div className="field"><label htmlFor="workflow">After verified payment</label><select id="workflow" className="control" value={workflowId} onChange={e=>setWorkflowId(e.target.value)}><option value="">No workflow yet</option>{workflows.data?.map(w=><option key={w.id} value={w.id}>{w.name}{w.enabled?"":" · disabled"}</option>)}</select></div></div>
        <div className="field"><label htmlFor="redirect">Optional HTTPS success redirect</label><input id="redirect" className="control" type="url" value={redirectUrl} onChange={e=>setRedirectUrl(e.target.value)} placeholder="https://your-site.com/thank-you"/><small className="field-hint">Used only after server verification and only if your destination is secure.</small></div>
        {network==="mainnet"&&<div className="notice" role="note"><ShieldCheck size={15}/><span><b>Mainnet uses real USDC.</b> Review the recipient wallet and amount before you create and share this request. A customer transfer cannot be reversed by LEXI.</span></div>}
        {error&&<div className="alert-error" role="alert" style={{marginTop:14}}>{error}</div>}
        <div className="inline-actions" style={{marginTop:18}}><button className="button button-primary" type="submit" disabled={create.isPending||settings.isLoading}><FilePlus2 size={15}/>{create.isPending?"Creating…":"Create payment link"}</button><Link href="/dashboard" className="secondary-button">Cancel</Link></div>
      </form>
      {result?<aside className="surface share-card"><div className="panel-head" style={{padding:0,border:0}}><div><h3>Link is ready to share</h3><p>Payment request status: {result.status.replaceAll("_"," ").toLowerCase()}.</p></div><span className="stat-icon"><Check size={16}/></span></div><div className="qr-box">{qr?<img src={qr} alt="QR code for the payment link"/>:<span>Preparing QR…</span>}</div><div className="share-url mono">{absoluteLink}</div><div className="share-actions"><button className="button" onClick={()=>void copy(absoluteLink)}><Copy size={13}/>{copied?"Copied":"Copy link"}</button><button className="button" onClick={()=>void share()}><Share2 size={13}/>Share</button><button className="button" onClick={downloadQr} disabled={!qr}>Download QR</button></div><Link href={result.url} className="secondary-button" style={{width:"100%",marginTop:9}}><ExternalLink size={13}/>Open checkout</Link><button type="button" className="text-button" style={{width:"100%",marginTop:12}} onClick={()=>{create.reset();setIdempotencyKey(crypto.randomUUID());}}>Create another request</button><div className="notice" style={{marginTop:15}}><ShieldCheck size={14}/><span>Customer-submitted signatures are only requests for verification. The order stays unpaid until finalized USDC is checked.</span></div></aside>:<aside className="surface share-card"><div className="empty-state"><span className="empty-icon"><Link2 size={20}/></span><b>Your shareable link appears here</b><p>Complete the invoice fields to create a unique checkout and QR code.</p></div><div className="mini-step"><span>1</span><b>Set the terms</b><small>Amount, wallet, network and expiry</small></div><div className="mini-step"><span>2</span><b>Share the link</b><small>Messages, social, email or print</small></div><div className="mini-step"><span>3</span><b>LEXI verifies settlement</b><small>No client-side success shortcut</small></div></aside>}
    </div>
  </AppShell>;
}
