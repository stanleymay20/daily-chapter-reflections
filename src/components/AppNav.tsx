import { Link, useRouterState } from "@tanstack/react-router";
import { BookHeart, CalendarDays, NotebookTabs, UserRound } from "lucide-react";

import { NeuralNarrationDock } from "@/components/NeuralNarrationDock";

// Four thumb-reachable destinations. Progress, Community and Plans are secondary and live under "You".
export const NAV_ITEMS=[
  {to:"/",label:"Today",icon:BookHeart,match:["/"]},
  {to:"/calendar",label:"Calendar",icon:CalendarDays,match:["/calendar"]},
  {to:"/saved",label:"Journal",icon:NotebookTabs,match:["/saved"]},
  {to:"/settings",label:"You",icon:UserRound,match:["/settings","/progress","/community","/plans"]},
] as const;

export function AppNav(){
  const path=useRouterState({select:s=>s.location.pathname});
  if(path.startsWith("/read/"))return <NeuralNarrationDock/>;
  return <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85" aria-label="Primary navigation">
    <div className="mx-auto grid max-w-md grid-cols-4 gap-1 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5">
      {NAV_ITEMS.map(({to,label,icon:Icon,match})=>{const active=to==="/"?path==="/":match.some(m=>path.startsWith(m));return <Link key={to} to={to} aria-current={active?"page":undefined} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors ${active?"bg-primary/10 text-primary":"text-muted-foreground hover:text-foreground"}`}><Icon className="size-5" aria-hidden="true"/><span>{label}</span></Link>})}
    </div>
  </nav>;
}
