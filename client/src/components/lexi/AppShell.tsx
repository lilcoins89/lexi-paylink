import { Activity, ArrowLeftRight, CircleHelp, ClipboardList, FileText, LayoutDashboard, LogOut, Moon, Plus, Settings, Sun, Workflow } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import Brand from "./Brand";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/create", label: "New request", icon: Plus },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/receipts", label: "Receipts", icon: FileText },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/activity", label: "Activity & audit", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/paybox", label: "PayBox tools", icon: ArrowLeftRight },
];

export default function AppShell({ children, title, eyebrow }: { children: React.ReactNode; title: string; eyebrow?: string }) {
  const [path, navigate] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { void me.refetch(); navigate("/"); } });
  const name = me.data?.name?.split(" ")[0] || "Merchant";
  return <div className="app-shell">
    <aside className="app-sidebar">
      <Link href="/dashboard" className="sidebar-brand"><Brand /></Link>
      <div className="nav-caption">Workspace</div>
      <nav className="side-nav" aria-label="Main navigation">
        {links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${path === href || path.startsWith(`${href}/`) ? "active" : ""}`}><Icon size={17} strokeWidth={1.8}/><span>{label}</span>{href === "/create" && <kbd>+</kbd>}</Link>)}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-trust"><span className="trust-icon"><CircleHelp size={16}/></span><div><b>Settlement, verified.</b><small>Payments are confirmed on Solana.</small></div></div>
      <div className="sidebar-profile"><span className="avatar">{name.slice(0,1).toUpperCase()}</span><div className="profile-copy"><b>{name}</b><small>Merchant account</small></div><button className="icon-button small" title="Sign out" onClick={() => logout.mutate()} aria-label="Sign out"><LogOut size={16}/></button></div>
    </aside>
    <main className="app-main">
      <header className="topbar"><div className="topbar-heading"><span className="eyebrow">{eyebrow || "Merchant workspace"}</span><h1>{title}</h1></div><div className="topbar-actions"><span className="live-indicator"><i/>Solana payments</span><button className="icon-button" onClick={() => toggleTheme?.()} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={18}/> : <Moon size={18}/>}</button><Link href="/create" className="button button-primary button-small"><Plus size={16}/> New request</Link></div></header>
      <section className="page-content">{children}</section>
      <footer className="app-footer"><span>LEXI PayLink</span><span>One link. One verified payment. An automated workflow.</span></footer>
    </main>
  </div>;
}
