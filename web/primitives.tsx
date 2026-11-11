import type { ReactNode } from 'react';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const shapes: Record<string, ReactNode> = {
    shield: <><path d="M12 3 4.5 6v5.6c0 4.2 3.3 7.4 7.5 9.4 4.2-2 7.5-5.2 7.5-9.4V6L12 3Z"/><path d="m8.5 12 2.4 2.4 4.8-5"/></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    traffic: <><path d="M3 13h4l3-7 4 13 3-8h4"/></>,
    incident: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/></>,
    agent: <><rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12h.1M16 12h.1M9 16h6M1 12h3m16 0h3"/><circle cx="12" cy="2.5" r=".8"/></>,
    response: <><path d="M12 3 4 13h7l-1 8 10-12h-8l1-6Z"/></>,
    audit: <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    server: <><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.1M7 17.5h.1M12 6.5h5m-5 11h5"/></>,
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    terminal: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m6 8 4 4-4 4m7 0h5"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
    logout: <><path d="M10 4H4v16h6m4-4 4-4-4-4m-5 4h12"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name] || shapes.shield}</svg>;
}
export function Badge({ children, tone = 'muted', dot = false }: { children: ReactNode; tone?: string; dot?: boolean }) { return <span className={`badge ${tone}`}>{dot && <i/>}{children}</span>; }
export function Empty({ title, detail, icon = 'shield' }: { title: string; detail: string; icon?: string }) { return <div className="empty"><span className="empty-icon"><Icon name={icon} size={25}/></span><strong>{title}</strong><p>{detail}</p></div>; }
export function Panel({ title, eyebrow, action, children, className = '' }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) { return <section className={`panel ${className}`}><div className="panel-head"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{action}</div>{children}</section>; }
