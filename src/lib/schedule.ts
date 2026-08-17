/** Complete looping seven-track Bible reading plan. */
export type BookCode = string;

export type ChapterRef = {
  book: string;
  usfm: BookCode;
  chapter: number;
  track: string;
};

export type DayPlan = { date: string; chapters: ChapterRef[] };

type PlanBook = { book: string; usfm: string; chapters: number };
type Track = { track: string; books: PlanBook[] };

const b = (book: string, usfm: string, chapters: number): PlanBook => ({ book, usfm, chapters });

export const TRACKS: Track[] = [
  { track: "Law", books: [b("Genesis","GEN",50),b("Exodus","EXO",40),b("Leviticus","LEV",27),b("Numbers","NUM",36),b("Deuteronomy","DEU",34)] },
  { track: "History", books: [b("Joshua","JOS",24),b("Judges","JDG",21),b("Ruth","RUT",4),b("1 Samuel","1SA",31),b("2 Samuel","2SA",24),b("1 Kings","1KI",22),b("2 Kings","2KI",25),b("1 Chronicles","1CH",29),b("2 Chronicles","2CH",36),b("Ezra","EZR",10),b("Nehemiah","NEH",13),b("Esther","EST",10),b("Job","JOB",42)] },
  { track: "Psalms", books: [b("Psalms","PSA",150)] },
  { track: "Wisdom", books: [b("Proverbs","PRO",31),b("Ecclesiastes","ECC",12),b("Song of Songs","SNG",8)] },
  { track: "Prophets", books: [b("Isaiah","ISA",66),b("Jeremiah","JER",52),b("Lamentations","LAM",5),b("Ezekiel","EZK",48),b("Daniel","DAN",12),b("Hosea","HOS",14),b("Joel","JOL",3),b("Amos","AMO",9),b("Obadiah","OBA",1),b("Jonah","JON",4),b("Micah","MIC",7),b("Nahum","NAM",3),b("Habakkuk","HAB",3),b("Zephaniah","ZEP",3),b("Haggai","HAG",2),b("Zechariah","ZEC",14),b("Malachi","MAL",4)] },
  { track: "Gospels", books: [b("Matthew","MAT",28),b("Mark","MRK",16),b("Luke","LUK",24),b("John","JHN",21)] },
  { track: "Acts & Epistles", books: [b("Acts","ACT",28),b("Romans","ROM",16),b("1 Corinthians","1CO",16),b("2 Corinthians","2CO",13),b("Galatians","GAL",6),b("Ephesians","EPH",6),b("Philippians","PHP",4),b("Colossians","COL",4),b("1 Thessalonians","1TH",5),b("2 Thessalonians","2TH",3),b("1 Timothy","1TI",6),b("2 Timothy","2TI",4),b("Titus","TIT",3),b("Philemon","PHM",1),b("Hebrews","HEB",13),b("James","JAS",5),b("1 Peter","1PE",5),b("2 Peter","2PE",3),b("1 John","1JN",5),b("2 John","2JN",1),b("3 John","3JN",1),b("Jude","JUD",1),b("Revelation","REV",22)] },
];

export const USFM_BY_BOOK: Record<string,string> = Object.fromEntries(
  TRACKS.flatMap((t) => t.books.map((x) => [x.book, x.usfm])),
);
USFM_BY_BOOK["Psalm"] = "PSA";
USFM_BY_BOOK["Song of Solomon"] = "SNG";

export function toUsfm(book: string): string {
  const code = USFM_BY_BOOK[book.trim()];
  if (!code) throw new Error(`Unknown book name: ${book}`);
  return code;
}

export function passageId(usfm: string, chapter: number): string {
  if (!/^[1-3]?[A-Z]{2,3}$/.test(usfm)) throw new Error(`Invalid USFM book code: ${usfm}`);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) throw new Error(`Invalid chapter number: ${chapter}`);
  return `${usfm}.${chapter}`;
}

export function chapterLabel(ref: ChapterRef): string { return `${ref.book} ${ref.chapter}`; }

export const PLAN_ANCHOR = "2026-01-01";
const DAY = 86_400_000;

function dayIndex(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const t = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  const a = Date.UTC(2026, 0, 1);
  return Math.round((t - a) / DAY);
}

function chapterForTrack(track: Track, index: number): ChapterRef {
  const total = track.books.reduce((s,x) => s + x.chapters, 0);
  let offset = ((index % total) + total) % total;
  for (const book of track.books) {
    if (offset < book.chapters) return { book: book.book, usfm: book.usfm, chapter: offset + 1, track: track.track };
    offset -= book.chapters;
  }
  const first = track.books[0]!;
  return { book: first.book, usfm: first.usfm, chapter: 1, track: track.track };
}

export function getPlanForDate(date: string): DayPlan | undefined {
  const index = dayIndex(date);
  if (index === null || index < 0) return undefined;
  return { date, chapters: TRACKS.map((t) => chapterForTrack(t, index)) };
}

export function berlinToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year:"numeric", month:"2-digit", day:"2-digit" }).format(now);
}

export function formatBerlinDate(date: string): string {
  const [y,m,d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday:"long", day:"numeric", month:"long", year:"numeric", timeZone:"UTC" }).format(new Date(Date.UTC(y!, (m ?? 1)-1, d ?? 1)));
}

export function findChapterByPassageId(id: string): { date: string; ref: ChapterRef } | undefined {
  const m = /^([1-3]?[A-Z]{2,3})\.(\d{1,3})$/.exec(id);
  if (!m) return undefined;
  const book = TRACKS.flatMap((t) => t.books.map((x) => ({...x, track:t.track}))).find((x) => x.usfm === m[1]);
  const chapter = Number(m[2]);
  if (!book || chapter < 1 || chapter > book.chapters) return undefined;
  return { date: "", ref: { book: book.book, usfm: book.usfm, chapter, track: book.track } };
}
