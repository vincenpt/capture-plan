import { describe, expect, it } from "bun:test";
import {
  COMPACT_DATE_PATTERN,
  DAY_ONLY_PATTERN,
  FLAT_DATE_PATTERN,
  isCompactDateDir,
  isCompactDateFile,
  isDayOnlyDir,
  isDayOnlyFile,
  isFlatDateDir,
  isFlatDateFile,
  isNumNameDir,
  isNumNameFile,
  isPlanDir,
  isYearDir,
  NUM_NAME_PATTERN,
  PLAN_DIR_PATTERN,
  YEAR_PATTERN,
} from "../shared.ts";

describe("PLAN_DIR_PATTERN", () => {
  it("matches 3-digit counter with slug", () => {
    expect(PLAN_DIR_PATTERN.test("001-my-plan")).toBe(true);
  });

  it("matches 4-digit counter with slug", () => {
    expect(PLAN_DIR_PATTERN.test("0001-refactor")).toBe(true);
  });

  it("captures counter and slug groups", () => {
    const m = "042-auth-fix".match(PLAN_DIR_PATTERN);
    expect(m?.[1]).toBe("042");
    expect(m?.[2]).toBe("auth-fix");
  });

  it("rejects 2-digit counter", () => {
    expect(PLAN_DIR_PATTERN.test("01-short")).toBe(false);
  });

  it("rejects counter without slug", () => {
    expect(PLAN_DIR_PATTERN.test("001")).toBe(false);
  });

  it("rejects plain text", () => {
    expect(PLAN_DIR_PATTERN.test("my-plan")).toBe(false);
  });
});

describe("YEAR_PATTERN", () => {
  it("matches four-digit year", () => {
    expect(YEAR_PATTERN.test("2026")).toBe(true);
  });

  it("rejects three digits", () => {
    expect(YEAR_PATTERN.test("202")).toBe(false);
  });

  it("rejects five digits", () => {
    expect(YEAR_PATTERN.test("20260")).toBe(false);
  });

  it("rejects letters", () => {
    expect(YEAR_PATTERN.test("abcd")).toBe(false);
  });
});

describe("FLAT_DATE_PATTERN", () => {
  it("matches YYYY-MM-DD", () => {
    expect(FLAT_DATE_PATTERN.test("2026-04-03")).toBe(true);
  });

  it("rejects single-digit month", () => {
    expect(FLAT_DATE_PATTERN.test("2026-4-03")).toBe(false);
  });

  it("rejects compact MM-DD", () => {
    expect(FLAT_DATE_PATTERN.test("04-03")).toBe(false);
  });
});

describe("COMPACT_DATE_PATTERN", () => {
  it("matches MM-DD", () => {
    expect(COMPACT_DATE_PATTERN.test("04-03")).toBe(true);
  });

  it("rejects single-digit parts", () => {
    expect(COMPACT_DATE_PATTERN.test("4-3")).toBe(false);
  });

  it("rejects full date", () => {
    expect(COMPACT_DATE_PATTERN.test("2026-04-03")).toBe(false);
  });
});

describe("NUM_NAME_PATTERN", () => {
  it("matches month name entry", () => {
    expect(NUM_NAME_PATTERN.test("04-April")).toBe(true);
  });

  it("matches day name entry", () => {
    expect(NUM_NAME_PATTERN.test("03-Friday")).toBe(true);
  });

  it("rejects lowercase name", () => {
    expect(NUM_NAME_PATTERN.test("04-april")).toBe(false);
  });

  it("rejects single-digit prefix", () => {
    expect(NUM_NAME_PATTERN.test("4-April")).toBe(false);
  });
});

describe("DAY_ONLY_PATTERN", () => {
  it("matches two-digit day", () => {
    expect(DAY_ONLY_PATTERN.test("03")).toBe(true);
  });

  it("rejects single digit", () => {
    expect(DAY_ONLY_PATTERN.test("3")).toBe(false);
  });

  it("rejects three digits", () => {
    expect(DAY_ONLY_PATTERN.test("003")).toBe(false);
  });
});

describe("isPlanDir", () => {
  it("returns true for valid plan dir", () => {
    expect(isPlanDir("001-my-plan")).toBe(true);
  });

  it("returns false for non-plan dir", () => {
    expect(isPlanDir("my-plan")).toBe(false);
  });
});

describe("isYearDir", () => {
  it("returns true for year", () => {
    expect(isYearDir("2026")).toBe(true);
  });

  it("returns false for non-year", () => {
    expect(isYearDir("abc")).toBe(false);
  });
});

describe("isFlatDateDir", () => {
  it("returns true for flat date", () => {
    expect(isFlatDateDir("2026-04-03")).toBe(true);
  });

  it("returns false for compact date", () => {
    expect(isFlatDateDir("04-03")).toBe(false);
  });
});

describe("isCompactDateDir", () => {
  it("returns true for compact date", () => {
    expect(isCompactDateDir("04-03")).toBe(true);
  });

  it("returns false for flat date", () => {
    expect(isCompactDateDir("2026-04-03")).toBe(false);
  });
});

describe("isNumNameDir", () => {
  it("returns true for month name", () => {
    expect(isNumNameDir("04-April")).toBe(true);
  });

  it("returns false for compact date", () => {
    expect(isNumNameDir("04-03")).toBe(false);
  });
});

describe("isDayOnlyDir", () => {
  it("returns true for two-digit day", () => {
    expect(isDayOnlyDir("03")).toBe(true);
  });

  it("returns false for three digits", () => {
    expect(isDayOnlyDir("003")).toBe(false);
  });
});

describe("isFlatDateFile", () => {
  it("matches YYYY-MM-DD.md", () => {
    expect(isFlatDateFile("2026-04-03.md")).toBe(true);
  });

  it("rejects without .md extension", () => {
    expect(isFlatDateFile("2026-04-03")).toBe(false);
  });

  it("rejects .txt extension", () => {
    expect(isFlatDateFile("2026-04-03.txt")).toBe(false);
  });
});

describe("isCompactDateFile", () => {
  it("matches MM-DD.md", () => {
    expect(isCompactDateFile("04-03.md")).toBe(true);
  });

  it("rejects without extension", () => {
    expect(isCompactDateFile("04-03")).toBe(false);
  });
});

describe("isNumNameFile", () => {
  it("matches NN-Name.md", () => {
    expect(isNumNameFile("04-April.md")).toBe(true);
  });

  it("matches day name file", () => {
    expect(isNumNameFile("03-Friday.md")).toBe(true);
  });

  it("rejects without extension", () => {
    expect(isNumNameFile("04-April")).toBe(false);
  });
});

describe("isDayOnlyFile", () => {
  it("matches DD.md", () => {
    expect(isDayOnlyFile("03.md")).toBe(true);
  });

  it("rejects without extension", () => {
    expect(isDayOnlyFile("03")).toBe(false);
  });

  it("rejects three-digit file", () => {
    expect(isDayOnlyFile("003.md")).toBe(false);
  });
});
