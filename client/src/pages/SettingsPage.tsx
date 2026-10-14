import { Check, Copy, KeyRound, Link2, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import AppShell from "@/components/lexi/AppShell";
import StatusPill from "@/components/lexi/StatusPill";
import { trpc } from "@/lib/trpc";
import type { WorkflowTrigger } from "@shared/lexi";

const webhookEvents: WorkflowTrigger[] = ["request_created", "payment_detected", "payment_confirmed", "payment_underpaid", "payment_expired", "verification_failed"];

export default function SettingsPage() {
  const query = trpc.settings.get.useQuery();
  const hooks = trpc.settings.webhooks.useQuery();
  const save = trpc.settings.update.useMutation();
  const saveTelegram = trpc.settings.saveTelegramBotToken.useMutation();
  const rotateToken = trpc.settings.rotateAgentToken.useMutation();
  const addHook = trpc.settings.addWebhook.useMutation({ onSuccess: () => void hooks.refetch() });
  const removeHook = trpc.settings.removeWebhook.useMutation({ onSuccess: () => void hooks.refetch() });
  const [displayName, setDisplayName] = useState("");
  const [receivingWallet, setReceivingWallet] = useState("");
  const [network, setNetwork] = useState<"mainnet" | "devnet">("mainnet");
  const [email, setEmail] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [overpaymentPolicy, setPolicy] = useState<"reject" | "accept">("reject");
  const [botToken, setBotToken] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WorkflowTrigger[]>(["payment_confirmed"]);
  const [newSecret, setNewSecret] = useState("");
  const [agentToken, setAgentToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (query.data && !initialized) {
      setDisplayName(query.data.merchant.displayName);
      setReceivingWallet(query.data.settings.receivingWallet);
      setNetwork(query.data.settings.network);
      setEmail(query.data.settings.email);
      setTelegramChatId(query.data.settings.telegramChatId);
      setPolicy(query.data.settings.overpaymentPolicy);
      setInitialized(true);
    }
  }, [query.data, initialized]);

  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setNotice("Copied to clipboard."); }
    catch { setError("Clipboard access was blocked by this browser."); }
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setNotice("");
    try {
      await save.mutateAsync({ displayName, receivingWallet, network, email, telegramChatId, overpaymentPolicy });
      await query.refetch();
      setNotice("Merchant settings saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save settings."); }
  };

  const createHook = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(""); setNotice("");
    try {
      const response = await addHook.mutateAsync({ url, subscriptions: events });
      setNewSecret(response.secret);
      setUrl("");
      setNotice("Webhook added. Copy its signing secret now; it is shown only once.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Webhook could not be created."); }
  };

  const showError = error || save.error?.message || saveTelegram.error?.message || rotateToken.error?.message || addHook.error?.message || removeHook.error?.message;

  return <AppShell title="Settings" eyebrow="Merchant & security">
    <div className="page-intro"><div><span className="eyebrow-small">Configuration</span><h2>Merchant and integration settings</h2><p>Secrets are stored server-side. LEXI never asks for wallet seed phrases or private keys.</p></div></div>
    {query.isLoading ? <div className="loading-state">Loading settings…</div> : query.error ? <div className="alert-error">{query.error.message}</div> : <div className="settings-layout">
      <form className="surface form-card" onSubmit={handleSave}>
        <h3 className="form-section-title">Merchant profile</h3><p className="form-section-copy">Defaults apply to new payment requests. Existing invoices keep their original terms.</p>
        <div className="field"><label htmlFor="name">Merchant display name</label><input id="name" className="control" value={displayName} onChange={event => setDisplayName(event.target.value)} required maxLength={120}/></div>
        <div className="field"><label htmlFor="wallet">Default receiving wallet</label><input id="wallet" className="control mono" value={receivingWallet} onChange={event => setReceivingWallet(event.target.value)} placeholder="Public Solana address only"/><small className="field-hint">No custody. Only enter a public wallet address; never enter a private key.</small></div>
        <div className="field-grid"><div className="field"><label htmlFor="network">Default network</label><select id="network" className="control" value={network} onChange={event => setNetwork(event.target.value as "mainnet" | "devnet")}><option value="mainnet">Solana Mainnet</option><option value="devnet">Solana Devnet (test only)</option></select></div><div className="field"><label htmlFor="policy">Overpayment policy</label><select id="policy" className="control" value={overpaymentPolicy} onChange={event => setPolicy(event.target.value as "reject" | "accept")}><option value="reject">Do not fulfill automatically</option><option value="accept">Accept and fulfill</option></select></div></div>
        <div className="field-grid"><div className="field"><label htmlFor="email">Notification email</label><input id="email" className="control" type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@business.com"/></div><div className="field"><label htmlFor="chat">Telegram chat ID</label><input id="chat" className="control" value={telegramChatId} onChange={event => setTelegramChatId(event.target.value)} placeholder="Chat ID or @public-channel"/><small className="field-hint">Add the bot to the chat and send it a message before storing the token; LEXI validates bot access without sending a test message.</small></div></div>
        <div className="inline-actions"><button className="button button-primary" type="submit" disabled={save.isPending}><Save size={14}/>{save.isPending ? "Saving…" : "Save profile"}</button></div>
      </form>

      <div className="settings-stack">
        <section className="surface form-card"><h3 className="form-section-title">Agent access</h3><p className="form-section-copy">Create a merchant-scoped API token for LEXI MCP clients. The raw token is shown once and never stored in plaintext.</p>
          {agentToken ? <div className="one-time-secret"><b>Copy this token now</b><code className="mono">{agentToken}</code><button className="secondary-button" onClick={() => void copy(agentToken)}><Copy size={13}/>Copy token</button><small>LEXI MCP endpoint: <code>/api/mcp</code>. Store the token in the client's secret store.</small></div> : <button className="secondary-button" onClick={async () => { setError(""); try { const result = await rotateToken.mutateAsync(); setAgentToken(result.token); setNotice("Agent token created and shown once."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not rotate agent token."); } }} disabled={rotateToken.isPending}><KeyRound size={14}/>{rotateToken.isPending ? "Creating…" : "Create / rotate agent token"}</button>}
        </section>

        <section className="surface form-card"><h3 className="form-section-title">Telegram notifications</h3><p className="form-section-copy">Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a>, add it to the destination chat, and send it a message. Configure the chat ID above, then store the bot token; LEXI checks the bot and its access without sending a message.</p>
          <form onSubmit={async event => { event.preventDefault(); setError(""); try { await saveTelegram.mutateAsync({ token: botToken }); setBotToken(""); setNotice("Telegram token validated, encrypted, and stored."); await query.refetch(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Telegram token was not stored."); } }}>
            <div className="field"><label htmlFor="bot">Telegram bot token</label><input id="bot" className="control" type="password" value={botToken} onChange={event => setBotToken(event.target.value)} placeholder="Token from @BotFather" autoComplete="new-password"/></div>
            <button className="secondary-button" disabled={!botToken || saveTelegram.isPending}><ShieldCheck size={13}/>{saveTelegram.isPending ? "Validating…" : "Validate and store securely"}</button>
          </form>
          <div className="settings-health"><span>Bot token</span><StatusPill status={query.data?.settings.telegramConfigured ? "CONFIRMED" : "CREATED"}/></div><div className="settings-health"><span>Email provider (server key)</span><StatusPill status={query.data?.settings.emailProviderConfigured ? "CONFIRMED" : "CREATED"}/></div>
        </section>

        <section className="surface form-card"><h3 className="form-section-title">Signed merchant webhooks</h3><p className="form-section-copy">HTTPS only. Private and loopback destinations are blocked, and DNS is pinned for delivery. Signatures use HMAC-SHA256 over timestamp + body.</p>
          <form onSubmit={createHook}><div className="field"><label htmlFor="webhook">Endpoint URL</label><input id="webhook" className="control" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://api.example.com/lexi" required/></div>
            <div className="field"><label>Event subscriptions</label><div className="subscription-grid">{webhookEvents.map(event => <label className="check-row" key={event}><input type="checkbox" checked={events.includes(event)} onChange={change => setEvents(previous => change.target.checked ? [...previous, event] : previous.filter(value => value !== event))}/>{event.replaceAll("_", " ")}</label>)}</div></div>
            <button className="secondary-button" disabled={addHook.isPending || events.length === 0}><Plus size={13}/>{addHook.isPending ? "Validating…" : "Add webhook"}</button>
          </form>
          {newSecret && <div className="one-time-secret"><b>Signing secret — shown once</b><code className="mono">{newSecret}</code><button className="secondary-button" onClick={() => void copy(newSecret)}><Copy size={13}/>Copy secret</button><small>Keep it in your server-side secret store; it will not be shown again.</small></div>}
          {hooks.data?.map(hook => <div className="webhook-row" key={hook.id}><Link2 size={14}/><span><b>{hook.url}</b><small>{hook.subscriptions.join(", ")}</small></span><button className="icon-button" onClick={() => removeHook.mutate({ id: hook.id })} aria-label="Disable webhook" title="Disable webhook"><Trash2 size={13}/></button></div>)}
        </section>
        {notice && <div className="notice"><Check size={13}/><span>{notice}</span></div>}{showError && <div className="alert-error">{showError}</div>}
        {network === "mainnet" && <div className="notice"><ShieldCheck size={14}/><span>Mainnet transfers are real funds. LEXI does not custody assets and cannot reverse a transfer.</span></div>}
      </div>
    </div>}
  </AppShell>;
}
