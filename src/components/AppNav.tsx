import { Link, useRouterState } from "@tanstack/react-router";
import { BookOpen, CalendarDays, ListChecks, Bookmark, Settings, Users } from "lucide-react";

const items = [
  { to: "/", label: "Today", icon: BookOpen },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/plans", label: "Plans", icon: ListChecks },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/community", label: "Community", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export function AppNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto grid max-w-md grid-cols-6 px-0.5 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
        {items.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? path === "/" : path.startsWith(to);
          return (
            <Link key={to} to={to} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[9px] ${active ? "text-primary" : "text-muted-foreground"}`}>
              <Icon className="size-4" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
