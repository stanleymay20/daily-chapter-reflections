export const LOCAL_STUDY_KEYS=[
  "bible-study:settings:v1",
  "bible-study:saved-verses:v1",
  "bible-study:chapter-study:v1",
  "bible-study:daily-review:v1",
  "bible-study:personal-prayers:v1",
  "bible-study:prayer-status:v1",
  "7cbs.progress.v1",
  "7cbs.notes.v1",
  "7cbs.selected-version",
] as const;

export function exportLocalStudyData(){
  const data:Record<string,unknown>={exportedAt:new Date().toISOString(),schema:"daily-scripture-companion-export-v1"};
  if(typeof window==="undefined")return data;
  for(const key of LOCAL_STUDY_KEYS){const raw=localStorage.getItem(key);if(raw===null)continue;try{data[key]=JSON.parse(raw)}catch{data[key]=raw}}
  return data;
}

export function downloadStudyData(){
  if(typeof document==="undefined")return;
  const blob=new Blob([JSON.stringify(exportLocalStudyData(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`bible-study-export-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function clearLocalStudyData(){
  if(typeof window==="undefined")return;
  for(const key of LOCAL_STUDY_KEYS)localStorage.removeItem(key);
}
