import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings, type ThemeMode } from "@/lib/app-state";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage(){
  const [settings,setSettings]=useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(()=>setSettings(loadSettings()),[]);
  const commit=(patch:Partial<AppSettings>)=>{const next={...settings,...patch};setSettings(next);saveSettings(next);if(typeof document!=="undefined")document.documentElement.dataset["theme"]=next.theme;};
  return <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-28 pt-8">
    <h1 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Settings</h1>
    <div className="mt-5 space-y-4">
      <Card className="p-4"><label className="text-sm font-medium">Theme</label><select value={settings.theme} onChange={e=>commit({theme:e.target.value as ThemeMode})} className="mt-2 w-full rounded-md border bg-background p-2 text-sm"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option><option value="sepia">Sepia</option></select></Card>
      <Card className="p-4"><div className="flex justify-between"><label className="text-sm font-medium">Scripture font size</label><span className="text-sm text-muted-foreground">{settings.fontSize}px</span></div><input className="mt-3 w-full" type="range" min={16} max={30} value={settings.fontSize} onChange={e=>commit({fontSize:Number(e.target.value)})}/><div className="mt-4 flex justify-between"><label className="text-sm font-medium">Line spacing</label><span className="text-sm text-muted-foreground">{settings.lineHeight.toFixed(1)}</span></div><input className="mt-3 w-full" type="range" min={1.4} max={2.4} step={0.1} value={settings.lineHeight} onChange={e=>commit({lineHeight:Number(e.target.value)})}/></Card>
      <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-medium">Study reminder</p><p className="text-xs text-muted-foreground">Stored in-app; browser notifications require your permission.</p></div><Switch checked={settings.reminderEnabled} onCheckedChange={v=>commit({reminderEnabled:v})}/></div><input className="mt-3 w-full rounded-md border bg-background p-2 text-sm" type="time" value={settings.reminderTime} onChange={e=>commit({reminderTime:e.target.value})}/></Card>
      <Card className="p-4"><div className="flex justify-between"><label className="text-sm font-medium">Default audio speed</label><span className="text-sm text-muted-foreground">{settings.audioRate}×</span></div><select className="mt-2 w-full rounded-md border bg-background p-2 text-sm" value={settings.audioRate} onChange={e=>commit({audioRate:Number(e.target.value)})}>{[0.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select><div className="mt-4 flex items-center justify-between"><label className="text-sm font-medium">Auto-scroll while reading aloud</label><Switch checked={settings.autoScroll} onCheckedChange={v=>commit({autoScroll:v})}/></div></Card>
      <Card className="p-4"><label className="text-sm font-medium">Timezone</label><input className="mt-2 w-full rounded-md border bg-background p-2 text-sm" value={settings.timezone} onChange={e=>commit({timezone:e.target.value})}/></Card>
    </div>
  </main>;
}
