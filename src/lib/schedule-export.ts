import { chapterLabel, getPlanForDate } from "./schedule";

export type CalendarExportOptions = {
  startDate: string;
  days: number;
  time: string;
  timezone: string;
  chaptersPerDay: number;
  activeTracks: string[];
};

function addDays(iso:string,offset:number){const [y,m,d]=iso.split("-").map(Number);const date=new Date(Date.UTC(y!,m!-1,d!+offset));return date.toISOString().slice(0,10)}
function esc(value:string){return value.replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;")}
function stamp(iso:string,time:string){return `${iso.replace(/-/g,"")}T${time.replace(":","")}00`}

export function buildStudyCalendarIcs(options:CalendarExportOptions){
  const days=Math.max(1,Math.min(366,Math.floor(options.days)));
  const tracks=new Set(options.activeTracks);
  const events:string[]=[];
  for(let i=0;i<days;i++){
    const date=addDays(options.startDate,i);const plan=getPlanForDate(date);if(!plan)continue;
    const chapters=plan.chapters.filter(c=>tracks.has(c.track)).slice(0,Math.max(1,Math.min(7,options.chaptersPerDay)));
    if(!chapters.length)continue;
    const readings=chapters.map(chapterLabel).join(" · ");
    events.push(["BEGIN:VEVENT",`UID:${date}-bible-study@daily-chapter-reflections`,`DTSTART;TZID=${options.timezone}:${stamp(date,options.time)}`,"DURATION:PT60M",`SUMMARY:${esc("Bible Study · "+readings)}`,`DESCRIPTION:${esc("Today's plan: "+readings+". Open Daily Scripture Companion to read real Scripture from YouVersion and continue your study journal.")}`,"BEGIN:VALARM","TRIGGER:-PT0M","ACTION:DISPLAY","DESCRIPTION:Start your Bible study","END:VALARM","END:VEVENT"].join("\r\n"));
  }
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Daily Scripture Companion//Study Plan//EN","CALSCALE:GREGORIAN","METHOD:PUBLISH",...events,"END:VCALENDAR",""].join("\r\n");
}

export function downloadCalendarIcs(filename:string,ics:string){
  if(typeof document==="undefined")return;
  const blob=new Blob([ics],{type:"text/calendar;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
