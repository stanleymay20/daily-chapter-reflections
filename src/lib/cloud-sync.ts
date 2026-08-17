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

function readJson<T>(key:string,fallback:T):T{if(typeof window==="undefined")return fallback;try{return JSON.parse(window.localStorage.getItem(key)||"") as T}catch{return fallback}}
function writeJson<T>(key:string,value:T){if(typeof window!=="undefined")window.localStorage.setItem(key,JSON.stringify(value))}
function readSettings():AppSettings{return{...DEFAULT_SETTINGS,...readJson<Partial<AppSettings>>(SETTINGS_KEY,{})}}

export async function getCloudUser(){const {data}=await requireSupabase().auth.getUser();return data.user??null}
export async function sendSignInLink(email:string){const sb=requireSupabase();const redirect=typeof window!=="undefined"?window.location.origin+"/settings":null;const credentials=redirect?{email,options:{emailRedirectTo:redirect}}:{email};const {error}=await sb.auth.signInWithOtp(credentials);if(error)throw error}
export async function signOutCloud(){const {error}=await requireSupabase().auth.signOut();if(error)throw error}

export async function pushLocalStudyData(){
  const sb=requireSupabase();const user=await getCloudUser();if(!user)throw new Error("Sign in before syncing.");const now=new Date().toISOString();
  const {error:settingsError}=await sb.from("user_settings").upsert({user_id:user.id,settings:readSettings(),updated_at:now});if(settingsError)throw settingsError;

  const progress=readJson<StringStore>(PROGRESS_KEY,{});const progressRows=Object.entries(progress).flatMap(([key,status])=>{const split=key.indexOf("|");if(split<1)return[];const reading_date=key.slice(0,split);const passage=key.slice(split+1);if(!/^\d{4}-\d{2}-\d{2}$/.test(reading_date)||!/^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(passage)||!["not_started","reading","complete"].includes(status))return[];return[{user_id:user.id,reading_date,passage,status:status as ProgressStatus,updated_at:now}]});
  if(progressRows.length){const {error}=await sb.from("reading_progress").upsert(progressRows,{onConflict:"user_id,reading_date,passage"});if(error)throw error}

  const notes=readJson<StringStore>(NOTES_KEY,{});const noteRows=Object.entries(notes).filter(([passage])=>/^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(passage)).map(([passage,note])=>({user_id:user.id,passage,note,updated_at:now}));
  if(noteRows.length){const {error}=await sb.from("chapter_notes").upsert(noteRows,{onConflict:"user_id,passage"});if(error)throw error}

  const chapterStudies=readJson<Record<string,ChapterStudy>>(CHAPTER_STUDY_KEY,{});const studyRows=Object.values(chapterStudies).filter(s=>/^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(s.passage)).map(s=>({user_id:user.id,passage:s.passage,intention:s.intention??null,reflections:s.reflections,prayer:s.prayer??null,completed_at:s.completedAt??null,updated_at:s.updatedAt||now}));
  if(studyRows.length){const {error}=await sb.from("chapter_studies").upsert(studyRows,{onConflict:"user_id,passage"});if(error)throw error}

  const reviews=readJson<Record<string,DailyReview>>(DAILY_REVIEW_KEY,{});const reviewRows=Object.values(reviews).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)).map(r=>({user_id:user.id,review_date:r.date,gratitude:r.gratitude??null,takeaway:r.takeaway??null,prayer:r.prayer??null,updated_at:r.updatedAt||now}));
  if(reviewRows.length){const {error}=await sb.from("daily_reviews").upsert(reviewRows,{onConflict:"user_id,review_date"});if(error)throw error}
}

export async function pullCloudStudyData(){
  const sb=requireSupabase();const user=await getCloudUser();if(!user)throw new Error("Sign in before syncing.");
  const [settingsRes,progressRes,notesRes,studiesRes,reviewsRes]=await Promise.all([
    sb.from("user_settings").select("settings").eq("user_id",user.id).maybeSingle(),
    sb.from("reading_progress").select("reading_date,passage,status").eq("user_id",user.id),
    sb.from("chapter_notes").select("passage,note").eq("user_id",user.id),
    sb.from("chapter_studies").select("passage,intention,reflections,prayer,completed_at,updated_at").eq("user_id",user.id),
    sb.from("daily_reviews").select("review_date,gratitude,takeaway,prayer,updated_at").eq("user_id",user.id),
  ]);
  for(const res of [settingsRes,progressRes,notesRes,studiesRes,reviewsRes])if(res.error)throw res.error;

  if(settingsRes.data?.settings)writeJson(SETTINGS_KEY,{...DEFAULT_SETTINGS,...(settingsRes.data.settings as Partial<AppSettings>)});
  const localProgress=readJson<StringStore>(PROGRESS_KEY,{});for(const row of progressRes.data??[])localProgress[`${row.reading_date}|${row.passage}`]=row.status;writeJson(PROGRESS_KEY,localProgress);
  const localNotes=readJson<StringStore>(NOTES_KEY,{});for(const row of notesRes.data??[])localNotes[row.passage]=row.note;writeJson(NOTES_KEY,localNotes);

  const localStudies=readJson<Record<string,ChapterStudy>>(CHAPTER_STUDY_KEY,{});for(const row of studiesRes.data??[])localStudies[row.passage]={passage:row.passage,intention:row.intention??undefined,reflections:(row.reflections??{}) as ChapterStudy["reflections"],prayer:row.prayer??undefined,completedAt:row.completed_at??undefined,updatedAt:row.updated_at};writeJson(CHAPTER_STUDY_KEY,localStudies);
  const localReviews=readJson<Record<string,DailyReview>>(DAILY_REVIEW_KEY,{});for(const row of reviewsRes.data??[]){const date=row.review_date;localReviews[date]={date,gratitude:row.gratitude??undefined,takeaway:row.takeaway??undefined,prayer:row.prayer??undefined,updatedAt:row.updated_at}}writeJson(DAILY_REVIEW_KEY,localReviews);
}

export async function syncStudyData(){await pushLocalStudyData();await pullCloudStudyData()}
