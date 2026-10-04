import { DEFAULT_SETTINGS, type AppSettings } from "./app-state";
import { requireSupabase } from "./supabase";
import type { ChapterStudy, DailyReview } from "./study-state";

const SETTINGS_KEY="bible-study:settings:v1";
const PROGRESS_KEY="7cbs.progress.v1";
const NOTES_KEY="7cbs.notes.v1";
const CHAPTER_STUDY_KEY="bible-study:chapter-study:v1";
const DAILY_REVIEW_KEY="bible-study:daily-review:v1";

type StringStore=Record<string,string>;
type ProgressStatus="not_started"|"reading"|"complete";
type DbError={code?:string|null;message?:string|null;details?:string|null;hint?:string|null};

function readJson<T>(key:string,fallback:T):T{if(typeof window==="undefined")return fallback;try{return JSON.parse(window.localStorage.getItem(key)||"") as T}catch{return fallback}}
function writeJson<T>(key:string,value:T){if(typeof window!=="undefined")window.localStorage.setItem(key,JSON.stringify(value))}
function readSettings():AppSettings{return{...DEFAULT_SETTINGS,...readJson<Partial<AppSettings>>(SETTINGS_KEY,{})}}

/** New guided-study tables may lag behind an app deploy. Skip only schema-not-ready errors; never hide real auth/RLS/network failures. */
export function isOptionalSchemaMissing(error:DbError|null|undefined){
  if(!error)return false;
  const code=String(error.code??"").toUpperCase();
  const text=`${error.message??""} ${error.details??""} ${error.hint??""}`.toLowerCase();
  return code==="42P01"||code==="PGRST205"||code==="PGRST204"||text.includes("could not find the table")||text.includes("relation")&&text.includes("does not exist")||text.includes("schema cache")&&text.includes("not find");
}
function throwRequired(error:DbError|null|undefined){if(error)throw error}
function throwUnlessOptionalMissing(error:DbError|null|undefined){if(error&&!isOptionalSchemaMissing(error))throw error}

export async function getCloudUser(){const {data}=await requireSupabase().auth.getUser();return data.user??null}
export const OTP_RESEND_COOLDOWN_SECONDS=60;
export function normalizeEmail(email:string){return email.trim().toLowerCase()}
export function isValidEmail(email:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))}
/** Length of the email code the auth provider actually sends (observed: 8 digits). Single source of truth for UI, validation and tests. */
export const OTP_LENGTH=8;
/** Strip spaces, hyphens and other separators; keep digits as a string so leading zeroes survive. Never shortens below OTP_LENGTH. */
export function normalizeOtp(code:string){return code.replace(/\D/g,"").slice(0,OTP_LENGTH)}
export function isCompleteOtp(code:string){return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code)}
/** Request an email sign-in code. No redirect URL: the session is created only by verifyEmailCode in this same app context. */
export async function requestEmailCode(email:string){const clean=normalizeEmail(email);if(!isValidEmail(clean))throw new Error("Enter a valid email address.");const {error}=await requireSupabase().auth.signInWithOtp({email:clean,options:{shouldCreateUser:true}});if(error)throw new Error(otpErrorMessage(error))}
export async function verifyEmailCode(email:string,code:string){const token=normalizeOtp(code);if(!isCompleteOtp(token))throw new Error(`Enter all ${OTP_LENGTH} digits of the code from your email.`);const {data,error}=await requireSupabase().auth.verifyOtp({email:normalizeEmail(email),token,type:"email"});if(error||!data.session)throw new Error(otpErrorMessage(error));return data.session}
export function otpErrorMessage(error:{message?:string|null|undefined;status?:number|undefined;code?:string|undefined}|null|undefined){const m=String(error?.message??"").toLowerCase();const c=String(error?.code??"");if(error?.status===429||c.includes("rate_limit")||m.includes("rate limit")||m.includes("security purposes"))return"Too many attempts. Please wait a minute before trying again.";if(c==="otp_expired"||m.includes("expired")||m.includes("invalid"))return"That code is invalid or has expired. Request a new code and try again.";return error?.message||"Sign-in failed. Please try again."}
export async function signOutCloud(){const {error}=await requireSupabase().auth.signOut();if(error)throw error}

export async function pushLocalStudyData(){
  const sb=requireSupabase();const user=await getCloudUser();if(!user)throw new Error("Sign in before syncing.");const now=new Date().toISOString();
  const {error:settingsError}=await sb.from("user_settings").upsert({user_id:user.id,settings:readSettings(),updated_at:now});throwRequired(settingsError);

  const progress=readJson<StringStore>(PROGRESS_KEY,{});const progressRows=Object.entries(progress).flatMap(([key,status])=>{const split=key.indexOf("|");if(split<1)return[];const reading_date=key.slice(0,split);const passage=key.slice(split+1);if(!/^\d{4}-\d{2}-\d{2}$/.test(reading_date)||!/^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(passage)||!["not_started","reading","complete"].includes(status))return[];return[{user_id:user.id,reading_date,passage,status:status as ProgressStatus,updated_at:now}]});
  if(progressRows.length){const {error}=await sb.from("reading_progress").upsert(progressRows,{onConflict:"user_id,reading_date,passage"});throwRequired(error)}

  const notes=readJson<StringStore>(NOTES_KEY,{});const noteRows=Object.entries(notes).filter(([passage])=>/^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(passage)).map(([passage,note])=>({user_id:user.id,passage,note,updated_at:now}));
  if(noteRows.length){const {error}=await sb.from("chapter_notes").upsert(noteRows,{onConflict:"user_id,passage"});throwRequired(error)}

  // Optional V2 study-memory schema. Local-first data remains safe if this migration has not reached production yet.
  const chapterStudies=readJson<Record<string,ChapterStudy>>(CHAPTER_STUDY_KEY,{});const studyRows=Object.values(chapterStudies).filter(s=>/^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(s.passage)).map(s=>({user_id:user.id,passage:s.passage,intention:s.intention??null,reflections:s.reflections,prayer:s.prayer??null,completed_at:s.completedAt??null,updated_at:s.updatedAt||now}));
  if(studyRows.length){const {error}=await sb.from("chapter_studies").upsert(studyRows,{onConflict:"user_id,passage"});throwUnlessOptionalMissing(error)}

  const reviews=readJson<Record<string,DailyReview>>(DAILY_REVIEW_KEY,{});const reviewRows=Object.values(reviews).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)).map(r=>({user_id:user.id,review_date:r.date,gratitude:r.gratitude??null,takeaway:r.takeaway??null,prayer:r.prayer??null,updated_at:r.updatedAt||now}));
  if(reviewRows.length){const {error}=await sb.from("daily_reviews").upsert(reviewRows,{onConflict:"user_id,review_date"});throwUnlessOptionalMissing(error)}
}

export async function pullCloudStudyData(){
  const sb=requireSupabase();const user=await getCloudUser();if(!user)throw new Error("Sign in before syncing.");
  // Core tables are required and retain the original sync contract.
  const [settingsRes,progressRes,notesRes]=await Promise.all([
    sb.from("user_settings").select("settings").eq("user_id",user.id).maybeSingle(),
    sb.from("reading_progress").select("reading_date,passage,status").eq("user_id",user.id),
    sb.from("chapter_notes").select("passage,note").eq("user_id",user.id),
  ]);
  throwRequired(settingsRes.error);throwRequired(progressRes.error);throwRequired(notesRes.error);

  if(settingsRes.data?.settings)writeJson(SETTINGS_KEY,{...DEFAULT_SETTINGS,...(settingsRes.data.settings as Partial<AppSettings>)});
  const localProgress=readJson<StringStore>(PROGRESS_KEY,{});for(const row of progressRes.data??[])localProgress[`${row.reading_date}|${row.passage}`]=row.status;writeJson(PROGRESS_KEY,localProgress);
  const localNotes=readJson<StringStore>(NOTES_KEY,{});for(const row of notesRes.data??[])localNotes[row.passage]=row.note;writeJson(NOTES_KEY,localNotes);

  // Pull optional V2 tables independently so an unapplied migration cannot break otherwise-valid core sync.
  const studiesRes=await sb.from("chapter_studies").select("passage,intention,reflections,prayer,completed_at,updated_at").eq("user_id",user.id);
  if(studiesRes.error){throwUnlessOptionalMissing(studiesRes.error)}else{
    const localStudies=readJson<Record<string,ChapterStudy>>(CHAPTER_STUDY_KEY,{});for(const row of studiesRes.data??[])localStudies[row.passage]={passage:row.passage,intention:row.intention??undefined,reflections:(row.reflections??{}) as ChapterStudy["reflections"],prayer:row.prayer??undefined,completedAt:row.completed_at??undefined,updatedAt:row.updated_at};writeJson(CHAPTER_STUDY_KEY,localStudies);
  }
  const reviewsRes=await sb.from("daily_reviews").select("review_date,gratitude,takeaway,prayer,updated_at").eq("user_id",user.id);
  if(reviewsRes.error){throwUnlessOptionalMissing(reviewsRes.error)}else{
    const localReviews=readJson<Record<string,DailyReview>>(DAILY_REVIEW_KEY,{});for(const row of reviewsRes.data??[]){const date=row.review_date;localReviews[date]={date,gratitude:row.gratitude??undefined,takeaway:row.takeaway??undefined,prayer:row.prayer??undefined,updatedAt:row.updated_at}}writeJson(DAILY_REVIEW_KEY,localReviews);
  }
}

export async function syncStudyData(){await pushLocalStudyData();await pullCloudStudyData()}
