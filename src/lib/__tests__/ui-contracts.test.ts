import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

describe("UI contracts", () => {
  it("primary navigation stays at four thumb-sized destinations", () => {
    const nav = src("../../components/AppNav.tsx");
    expect((nav.match(/\{to:"/g) ?? []).length).toBe(4);
    expect(nav).toContain("min-h-14");
    expect(nav).toContain("safe-area-inset-bottom");
    expect(nav).toContain('aria-current={active?"page":undefined}');
  });

  it("theme setting is wired to real dark and sepia tokens", () => {
    const css = src("../../styles.css");
    expect(css).toContain('html[data-theme="dark"]');
    expect(css).toContain('html[data-theme="sepia"]');
    expect(css).toContain('html[data-theme="system"]');
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain(":focus-visible");
  });

  it("reader keeps Scripture primary with AI clearly labeled", () => {
    const reader = src("../../routes/read.$passage.tsx");
    expect(reader).toContain("AI-created interpretation · not Scripture");
    expect(reader).toContain("Source: YouVersion Platform");
    expect(reader).toContain('aria-label="Chapter navigation"');
    expect(reader.indexOf("Before you read")).toBeGreaterThan(reader.indexOf('stage==="read"?'));
  });

  it("sign-in copy never mentions magic links", () => {
    for (const p of ["../../components/EmailCodeSignIn.tsx", "../../routes/settings.tsx", "../../routes/community.tsx"]) {
      expect(src(p).toLowerCase()).not.toMatch(/magic link|email link|sign-in link/);
    }
  });
});
