import { describe, expect, it } from "vitest";

import { studyGuideHash, visualStudyGuide } from "../study-guide";

describe("study guide image identity", () => {
  it("creates a stable hash for the same normalized visual guide", async () => {
    const first = visualStudyGuide({
      summary: "  A chapter summary.  ",
      eventSequence: [" First event ", "Second event"],
      visualTimeline: ["Beginning", "End"],
      relationships: ["A helps B"],
      placeNotes: ["A named place"],
    });
    const second = visualStudyGuide({
      summary: "A chapter summary.",
      eventSequence: ["First event", "Second event"],
      visualTimeline: ["Beginning", "End"],
      relationships: ["A helps B"],
      placeNotes: ["A named place"],
    });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await expect(studyGuideHash(first!)).resolves.toBe(await studyGuideHash(second!));
  });

  it("changes identity when grounded event content changes", async () => {
    const first = visualStudyGuide({ summary: "Summary", eventSequence: ["Event one"] });
    const second = visualStudyGuide({ summary: "Summary", eventSequence: ["Event two"] });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    await expect(studyGuideHash(first!)).resolves.not.toBe(await studyGuideHash(second!));
  });

  it("rejects an incomplete guide instead of allowing ungrounded image generation", () => {
    expect(visualStudyGuide({ summary: "Summary", eventSequence: [] })).toBeNull();
    expect(visualStudyGuide({ summary: "", eventSequence: ["Event"] })).toBeNull();
    expect(visualStudyGuide(null)).toBeNull();
  });
});
