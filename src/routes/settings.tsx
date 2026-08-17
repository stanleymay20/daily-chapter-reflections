import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Cloud, LogIn, LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings, type ThemeMode } from "@/lib/app-state";
import { getCloudUser, sendSignInLink, signOutCloud, syncStudyData } from "@/lib/cloud-sync";
import { requireSupabase } from "@/lib/supabase.client";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

const tracks=["Law","History","Psalms","Wisdom","Prophets","Gospels","Acts & Epistles"];

function SettingsPage(){
  const [settings,setSettings]=useState<AppSettings>(DEFAULT_SETTINGS);
  const [account,setAccount]=useState<string | null>(null);
  const [email,setEmail]=useState("");
  const [accountMessage,setAccountMessage]=useState("");
  const [syncing,setSyncing]=useState(false);

  useEffect(()=>{
    setSettings(loadSettings());
    getCloudUser().then(u=>setAccount(u?.email??null)).catch(()=>{});
    try {
      const sb=requireSupabase();
      const {data}=sb.auth.onAuthStateChange((_event,session)=>setAccount(session?.user.email??null));
      return()=>data.subscription.unsubscribe();
    } catch { return; }
  },[]);

  const commit=(patch:Partial<AppSettings>)=>{const next={...settings,...patch};setSettings(next);saveSettings(next);if(typeof document!=="undefined")document.documentElement.dataset["theme"]=next.theme;};
  const toggleTrack=(track:string)=>commit({activeTracks:settings.activeTracks.includes(track)?settings.activeTracks.filter(x=>x!==track):[...settings.activeTracks,track]});
  const requestLink=async()=>{if(!email.trim())return;setAccountMessage("Sending sign-in link…");try{await sendSignInLink(email.trim());setAccountMessage("Check your email for the secure sign-in link.");}catch(e){setAccountMessage(e instanceof Error?e.message:"Unable to send sign-in link.");}};
  const sync=async()=>{setSyncing(true);setAccountMessage("");try{await syncStudyData();setSettings(loadSettings());setAccountMessage("Cloud sync complete. Settings, reading progress and chapter notes are backed up.");}catch(e){setAccountMessage(e instanceof Error?e.message:"Cloud sync failed.");}finally{setSyncing(false)}};
  const logout=async()=>{try{await signOutCloud();setAccount(null);setAccountMessage("Signed out. Your local study data remains on this device.");}catch(e){setAccountMessage(e instanceof Error?e.message:"Sign out failed.");}};

  return <main className="mx-auto min-h-screen w-full max-w-md px-5 pb-28 pt-8">
    <h1 className="font-[family-name:var(--font-scripture)] text-3xl font-semibold">Settings</h1>
    <div className="mt-5 space-y-4">
      <Card className="p-4"><div className="flex items-center gap-2"><Cloud className="size-4 text-primary"/><h2 className="text-sm font-semibold">Account & cloud sync</h2></div>{account?<><p className="mt-2 text-xs text-muted-foreground">Signed in as {account}. Private reading progress, chapter notes and settings can sync across devices.</p><div className="mt-3 flex gap-2"><Button size="sm" onClick={sync} disabled={syncing}><RefreshCw className={`mr-1 size-3.5 ${syncing?"animate-spin":""}`}/>{syncing?"Syncing…":"Sync now"}</Button><Button size="sm" variant="outline" onClick={logout}><LogOut className="mr-1 size-3.5"/>Sign out</Button></div></>:<><p className="mt-2 text-xs text-muted-foreground">Sign in with an email link to back up your private study data. Community sign-in uses the same account.</p><div className="mt-3 flex gap-2"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" className="min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"/><Button size="sm" onClick={requestLink}><LogIn className="mr-1 size-3.5"/>Email link</Button></div></>}{accountMessage?<p className="mt-3 rounded-md bg-muted p-2 text-xs">{accountMessage}</p>:null}</Card>

      <Card className="p-4"><label className="text-sm font-medium">Theme</label><select value={settings.theme} onChange={e=>commit({theme:e.target.value as ThemeMode})} className="mt-2 w-full rounded-md border bg-background p-2 text-sm"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option><option value="sepia">Sepia</option></select></Card>

      <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-medium">Chapters per day</p><p className="text-xs text-muted-foreground">Keep the seven-track plan, or make the daily workload lighter.</p></div><strong className="text-lg">{settings.chaptersPerDay}</strong></div><input className="mt-3 w-full" type="range" min={1} max={7} value={settings.chaptersPerDay} onChange={e=>commit({chaptersPerDay:Number(e.target.value)})}/><div className="mt-4 flex flex-wrap gap-2">{tracks.map(track=><button key={track} onClick={()=>toggleTrack(track)} className={`rounded-full border px-3 py-1 text-xs ${settings.activeTracks.includes(track)?"bg-primary text-primary-foreground":"bg-background text-muted-foreground"}`}>{track}</button>)}</div></Card>

      <Card className="p-4"><div className="flex justify-between"><label className="text-sm font-medium">Scripture font size</label><span className="text-sm text-muted-foreground">{settings.fontSize}px</span></div><input className="mt-3 w-full" type="range" min={16} max={30} value={settings.fontSize} onChange={e=>commit({fontSize:Number(e.target.value)})}/><div className="mt-4 flex justify-between"><label className="text-sm font-medium">Line spacing</label><span className="text-sm text-muted-foreground">{settings.lineHeight.toFixed(1)}</span></div><input className="mt-3 w-full" type="range" min={1.4} max={2.4} step={0.1} value={settings.lineHeight} onChange={e=>commit({lineHeight:Number(e.target.value)})}/></Card>

      <Card className="p-4"><div className="flex items-center justify-between"><div><p className="text-sm font-medium">Study reminder</p><p className="text-xs text-muted-foreground">The app remembers your schedule. Reliable background push reminders require a later push-notification service.</p></div><Switch checked={settings.reminderEnabled} onCheckedChange={v=>commit({reminderEnabled:v})}/></div><input className="mt-3 w-full rounded-md border bg-background p-2 text-sm" type="time" value={settings.reminderTime} onChange={e=>commit({reminderTime:e.target.value})}/></Card>

      <Card className="p-4"><div className="flex justify-between"><label className="text-sm font-medium">Default audio speed</label><span className="text-sm text-muted-foreground">{settings.audioRate}×</span></div><select className="mt-2 w-full rounded-md border bg-background p-2 text-sm" value={settings.audioRate} onChange={e=>commit({audioRate:Number(e.target.value)})}>{[0.75,1,1.25,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select><div className="mt-4 flex items-center justify-between"><label className="text-sm font-medium">Auto-scroll while reading aloud</label><Switch checked={settings.autoScroll} onCheckedChange={v=>commit({autoScroll:v})}/></div></Card>
      <Card className="p-4"><label className="text-sm font-medium">Timezone</label><input className="mt-2 w-full rounded-md border bg-background p-2 text-sm" value={settings.timezone} onChange={e=>commit({timezone:e.target.value})}/></Card>
    </div>
  </main>;
}
