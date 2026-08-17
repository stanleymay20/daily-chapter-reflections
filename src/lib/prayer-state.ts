export type PersonalPrayer = {
  id: string;
  text: string;
  createdAt: string;
};

export type PrayerStatus = {
  answeredAt?: string | undefined;
  answerNote?: string | undefined;
  updatedAt: string;
};

const PERSONAL_KEY="bible-study:personal-prayers:v1";
const STATUS_KEY="bible-study:prayer-status:v1";

function read<T>(key:string,fallback:T):T{if(typeof window==="undefined")return fallback;try{return JSON.parse(localStorage.getItem(key)||"") as T}catch{return fallback}}
function write<T>(key:string,value:T){if(typeof window!=="undefined")localStorage.setItem(key,JSON.stringify(value))}

export function loadPersonalPrayers(){return read<PersonalPrayer[]>(PERSONAL_KEY,[]).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
export function addPersonalPrayer(text:string){const clean=text.trim();if(!clean)return null;const row:PersonalPrayer={id:`personal:${Date.now()}-${Math.random().toString(36).slice(2,8)}`,text:clean,createdAt:new Date().toISOString()};write(PERSONAL_KEY,[row,...loadPersonalPrayers()]);return row}
export function deletePersonalPrayer(id:string){write(PERSONAL_KEY,loadPersonalPrayers().filter(p=>p.id!==id));const statuses=loadPrayerStatuses();delete statuses[id];write(STATUS_KEY,statuses)}
export function loadPrayerStatuses(){return read<Record<string,PrayerStatus>>(STATUS_KEY,{})}
export function setPrayerAnswered(id:string,answered:boolean,answerNote?:string){const rows=loadPrayerStatuses();rows[id]={answeredAt:answered?new Date().toISOString():undefined,answerNote:answered?(answerNote?.trim()||rows[id]?.answerNote):undefined,updatedAt:new Date().toISOString()};write(STATUS_KEY,rows);return rows[id]!}
export function isPrayerAnswered(status?:PrayerStatus){return Boolean(status?.answeredAt)}
