import { describe, expect, it } from "vitest";
import { buildStudyCalendarIcs } from "../schedule-export";
import { getPlanForDate, passageId } from "../schedule";
import {
  DEFAULT_PERSONAL_PLAN, normalizePersonalPlan, personalReadingsForDate, scheduledChapters,
  type ReadingPlanChoice,
} from "../personal-plan";

const original: ReadingPlanChoice = {
  readingPlanMode: "original",
  chaptersPerDay: 7,
  activeTracks: ["Law", "History", "Psalms", "Wisdom", "Prophets", "Gospels", "Acts & Epistles"],
};

describe("independent reader-chosen plans", () => {
  const custom = {
    ...DEFAULT_PERSONAL_PLAN,
    name: "My weekday study",
    startDate: "2026-10-26",
    chaptersPerDay: 3,
    weekdays: [1, 2, 3, 4, 5],
    books: [{ usfm: "GEN", fromChapter: 49 }, { usfm: "MAT", fromChapter: 1 }],
    repeat: false,
  };

  it("preserves the original seven-track plan and its historical anchor", () => {
    const date = "2026-08-17";
    expect(scheduledChapters(date, original)).toEqual(getPlanForDate(date)?.chapters);
    expect(scheduledChapters(date, original).map(c => passageId(c.usfm, c.chapter))).toEqual([
      "GEN.42", "NEH.3", "PSA.79", "PRO.25", "ZEP.2", "LUK.7", "1CO.14",
    ]);
  });

  it("does not assign another person's plan until the reader explicitly chooses", () => {
    expect(scheduledChapters("2026-10-26", { ...original, readingPlanMode: "unselected" })).toEqual([]);
  });

  it("reads selected books in user order from each starting chapter", () => {
    expect(personalReadingsForDate("2026-10-26", custom).map(c => passageId(c.usfm, c.chapter)))
      .toEqual(["GEN.49", "GEN.50", "MAT.1"]);
    expect(personalReadingsForDate("2026-10-27", custom).map(c => passageId(c.usfm, c.chapter)))
      .toEqual(["MAT.2", "MAT.3", "MAT.4"]);
  });

  it("does not advance a user plan on unselected weekdays", () => {
    expect(personalReadingsForDate("2026-10-31", custom)).toEqual([]);
    expect(personalReadingsForDate("2026-11-01", custom)).toEqual([]);
    expect(personalReadingsForDate("2026-11-02", custom).map(c => passageId(c.usfm, c.chapter)))
      .toEqual(["MAT.14", "MAT.15", "MAT.16"]);
  });

  it("stops at the last chapter unless the reader requests repetition", () => {
    const last = { ...custom, chaptersPerDay: 10, books: [{ usfm: "PHM", fromChapter: 1 }], weekdays: [0,1,2,3,4,5,6] };
    expect(personalReadingsForDate("2026-10-26", last)).toHaveLength(1);
    expect(personalReadingsForDate("2026-10-27", last)).toHaveLength(0);
    expect(personalReadingsForDate("2026-10-27", { ...last, repeat: true })).toHaveLength(1); // no repeated chapter on the same day
  });

  it("validates user book choices and chapter bounds", () => {
    const normalized = normalizePersonalPlan({
      ...custom, chaptersPerDay: 100, weekdays: [-1,1,1,9],
      books: [{usfm:"GEN",fromChapter:900}, {usfm:"GEN",fromChapter:1}, {usfm:"NOPE",fromChapter:1}],
    });
    expect(normalized.chaptersPerDay).toBe(10);
    expect(normalized.weekdays).toEqual([1]);
    expect(normalized.books).toEqual([{usfm:"GEN",fromChapter:50}]);
  });

  it("exports selected dates and readings, never the original default by mistake", () => {
    const ics = buildStudyCalendarIcs({
      startDate: "2026-10-26", days: 7, time: "05:00", timezone: "Europe/Berlin",
      chaptersPerDay: 3, activeTracks: original.activeTracks,
      readingPlanMode: "personal", personalReadingPlan: custom,
    });
    expect(ics).toContain("Genesis 49");
    expect(ics).toContain("Matthew 1");
    expect(ics).not.toContain("20261031T050000");
    expect(ics).not.toContain("Nehemiah");
  });
});
