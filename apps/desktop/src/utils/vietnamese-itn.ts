/**
 * Client-side Vietnamese Inverse Text Normalization (ITN).
 * Converts spoken number words to digits, percentages, and dates.
 * e.g.
 *  - "Ba ba bốn năm sáu Không ba bốn bốn" -> "33456 0344"
 *  - "hai mươi ba" -> "23"
 *  - "năm mươi lăm phần trăm" -> "55%"
 *  - "một triệu hai trăm nghìn đồng" -> "1.200.000 đồng"
 */

const UNITS: Record<string, number> = {
  không: 0,
  linh: 0,
  lẻ: 0,
  một: 1,
  mốt: 1,
  hai: 2,
  ba: 3,
  bốn: 4,
  tư: 4,
  năm: 5,
  lăm: 5,
  sáu: 6,
  bảy: 7,
  bẩy: 7,
  tám: 8,
  chín: 9,
};

const DIGIT_WORDS: Record<string, string> = {
  không: "0",
  một: "1",
  hai: "2",
  ba: "3",
  bốn: "4",
  tư: "4",
  năm: "5",
  sáu: "6",
  bảy: "7",
  bẩy: "7",
  tám: "8",
  chín: "9",
};

const NUMBER_KEYWORDS = new Set([
  ...Object.keys(UNITS),
  "mười",
  "mươi",
  "chục",
  "trăm",
  "nghìn",
  "ngàn",
  "triệu",
  "tỷ",
]);

export function parseVietnameseNumberWords(words: string[]): number | null {
  if (!words.length) return null;

  let currentBillions = 0;
  let currentMillions = 0;
  let currentThousands = 0;
  let currentHundreds = 0;
  let currentVal = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();

    if (w === "tỷ") {
      const chunk =
        currentVal + currentHundreds + currentThousands + currentMillions || 1;
      currentBillions += chunk * 1_000_000_000;
      currentMillions = currentThousands = currentHundreds = currentVal = 0;
    } else if (w === "triệu") {
      const chunk = currentVal + currentHundreds + currentThousands || 1;
      currentMillions += chunk * 1_000_000;
      currentThousands = currentHundreds = currentVal = 0;
    } else if (w === "nghìn" || w === "ngàn") {
      const chunk = currentVal + currentHundreds || 1;
      currentThousands += chunk * 1_000;
      currentHundreds = currentVal = 0;
    } else if (w === "trăm") {
      const chunk = currentVal || 1;
      currentHundreds = chunk * 100;
      currentVal = 0;
    } else if (w === "mươi" || w === "chục") {
      const chunk = currentVal || 1;
      currentVal = chunk * 10;
    } else if (w === "mười") {
      currentVal += 10;
    } else if (w === "linh" || w === "lẻ") {
      // noop
    } else if (w in UNITS) {
      currentVal += UNITS[w];
    } else {
      return null;
    }
  }

  const total =
    currentBillions +
    currentMillions +
    currentThousands +
    currentHundreds +
    currentVal;
  return total;
}

export function formatNumberWithDots(n: number): string {
  if (n >= 10000) {
    return n.toLocaleString("vi-VN");
  }
  return String(n);
}

export function normalizeVietnameseNumbers(text: string): string {
  if (!text || !text.trim()) return text;

  let t = text;

  // 1. Percentages: "năm mươi lăm phần trăm" -> "55%"
  t = t.replace(
    /\b((?:(?:không|một|mốt|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín|mười|mươi|chục|trăm|linh|lẻ)\s+)+)phần trăm\b/gi,
    (match, numStr: string) => {
      const words = numStr.trim().split(/\s+/);
      const val = parseVietnameseNumberWords(words);
      return val !== null ? `${val}%` : match;
    },
  );
  t = t.replace(/(\d+)\s+phần trăm\b/gi, "$1%");

  // 2. Dates: "ngày mười lăm tháng tám năm hai nghìn..."
  t = t.replace(
    /\bngày\s+((?:không|mồng|mùng|một|mốt|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín|mười|mươi|chục|hai mươi|ba mươi)(?:\s+(?:một|mốt|hai|ba|bốn|tư|năm|lăm|sáu|bảy|bẩy|tám|chín))?)\b/gi,
    (match, dayStr: string) => {
      const words = dayStr.trim().split(/\s+/);
      const val = parseVietnameseNumberWords(words);
      return val !== null && val >= 1 && val <= 31 ? `ngày ${val}` : match;
    },
  );

  t = t.replace(
    /\btháng\s+((?:một|hai|ba|bốn|tư|năm|sáu|bảy|bẩy|tám|chín|mười|mười một|mười hai))\b/gi,
    (match, monthStr: string) => {
      const words = monthStr.trim().split(/\s+/);
      const val = parseVietnameseNumberWords(words);
      return val !== null && val >= 1 && val <= 12 ? `tháng ${val}` : match;
    },
  );

  t = t.replace(
    /\bnăm\s+((?:(?:một|hai)\s+nghìn(?:\s+(?:không|lẻ|linh|một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|mươi|trăm))*))\b/gi,
    (match, yearStr: string) => {
      const words = yearStr.trim().split(/\s+/);
      const val = parseVietnameseNumberWords(words);
      return val !== null && val >= 1900 && val <= 2100 ? `năm ${val}` : match;
    },
  );

  // 3. Spoken phone numbers / digit sequences (>= 2 single digits): "ba ba bốn năm sáu" -> "33456"
  const tokens = t.split(/\s+/);
  const outTokens: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    let j = i;
    const digits: string[] = [];
    while (j < tokens.length) {
      const cleanToken = tokens[j].toLowerCase().replace(/[^\w\s]/g, "");
      if (DIGIT_WORDS[cleanToken] !== undefined) {
        digits.push(DIGIT_WORDS[cleanToken]);
        j++;
      } else {
        break;
      }
    }
    if (digits.length >= 2) {
      let formattedDigits = digits.join("");
      const lastToken = tokens[j - 1];
      const punctMatch = lastToken.match(/([,.:;?!]+)$/);
      if (punctMatch) {
        formattedDigits += punctMatch[1];
      }
      outTokens.push(formattedDigits);
      i = j;
    } else {
      outTokens.push(tokens[i]);
      i++;
    }
  }
  t = outTokens.join(" ");

  // 4. General compound number spans (e.g. "hai mươi ba", "một trăm hai mươi nghìn")
  const words = t.split(/\s+/);
  const result: string[] = [];
  let wIdx = 0;
  while (wIdx < words.length) {
    const clean = words[wIdx].toLowerCase().replace(/[^\w\s]/g, "");
    if (NUMBER_KEYWORDS.has(clean)) {
      const span: string[] = [clean];
      const origSpan: string[] = [words[wIdx]];
      let nextIdx = wIdx + 1;
      while (nextIdx < words.length) {
        const nextClean = words[nextIdx].toLowerCase().replace(/[^\w\s]/g, "");
        if (NUMBER_KEYWORDS.has(nextClean)) {
          span.push(nextClean);
          origSpan.push(words[nextIdx]);
          nextIdx++;
        } else {
          break;
        }
      }

      if (span.length >= 2) {
        const val = parseVietnameseNumberWords(span);
        if (val !== null && val > 0) {
          let formatted = formatNumberWithDots(val);
          const lastOrig = origSpan[origSpan.length - 1];
          const punct = lastOrig.match(/([,.:;?!]+)$/);
          if (punct) {
            formatted += punct[1];
          }
          result.push(formatted);
          wIdx = nextIdx;
          continue;
        }
      }
    }
    result.push(words[wIdx]);
    wIdx++;
  }

  return result.join(" ");
}

/**
 * Chuẩn hóa khoảng trắng & định dạng khoảng cách dấu câu tự nhiên cho tiếng Việt.
 * Giữ nguyên dấu câu do mô hình (PhoVoice / Whisper) tự sinh, không tự ý chèn thêm dấu chấm câu.
 */
export function formatVietnamesePunctuation(text: string): string {
  if (!text) return "";

  // 1. Chuẩn hóa khoảng trắng & loại bỏ khoảng cách thừa
  let t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";

  // 2. Chuẩn hóa khoảng cách xung quanh dấu câu nếu có sẵn từ mô hình
  // Xóa khoảng trắng trước dấu câu: "xin chào , bạn" -> "xin chào, bạn"
  t = t.replace(/\s+([.,!?:;…])/g, "$1");
  // Thêm khoảng trắng sau dấu câu nếu liền kề chữ cái: "chào.bạn" -> "chào. bạn"
  t = t.replace(/([.,!?:;…])(?=[^\s.,!?:;…\d])/g, "$1 ");

  // 3. Dọn dẹp các dấu câu bị lặp (ví dụ ".." -> ".", ",," -> ",")
  t = t.replace(/([.,!?:;])\1+/g, "$1");

  // 4. Sửa lỗi dấu chấm ngắt câu sai trước chữ thường trong tiếng Việt
  // (ví dụ: "thủy, băng, kim. hỏa mộc" -> "thủy, băng, kim, hỏa mộc")
  t = t.replace(
    /\.\s+(?=[a-zàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ])/g,
    ", ",
  );

  // 5. Cụm từ liệt kê không thể kết thúc bằng dấu chấm
  t = t.replace(
    /(như là|bao gồm|gồm có|ví dụ như|cụ thể là|nghĩa là|tức là)\s*\.\s*$/gi,
    "$1,",
  );

  return t.trim();
}

/** Apply the same number, whitespace and punctuation cleanup everywhere a
 * transcript is persisted or rendered. Keeping this in one function prevents
 * realtime partials and final PhoVoice results from drifting apart. */
export function normalizeVietnameseTranscriptText(text: string): string {
  return formatVietnamesePunctuation(normalizeVietnameseNumbers(text));
}

/** Join transcript fragments without introducing spaces before punctuation or
 * preserving doubled whitespace from provider chunk boundaries. */
export function joinVietnameseTranscriptText(
  ...parts: Array<string | null | undefined>
): string {
  return normalizeVietnameseTranscriptText(
    parts.filter((part): part is string => Boolean(part?.trim())).join(" "),
  );
}

/** Remove text already present at the end of a committed transcript from a
 * provider's latest full hypothesis. Providers commonly resend the whole
 * sentence on every realtime update rather than a true delta. */
export function extractVietnameseTranscriptDelta(
  committedText: string,
  latestHypothesis: string,
): string {
  const committed = normalizeVietnameseTranscriptText(committedText);
  const latest = normalizeVietnameseTranscriptText(latestHypothesis);
  if (!latest || !committed) {
    return latest;
  }

  const canonicalize = (token: string) =>
    token.toLocaleLowerCase("vi").replace(/[.,!?;:…]+/g, "");
  const committedWords = committed
    .split(/\s+/)
    .map(canonicalize)
    .filter(Boolean);
  const latestTokens = latest.split(/\s+/);
  const latestWords = latestTokens.map(canonicalize).filter(Boolean);

  if (latestWords.join(" ") === committedWords.join(" ")) {
    return "";
  }

  const maxOverlap = Math.min(committedWords.length, latestWords.length);
  for (let overlap = maxOverlap; overlap >= 2; overlap--) {
    const committedSuffix = committedWords.slice(-overlap);
    const latestPrefix = latestWords.slice(0, overlap);
    if (committedSuffix.every((word, index) => word === latestPrefix[index])) {
      return normalizeVietnameseTranscriptText(
        latestTokens.slice(overlap).join(" "),
      );
    }
  }

  return latest;
}
