// Keep each reading turn small, including reviews created before the shorter prompt.
// Split at sentence/word boundaries and preserve Tamil combining characters.
export function reviewReadingParts(text: string, language: "ta" | "zh"): string[] {
  const limit = language === "zh" ? 90 : 180;
  const graphemes = new Intl.Segmenter(language, { granularity: "grapheme" });
  const words = new Intl.Segmenter(language, { granularity: "word" });
  const sentences = new Intl.Segmenter(language, { granularity: "sentence" });
  const parts: string[] = [];
  for (const sentence of sentences.segment(text.trim())) {
    let part = "";
    let size = 0;
    for (const word of words.segment(sentence.segment)) {
      const units = Array.from(graphemes.segment(word.segment), (item) => item.segment);
      if (size && size + units.length > limit) {
        if (part.trim()) parts.push(part.trim());
        part = "";
        size = 0;
      }
      for (const unit of units) {
        if (size === limit) {
          if (part.trim()) parts.push(part.trim());
          part = "";
          size = 0;
        }
        part += unit;
        size++;
      }
    }
    if (part.trim()) parts.push(part.trim());
  }
  return parts;
}
