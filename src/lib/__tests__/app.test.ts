import { describe, expect, it } from "vitest";

import {
  berlinToday,
  findChapterByPassageId,
  getPlanForDate,
  passageId,
  toUsfm,
} from "../schedule";
import { decodeApiError, encodeApiError, isValidPassageId, isValidVersionId, normalizeApiError } from "../youversion";
import { splitVerses } from "../youversion.server";

describe("schedule lookup", () => {
  it("returns the seeded seven chapters for 17 Aug 2026", () => {
    const day = getPlanForDate("2026-08-17");
    expect(day).toBeDefined();
    expect(day!.chapters).toHaveLength(7);
    expect(day!.chapters.map((c) => passageId(c.usfm, c.chapter))).toEqual([
      "GEN.42",
      "NEH.3",
      "PSA.79",
      "PRO.25",
      "ZEP.2",
      "LUK.7",
      "1CO.14",
    ]);
  });

  it("returns undefined for an unscheduled date", () => {
    expect(getPlanForDate("1999-01-01")).toBeUndefined();
  });

  it("finds a chapter by passage id", () => {
    expect(findChapterByPassageId("GEN.42")?.ref.book).toBe("Genesis");
    expect(findChapterByPassageId("GEN.99")).toBeUndefined();
  });

  it("computes the Berlin date", () => {
    expect(berlinToday(new Date("2026-08-16T23:30:00Z"))).toBe("2026-08-17");
  });
});

describe("USFM mapping", () => {
  it("maps the books used today", () => {
    expect(
      ["Genesis", "Nehemiah", "Psalm", "Proverbs", "Zephaniah", "Luke", "1 Corinthians"].map(toUsfm),
    ).toEqual(["GEN", "NEH", "PSA", "PRO", "ZEP", "LUK", "1CO"]);
  });

  it("rejects unknown books and invalid chapters", () => {
    expect(() => toUsfm("Melchizedek")).toThrow();
    expect(() => passageId("GEN", 0)).toThrow();
    expect(() => passageId("GENESIS", 1)).toThrow();
  });

  it("validates ids", () => {
    expect(isValidPassageId("1CO.14")).toBe(true);
    expect(isValidPassageId("GEN42")).toBe(false);
    expect(isValidVersionId("3034")).toBe(true);
    expect(isValidVersionId("abc")).toBe(false);
  });
});

describe("API error normalization", () => {
  it("maps HTTP statuses to kinds", () => {
    expect(normalizeApiError(401).kind).toBe("unauthorized");
    expect(normalizeApiError(404).kind).toBe("not_found");
    expect(normalizeApiError(429)).toMatchObject({ kind: "rate_limited", retryable: true });
    expect(normalizeApiError(503).kind).toBe("server_error");
    expect(normalizeApiError(408).kind).toBe("timeout");
    expect(normalizeApiError(null).kind).toBe("network");
  });

  it("round-trips through the RPC boundary", () => {
    const err = new Error(encodeApiError(normalizeApiError(429)));
    expect(decodeApiError(err).kind).toBe("rate_limited");
  });

  it("detects the missing key state", () => {
    const err = new Error("Connect YouVersion App Key in project secrets");
    expect(decodeApiError(err).kind).toBe("missing_key");
  });
});

describe("verse splitting", () => {
  it("splits inline numbered text", () => {
    const verses = splitVerses("1 In the beginning God created. 2 And the earth was formless.");
    expect(verses).toHaveLength(2);
    expect(verses[1]).toEqual({ number: "2", text: "And the earth was formless." });
  });
});
