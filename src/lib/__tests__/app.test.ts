import { describe, expect, it } from "vitest";
import { berlinToday, findChapterByPassageId, getPlanForDate, passageId, toUsfm } from "../schedule";
import { decodeApiError, encodeApiError, isValidPassageId, isValidVersionId, normalizeApiError } from "../youversion";
import { splitVerses } from "../youversion.server";
import { readingWidthClass, safeShareText } from "../app-state";
import { estimateMinutes, nextStudyStep, summarizeOwnStudy } from "../study-state";

const ids=(date:string)=>getPlanForDate(date)!.chapters.map(c=>passageId(c.usfm,c.chapter));

describe("looping schedule",()=>{
  it("anchors 2026-01-01",()=>expect(ids("2026-01-01")).toEqual(["GEN.1","JOS.1","PSA.1","PRO.1","ISA.1","MAT.1","ACT.1"]));
  it("matches 17 Aug 2026",()=>expect(ids("2026-08-17")).toEqual(["GEN.42","NEH.3","PSA.79","PRO.25","ZEP.2","LUK.7","1CO.14"]));
  it("matches boundary samples",()=>{expect(ids("2026-02-20")[0]).toBe("EXO.1");expect(ids("2026-05-31")[2]).toBe("PSA.1");expect(ids("2026-12-31")).toEqual(["DEU.25","1SA.25","PSA.65","PRO.8","JER.49","MAT.9","ACT.23"])});
  it("continues after 2026",()=>expect(ids("2027-01-01")).toEqual(["DEU.26","1SA.26","PSA.66","PRO.9","JER.50","MAT.10","ACT.24"]));
  it("returns undefined before the anchor",()=>expect(getPlanForDate("1999-01-01")).toBeUndefined());
  it("finds any valid chapter by passage id",()=>{expect(findChapterByPassageId("GEN.42")?.ref.book).toBe("Genesis");expect(findChapterByPassageId("GEN.99")).toBeUndefined()});
  it("computes the Berlin date",()=>expect(berlinToday(new Date("2026-08-16T23:30:00Z"))).toBe("2026-08-17"));
});

describe("USFM mapping",()=>{
  it("maps representative books",()=>expect(["Genesis","Nehemiah","Psalm","Proverbs","Zephaniah","Luke","1 Corinthians"].map(toUsfm)).toEqual(["GEN","NEH","PSA","PRO","ZEP","LUK","1CO"]));
  it("rejects invalid values",()=>{expect(()=>toUsfm("Melchizedek")).toThrow();expect(()=>passageId("GEN",0)).toThrow();expect(()=>passageId("GENESIS",1)).toThrow()});
  it("validates ids",()=>{expect(isValidPassageId("1CO.14")).toBe(true);expect(isValidPassageId("GEN42")).toBe(false);expect(isValidVersionId("3034")).toBe(true);expect(isValidVersionId("abc")).toBe(false)});
});

describe("study experience logic",()=>{
  it("estimates study time by mode",()=>{expect(estimateMinutes(7,"read")).toBe(35);expect(estimateMinutes(7,"standard")).toBe(126);expect(estimateMinutes(1,"deep")).toBe(32)});
  it("advances through the guided study flow",()=>{expect(nextStudyStep("prepare")).toBe("read");expect(nextStudyStep("reflect")).toBe("pray");expect(nextStudyStep("review")).toBe("review")});
  it("summarizes only user-created study state",()=>expect(summarizeOwnStudy([{passage:"GEN.1",reflections:{observation:"x"},prayer:"p",completedAt:"now",updatedAt:"now"}])).toEqual({completed:1,notes:1,prayers:1}));
  it("maps reader width settings",()=>{expect(readingWidthClass("narrow")).toBe("max-w-xl");expect(readingWidthClass("wide")).toBe("max-w-4xl")});
});

describe("sharing safety",()=>{it("limits licensed excerpts",()=>{const out=safeShareText("Genesis 42:1","x".repeat(400),180);expect(out.length).toBeLessThanOrEqual(200);expect(out).toContain("Genesis 42:1");expect(out.endsWith("…")).toBe(true)})});

describe("API error normalization",()=>{
  it("maps HTTP statuses to kinds",()=>{expect(normalizeApiError(401).kind).toBe("unauthorized");expect(normalizeApiError(404).kind).toBe("not_found");expect(normalizeApiError(429)).toMatchObject({kind:"rate_limited",retryable:true});expect(normalizeApiError(503).kind).toBe("server_error");expect(normalizeApiError(408).kind).toBe("timeout");expect(normalizeApiError(null).kind).toBe("network")});
  it("round-trips through RPC",()=>{const err=new Error(encodeApiError(normalizeApiError(429)));expect(decodeApiError(err).kind).toBe("rate_limited")});
  it("detects missing key",()=>{const err=new Error("Connect YouVersion App Key in project secrets");expect(decodeApiError(err).kind).toBe("missing_key")});
});

describe("verse splitting",()=>{it("splits numbered text",()=>{const verses=splitVerses("1 In the beginning God created. 2 And the earth was formless.");expect(verses).toHaveLength(2);expect(verses[1]).toEqual({number:"2",text:"And the earth was formless."})})});
