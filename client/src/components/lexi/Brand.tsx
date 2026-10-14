export default function Brand({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  return <div className={`brand-lockup ${compact ? "brand-compact" : ""} ${inverse ? "brand-inverse" : ""}`} aria-label="LEXI PayLink">
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 36 36" fill="none"><path d="M7 10.5h9.2c6.5 0 11.8 5.3 11.8 11.8v3.2" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round"/><path d="M29 25.5h-9.2C13.3 25.5 8 20.2 8 13.7v-3.2" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round"/><circle cx="28.7" cy="27.2" r="2.3" fill="currentColor"/></svg></span>
    {!compact && <span className="brand-word"><b>LEXI</b><span>PayLink</span></span>}
  </div>;
}
