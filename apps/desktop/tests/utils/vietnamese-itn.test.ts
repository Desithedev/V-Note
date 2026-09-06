import { describe, expect, it } from "vitest";
import {
  extractVietnameseTranscriptDelta,
  joinVietnameseTranscriptText,
  normalizeVietnameseTranscriptText,
} from "@/utils/vietnamese-itn";

describe("Vietnamese transcript text normalization", () => {
  it("collapses provider whitespace and fixes punctuation spacing", () => {
    expect(normalizeVietnameseTranscriptText("  xin   chào  ,   bạn  . ")).toBe(
      "xin chào, bạn.",
    );
  });

  it("joins realtime chunks without doubled spaces", () => {
    expect(joinVietnameseTranscriptText("xin chào ", " ,  các bạn")).toBe(
      "xin chào, các bạn",
    );
  });

  it("does not invent punctuation that the provider did not return", () => {
    expect(normalizeVietnameseTranscriptText("xin chào các bạn")).toBe(
      "xin chào các bạn",
    );
  });

  it("does not append a repeated full realtime hypothesis", () => {
    expect(
      extractVietnameseTranscriptDelta(
        "xin chào các bạn",
        "xin  chào các bạn.",
      ),
    ).toBe("");
  });

  it("keeps only new words from an overlapping realtime hypothesis", () => {
    expect(
      extractVietnameseTranscriptDelta(
        "hôm nay chúng ta",
        "chúng ta kiểm tra realtime",
      ),
    ).toBe("kiểm tra realtime");
  });

  it("converts misplaced periods before lowercase words into commas", () => {
    expect(
      normalizeVietnameseTranscriptText(
        "thủy, băng, kim. hỏa mộc chỉ còn lại",
      ),
    ).toBe("thủy, băng, kim, hỏa mộc chỉ còn lại");
  });

  it("converts terminal periods on introductory list phrases into commas", () => {
    expect(
      normalizeVietnameseTranscriptText("với các con vật như là cá voi."),
    ).toBe("với các con vật như là cá voi.");
    expect(
      normalizeVietnameseTranscriptText("với các hệ như là."),
    ).toBe("với các hệ như là,");
  });
});
