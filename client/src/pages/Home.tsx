import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CircleDollarSign, LockKeyhole, ShieldCheck, Sparkles, WalletCards, Zap } from "lucide-react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { startLogin } from "../const";
import Brand from "../components/lexi/Brand";

const steps = [
  { number: "01", title: "Make a request", body: "Set the amount, wallet and expiry. LEXI gives you a private, shareable payment link." },
  { number: "02", title: "Share it anywhere", body: "Send the link in a message, social post, invoice or QR. No storefront required." },
  { number: "03", title: "Verify, then automate", body: "LEXI checks the finalized Solana transfer before it creates a receipt or updates your order." },
];

export default function Home() {
  const me = trpc.auth.me.useQuery();
  const signedIn = Boolean(me.data?.openId);
  return <main className="landing-page">
    <header className="landing-nav"><Link href="/" className="landing-brand"><Brand/></Link><nav><a href="#how-it-works">How it works</a><a href="#security">Security</a></nav><div className="landing-nav-actions"><button className="text-button" onClick={() => startLogin()}>{signedIn ? "Merchant login" : "Sign in"}</button><Link href="/dashboard" className="button button-primary button-small">Open workspace <ArrowUpRight size={15}/></Link></div></header>
    <section className="hero-section">
      <div className="hero-copy"><div className="hero-kicker"><span className="kicker-dot"/> CRYPTO PAYMENTS, WITHOUT THE STORE</div><h1>One link.<br/><em>Payment received.</em><br/>Business in motion.</h1><p>LEXI helps independent merchants request and receive USDC, then automates what happens next. No storefront. No guesswork. Just a payment link that works.</p><div className="hero-actions"><button className="button button-dark" onClick={() => signedIn ? (window.location.href = "/dashboard") : startLogin()}>Create a payment link <ArrowRight size={17}/></button><a href="#how-it-works" className="text-link">See how it works <ArrowDownRight size={15}/></a></div><div className="hero-proof"><div className="proof-avatars"><span>L</span><span>F</span><span>C</span></div><span>Built for people who do business their way</span></div></div>
      <div className="hero-art" aria-label="Illustration of a verified payment link">
        <div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/>
        <div className="hero-floating-tag"><span className="mini-check"><Check size={13}/></span><span><b>Payment verified</b><small>Finalized on Solana</small></span></div>
        <div className="payment-preview"><div className="preview-top"><Brand compact/><span className="preview-status"><i/>Awaiting payment</span></div><div className="preview-merchant"><div className="merchant-avatar">N</div><span><b>Northline Studio</b><small>Design services</small></span></div><div className="preview-amount"><span>Amount due</span><b>$240<span>.00</span></b><small><span className="token-dot">S</span> USDC <span className="sep-dot">·</span> Solana</small></div><div className="preview-link"><span>lexi.pay/p/nt4k…</span><span className="copy-chip">Copy link</span></div><div className="preview-footer"><span><LockKeyhole size={12}/> Verified before fulfillment</span><ArrowUpRight size={14}/></div></div>
        <div className="hero-floating-note"><div className="note-icon"><Zap size={16}/></div><span><b>Then what?</b><small>Receipt · order · notification</small></span></div>
        <div className="hero-circular-mark"><span>LEXI</span><small>PAYLINK</small><svg viewBox="0 0 100 100" aria-hidden="true"><defs><path id="circlePath" d="M 50,50 m -37,0 a 37,37 0 1,1 74,0 a 37,37 0 1,1 -74,0"/></defs><text><textPath href="#circlePath">SHARE · VERIFY · AUTOMATE · </textPath></text></svg></div>
      </div>
    </section>
    <section className="proof-strip" id="security"><div><ShieldCheck size={19}/><span><b>Verified at the source</b><small>Server-checked blockchain transfers</small></span></div><div><WalletCards size={19}/><span><b>Works without a storefront</b><small>Share in any channel</small></span></div><div><CircleDollarSign size={19}/><span><b>USDC on Solana</b><small>Transparent request amounts</small></span></div><div><Sparkles size={19}/><span><b>Automate the next step</b><small>Receipts, orders and notifications</small></span></div></section>
    <section id="how-it-works" className="steps-section"><div className="section-lead"><span className="eyebrow">A better way to get paid</span><h2>From “send me the details”<br/>to <em>done.</em></h2><p>Share a link. LEXI handles verification and keeps every next step connected.</p></div><div className="steps-list">{steps.map(step => <article className="step-row" key={step.number}><span className="step-number">{step.number}</span><div><h3>{step.title}</h3><p>{step.body}</p></div><ArrowUpRight size={18}/></article>)}</div></section>
    <section className="closing-cta"><div><span className="eyebrow">Your next payment, simplified</span><h2>Take the busywork<br/>out of <em>being paid.</em></h2></div><button className="button button-dark" onClick={() => signedIn ? (window.location.href = "/dashboard") : startLogin()}>Enter LEXI PayLink <ArrowRight size={17}/></button></section>
    <footer className="landing-footer"><Brand compact/><span>Payments are only marked complete after server verification.</span><span>© 2026 LEXI PayLink</span></footer>
  </main>;
}
