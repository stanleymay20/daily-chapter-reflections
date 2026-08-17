import { Link, useRouterState } from "@tanstack/react-router";
import { BookHeart, CalendarDays, NotebookTabs, Settings, TrendingUp } from "lucide-react";

const items=[
  {to:"/",label:"Today",icon:BookHeart},
  {to:"/calendar",label:"Calendar",icon:CalendarDays},
  {to:"/saved",label:"Journal",icon:NotebookTabs},
  {to:"/progress",label:"Progress",icon:TrendingUp},
  {to:"/settings",label:"Settings",icon:Settings},
] as const;

export function AppNav(){
  const path=useRouterState({select:s=>s.location.pathname});
  const hidden=path.startsWith("/read/");
  if(hidden)return null;
  return <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85" aria-label="Primary navigation"><div className="mx-auto grid max-w-2xl grid-cols-5 px-1 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">{items.map(({to,label,icon:Icon})=>{const active=to==="/"?path==="/":path.startsWith(to);return <Link key={to} to={to} aria-current={active?"page":undefined} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[10px] transition ${active?"text-primary":"text-muted-foreground hover:text-foreground"}`}><Icon className="size-4"/><span>{label}</span></Link>})}</div></nav>;
}
