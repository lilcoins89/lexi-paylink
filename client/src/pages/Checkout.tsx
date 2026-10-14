import { createAssociatedTokenAccountInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import { ArrowLeft, Check, Clock3, Copy, ExternalLink, LoaderCircle, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { formatDate, formatUsdc } from "@/lib/money";
import SolanaWalletScope from "@/components/lexi/SolanaWalletScope";
import Brand from "@/components/lexi/Brand";
import StatusPill from "@/components/lexi/StatusPill";

type CheckoutData = NonNullable<inferRouterOutputs<AppRouter>["payments"]["publicGet"]>;

export default function Checkout({paymentId}:{paymentId:string}) {
  const payment=trpc.payments.publicGet.useQuery({publicId:paymentId},{refetchInterval:8000,retry:false});
  if(payment.isLoading)return <CheckoutFrame><div className="loading-state"><LoaderCircle size={18} className="spin"/>Loading payment request…</div></CheckoutFrame>;
  if(payment.error||!payment.data)return <CheckoutFrame><div className="checkout-card"><span className="empty-icon"><LockKeyhole size={18}/></span><h2>Payment link unavailable</h2><p>This link may have expired, been removed, or is not valid.</p><Link className="secondary-button" href="/"><ArrowLeft size={14}/>Back to LEXI</Link></div></CheckoutFrame>;
  return <SolanaWalletScope network={payment.data.network}><CheckoutContent data={payment.data} refetch={()=>void payment.refetch()}/></SolanaWalletScope>;
}
function CheckoutFrame({children}:{children:React.ReactNode}) { return <div className="checkout-page"><header className="checkout-nav"><Link href="/"><Brand/></Link><small>Secure USDC payment request</small></header><main className="checkout-content" style={{display:"block",maxWidth:600}}>{children}</main><footer className="checkout-footer"><span><ShieldCheck size={12}/>Server-verified settlement</span><span>USDC · Solana</span><span>Powered by LEXI PayLink</span></footer></div>; }
function CheckoutContent({data,refetch}:{data:CheckoutData;refetch:()=>void}) {
  const [uriQr,setUriQr]=useState("");
  const [signature,setSignature]=useState("");
  const [copied,setCopied]=useState(false);
  const [localMessage,setLocalMessage]=useState("");
  const [redirecting,setRedirecting]=useState(false);
  const verify=trpc.payments.submitSignature.useMutation({onSuccess:()=>refetch()});
  const uri=useMemo(()=>{const query=new URLSearchParams({amount:data.amount,"spl-token":data.mint,reference:data.referencePublicKey,label:"LEXI PayLink",message:data.orderId||data.description});return `solana:${data.receivingWallet}?${query.toString()}`;},[data.amount,data.description,data.mint,data.orderId,data.receivingWallet,data.referencePublicKey]);
  useEffect(()=>{void QRCode.toDataURL(uri,{width:400,margin:1,color:{dark:"#17372e",light:"#ffffff"}}).then(setUriQr);},[uri]);
  const expired=Date.now()>new Date(data.expiresAt).getTime()||data.status==="EXPIRED";
  const settled=data.status==="CONFIRMED"||Boolean(data.receipt);
  const overpaidAwaitingReview=data.status==="OVERPAID"&&!settled;
  useEffect(()=>{if(!settled||!data.redirectUrl)return;setRedirecting(true);const timer=window.setTimeout(()=>window.location.assign(data.redirectUrl!),2500);return()=>window.clearTimeout(timer);},[settled,data.redirectUrl]);
  const copy=async(text:string)=>{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),1500);};
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setLocalMessage("");try{const result=await verify.mutateAsync({publicId:data.publicId,signature:signature.trim()});setLocalMessage(result.message);}catch(error){setLocalMessage(error instanceof Error?error.message:"Verification could not be requested.");}};
  return <div className="checkout-page"><header className="checkout-nav"><Link href="/"><Brand/></Link><span className="checkout-security"><ShieldCheck size={13}/>Verified on Solana</span></header>
    <main className="checkout-content">
      <section className="checkout-card">
        <div className="checkout-merchant"><span className="merchant-avatar">{data.merchantName.slice(0,1).toUpperCase()}</span><span><b>{data.merchantName}</b><small>Payment request via LEXI PayLink</small></span><StatusPill status={data.status}/></div>
        <div className="checkout-amount"><label>Amount due</label><strong>{formatUsdc(data.amountBaseUnits)}<span>USDC</span></strong><small className="network-tag">Solana {data.network==="devnet"?"Devnet — test only":"Mainnet"}</small></div>
        <div className="checkout-details"><div className="checkout-detail"><span>For</span><b>{data.description}</b></div><div className="checkout-detail"><span>Reference</span><b>{data.orderId||data.customerReference||"—"}</b></div><div className="checkout-detail"><span>Expires</span><b>{formatDate(data.expiresAt)}</b></div><div className="checkout-detail"><span>USDC mint</span><b className="mono">{data.mint.slice(0,8)}…{data.mint.slice(-6)}</b></div></div>
        {settled?<div className="settlement-success"><span className="success-mark"><Check size={20}/></span><div><b>Payment verified</b><small>{redirecting?"Payment verified. Continuing to the merchant…":"LEXI confirmed the finalized transfer on Solana."}</small><span className="inline-actions" style={{marginTop:10}}><Link className="secondary-button" href={`/receipt/${data.publicId}`}><ShieldCheck size={13}/>Open verified receipt</Link>{data.redirectUrl&&<a className="secondary-button" href={data.redirectUrl}>Continue to merchant</a>}</span></div></div>:overpaidAwaitingReview?<div className="notice expiry-notice"><ShieldCheck size={14}/><span><b>Verified overpayment — manual review required.</b> The transfer is recorded, but this merchant's policy does not authorize automatic fulfillment or refund. Do not send another payment; contact the merchant.</span></div>:expired?<div className="notice expiry-notice"><Clock3 size={14}/><span><b>This request has expired.</b> New payments will not fulfill it. If you already sent funds, submit the transaction signature below so LEXI can record it for manual reconciliation.</span></div>:<div className="checkout-instructions"><h2>Pay with your Solana wallet</h2><p>Connect Phantom to send exact USDC, scan the wallet QR from your mobile wallet, or copy the receiving address. Your wallet will ask you to approve the transfer.</p><SolanaPayButton data={data}/><div className="divider-label"><span/>or pay with any compatible wallet<span/></div><div className="qr-box checkout-qr">{uriQr?<img src={uriQr} alt="Solana Pay QR code with recipient, mint, amount and unique invoice reference"/>:<LoaderCircle size={18}/>}</div><div className="address-copy"><code className="mono">{data.receivingWallet}</code><button className="icon-button" aria-label="Copy recipient address" onClick={()=>void copy(data.receivingWallet)}><Copy size={14}/></button></div><div className="inline-actions" style={{marginTop:8}}><button className="secondary-button" type="button" onClick={()=>void copy(`LEXI PayLink payment details\nAmount: ${formatUsdc(data.amountBaseUnits)} USDC\nNetwork: Solana ${data.network}\nRecipient: ${data.receivingWallet}\nReference: ${data.referencePublicKey}`)}><Copy size={13}/>Copy payment details</button></div>{copied&&<small className="copy-feedback">Copied to clipboard</small>}</div>}
        {data.receipt&&<div className="receipt-inline"><ShieldCheck size={16}/><span><b>Receipt {String((data.receipt as Record<string,unknown>).receiptNumber)}</b><small>Verified transaction · {formatDate(String((data.receipt as Record<string,unknown>).confirmedAt??""))}</small></span><button className="secondary-button" onClick={()=>window.print()}><ExternalLink size={13}/>Print</button></div>}
      </section>
      <aside className="checkout-card verify-card"><div className="verify-heading"><span className="stat-icon"><LockKeyhole size={15}/></span><div><b>Settlement timeline</b><small>Only server-verified funds fulfill orders.</small></div></div><div className="timeline">{(data.events??[]).slice().reverse().map((event,index)=><div className="timeline-row" key={`${event.eventType}-${index}`}><span className="timeline-dot"><Check size={9}/></span><span><b>{event.eventType.replaceAll("_"," ")}</b><small>{formatDate(event.createdAt)}</small></span></div>)}<div className="timeline-row"><span className="timeline-dot"><Clock3 size={9}/></span><span><b>{settled?"Finalized and verified":"Waiting for settlement"}</b><small>{settled?"Receipt available above":"A submitted signature is not proof of payment."}</small></span></div></div><div className="notice"><ShieldCheck size={14}/><span>LEXI checks finalized Solana transaction data, USDC mint, destination wallet and exact amount. A wallet success screen alone does not mark this invoice paid.</span></div></aside>
      {!settled&&!overpaidAwaitingReview&&<section className="checkout-card signature-card"><div className="signature-title"><WalletCards size={17}/><span><b>Already sent USDC?</b><small>Paste the transaction signature. LEXI will verify it on the server.</small></span></div><form onSubmit={submit}><label htmlFor="signature">Solana transaction signature</label><div className="signature-row"><input id="signature" className="control mono" value={signature} onChange={e=>setSignature(e.target.value)} minLength={80} maxLength={100} placeholder="Paste transaction signature" required/><button className="button button-primary" disabled={verify.isPending||!signature}>{verify.isPending?"Verifying…":"Verify payment"}</button></div></form>{(localMessage||verify.error)&&<div className={verify.error?"alert-error":"verification-message"} role="status">{localMessage||verify.error?.message}</div>}</section>}
      <div className="checkout-safe"><ShieldCheck size={13}/>Never enter your seed phrase or private key on this page.</div>
    </main><footer className="checkout-footer"><span><ShieldCheck size={12}/>Server-verified settlement</span><span>USDC · Solana</span><span>Powered by LEXI PayLink</span></footer>
  </div>;
}
function SolanaPayButton({data}:{data:CheckoutData}) {
  const {connection}=useConnection();const {publicKey,sendTransaction}=useWallet();
  const submitSignature=trpc.payments.submitSignature.useMutation();
  const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  const sign=async()=>{setError("");if(!publicKey||!sendTransaction)return;setBusy(true);try{
    const mint=new PublicKey(data.mint);const merchant=new PublicKey(data.receivingWallet);const amount=BigInt(data.amountBaseUnits);
    const source=await getAssociatedTokenAddress(mint,publicKey,false,TOKEN_PROGRAM_ID);const destination=await getAssociatedTokenAddress(mint,merchant,false,TOKEN_PROGRAM_ID);
    const transaction=new Transaction();
    if(!await connection.getAccountInfo(destination))transaction.add(createAssociatedTokenAccountInstruction(publicKey,destination,merchant,mint,TOKEN_PROGRAM_ID));
    const transfer=createTransferCheckedInstruction(source,mint,destination,publicKey,amount,6,[],TOKEN_PROGRAM_ID);
    transfer.keys.push({pubkey:new PublicKey(data.referencePublicKey),isSigner:false,isWritable:false});
    transaction.add(transfer);
    const signature=await sendTransaction(transaction,connection);
    // Client submission is only a pointer; the server makes all settlement decisions.
    await submitSignature.mutateAsync({publicId:data.publicId,signature});
    window.location.reload();
  }catch(cause){setError(cause instanceof Error?cause.message:"Wallet transaction could not be prepared.");}finally{setBusy(false);}};
  return <div className="wallet-connect-area"><WalletMultiButton/> {publicKey&&<button className="wallet-button" onClick={()=>void sign()} disabled={busy}>{busy?<><LoaderCircle size={14} className="spin"/> Sending transaction…</>:"Pay exact amount with Phantom"}</button>}{error&&<div className="alert-error" style={{marginTop:10}}>{error}</div>}<small className="field-hint">You review and approve the Solana transaction in your wallet. LEXI never holds funds or private keys.</small></div>;
}
