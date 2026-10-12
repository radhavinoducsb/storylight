"use client";

import {parseLessoncraftPackage} from '../lib/lessoncraft-import';
import ExtractionReviewInbox from './extraction-review-inbox';
import {readArchiveOCR} from '../lib/archive-ocr';
import {reviewTranscript,acceptHigh,allTextAccepted,coverageWarnings,extractionFailure,preserveTextReviews,needsConfidenceRefresh,duplicateQuestionWarning,type OCRPage,type TextReviewRegion} from '../lib/extraction-review';

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { reviewReadingParts } from "../lib/assessment-review-cards";

type Language = "ta" | "zh";
type Level = "P3" | "P5";
type Comfort = "finding" | "growing" | "stretch";
type NarratorVoice = "marin" | "cedar";
type NarrationMode = "story" | "sentence" | "word";
type ReadingPath = "choose" | "whole_story" | "paragraphs";
type WholeStoryStage = "reading" | "questions";
type WorksheetLaunchMode = "homework" | "storybook";
type AssessmentPageRole = "printed_prompt" | "student_answer" | "teacher_annotations" | "rubric_feedback" | "model_answer" | "other";
type ClassroomTeacherRequest = {
  kind: "doubt" | "checkpoint";
  context: "passage" | "question";
  focusWord: string;
  signal: number;
  sectionIndex?: number;
};

type AssessmentReadPage = {
  ocrFailure?: string;
  ocrReaderVersion?: number;
  reviewRegions?: TextReviewRegion[];
  ocrEvidence?: OCRPage;
  initialText?: string;
  textAccepted?: boolean;
  roleAccepted?: boolean;
  source_index: number;
  source_page_label: string;
  role: AssessmentPageRole;
  role_confidence: "high" | "medium" | "low";
  transcript: string;
  score_summary: string;
  visible_teacher_feedback: string[];
  contains_possible_student_identifiers: boolean;
};

type AssessmentReview = {
  title: string;
  overall_summary: string;
  strengths: string[];
  focus_areas: string[];
  rubric: Array<{ category: string; observed: string; next_step: string }>;
  next_practice: { title: string; instruction: string };
  voice_teacher_prompt: string;
  illustrations?: {
    visual_bible: string;
    strength: { prompt: string; alt: string };
    focus: { prompt: string; alt: string };
    practice: { prompt: string; alt: string };
  };
};

type ReviewSceneKey = "strength" | "focus" | "practice";
type ReviewScene = { status: "loading" | "ready" | "failed"; url?: string };

type Choice = { label: string; response: string; nudge?: string };
type Question = {
  prompt: string;
  parentCue: string;
  choices?: Choice[];
  stems?: string[];
};

type Beat = {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  image: string;
  alt: string;
  question?: Question;
  cliffhanger?: boolean;
};

type GlossaryEntry = {
  sentence: string;
  simple: string;
  english: string;
  construction?: WordConstruction;
  contextual?: ContextualWordInfo;
};

type ContextualWordInfo = {
  selected_form: string;
  canonical_form: string;
  pronunciation: string;
  meaning_here: string;
  source_sentence: string;
  entry_kind: "word" | "expression" | "grammar";
  confidence: "high" | "medium" | "low";
  needs_clarification: boolean;
  ambiguity_note: string;
};

type WordConstruction = {
  kind: "tamil_word_family" | "mandarin_compound" | "whole_word";
  parts: Array<{
    form: string;
    pronunciation: string;
    meaning: string;
  }>;
  related_forms: Array<{
    form: string;
    pronunciation: string;
    meaning: string;
  }>;
};

type StorySupport = {
  question_meaning: string;
  key_phrase: string;
  key_phrase_meaning: string;
  story_clue: string;
  clue_connection: string;
  answer_frame: string;
};

type ActiveWordHelp = {
  word: string;
  context: string;
  rung: number;
  fromQuestion: boolean;
  loading: boolean;
  help?: GlossaryEntry;
  error?: string;
};

type Story = {
  title: string;
  titleEnglish: string;
  source: string;
  beats: Beat[];
};

type SatchelItem = {
  word: string;
  language: Language;
  uses?: number;
  gloss?: GlossaryEntry;
  savedAt?: number;
  senseKey?: string;
  sourceSentence?: string;
};

function contextualHelpNeedsClarification(help?: GlossaryEntry) {
  return Boolean(help?.contextual?.needs_clarification || help?.contextual?.confidence === "low");
}

function satchelItemFromHelp(word: string, language: Language, help?: GlossaryEntry): SatchelItem {
  const contextual = help?.contextual;
  const proposedForm = contextual?.selected_form?.trim();
  const selectedForm = language === "zh" && proposedForm && proposedForm.includes(word) ? proposedForm : word;
  const canonical = contextual?.canonical_form?.trim() || selectedForm;
  const meaning = contextual?.meaning_here?.trim() || help?.english?.trim() || "";
  const senseKey = language === "zh" ? `${canonical}\u241f${meaning.toLocaleLowerCase()}` : selectedForm;
  return {
    word: selectedForm,
    language,
    uses: 0,
    gloss: help,
    senseKey,
    sourceSentence: contextual?.source_sentence?.trim() || undefined,
  };
}

function satchelItemKey(item: SatchelItem) {
  return `${item.language}:${item.senseKey || item.word}`;
}

function sameSatchelItem(left: SatchelItem, right: SatchelItem) {
  if (left.language !== right.language) return false;
  if (left.senseKey && right.senseKey) return left.senseKey === right.senseKey;
  return left.word === right.word;
}

type BackpackStoryContext = {
  language: Language;
  level: Level;
  title: string;
  text: string;
};

type ExtractedWorksheet = {
  ocrFailure?: string;
  ocrReaderVersion?: number;
  reviewRegions?: TextReviewRegion[];
  ocrEvidence?: OCRPage;
  initialText?: string;
  structureAccepted?: boolean;
  title: string;
  detected_language: "ta" | "zh";
  passage_text: string;
  other_text: string;
  confidence_notes: string[];
  content_complete: boolean;
  unreadable_regions: string[];
  page_audits?: Array<{
    page_number: number;
    page_marker: string;
    page_kind: "passage" | "exercise" | "mixed";
    visible_item_labels: string[];
    source_verified: boolean;
  }>;
};

type UploadedPage = {
  storedId?: string;
  id: string;
  file: File;
  previewUrl: string;
  originalIndex: number;
  hash: string;
  sourceDocumentId: string;
  sourceDocumentName: string;
  sourceKind: "pdf" | "image";
  sourcePageNumber: number;
  orderNote?: string;
};

type WorksheetBatch = {
  id: string;
  pageStart: number;
  pageEnd: number;
  status: "queued" | "reading" | "review" | "build_queued" | "building" | "ready" | "failed";
  extracted?: ExtractedWorksheet;
  confirmedText?: string;
  confirmedOtherText?: string;
  sourceChecked?: boolean;
  error?: string;
  diagnostic?: string;
  attempt?: number;
  maxAttempts?: number;
  readStartedAt?: number;
  regionCount?: number;
  regionsCompleted?: number;
  retryingRegion?: number;
};

type PageOrderResult = {
  pages: Array<{
    original_index: number;
    page_marker: string;
    continuity_note: string;
  }>;
  confidence_note: string;
};

type WorksheetSection = {
  id: string;
  title: string;
  text: string;
  section_kind?: "reading" | "exercise_item" | "composition_stage";
  item_label?: string;
  illustration_prompt: string;
  alt: string;
  question: {
    prompt: string;
    thinking_goal: string;
    evidence_prompt: string;
    key_points: string[];
    response_mode?: "spoken" | "written";
    preparation_for?: string[];
    preparation_aligned?: boolean;
    preparation_quality_version?: number;
  };
  support?: {
    goal: string;
    simple_explanation: string;
    hint_steps: string[];
    answer_starter: string;
    self_check: string[];
  };
  imageUrl?: string;
  imageStatus?: "waiting" | "creating" | "ready" | "failed";
};

type HandwritingFeedback = {
  task_type: "open_ended" | "objective_writing";
  readability: "readable" | "uncertain" | "unreadable";
  transcription: string;
  verdict: "correct" | "partly_correct" | "incorrect" | "unreadable";
  accepted_for_progress: boolean;
  feedback: string;
  parent_note: string;
  key_points_covered: number;
  key_points_total: number;
};

type WorksheetWordActivity = {
  scaffold_available: boolean;
  activity_kind: "word_correction" | "sentence_transformation" | "comprehension" | "other";
  focus_text: string;
  clue_one: string;
  clue_two: string;
  construction_frame: string;
  is_word_substitution: boolean;
  worksheet_skill_english: string;
  instruction_target: string;
  source_sentence: string;
  target_word: string;
  options: string[];
  correct_word: string;
  corrected_sentence: string;
  short_reason_english: string;
};

// The interest-to-game experiment is intentionally disabled in the worksheet
// reader. The worksheet question itself is the learner's only task.
const worksheetInterestActivitiesEnabled = false;

type WorksheetReader = {
  worksheetId: string;
  title: string;
  language: Language;
  level: Level;
  visual_bible: string;
  content_kind?: "story" | "informational" | "mixed" | "exercise" | "composition";
  learning_mode?: "read_along" | "guided_exercise" | "composition_guide";
  sections: WorksheetSection[];
};

type WorksheetSetCache = {
  orderedHashes: string[];
  orderNotes: string[];
  orderConfidence: string;
  batches: WorksheetBatch[];
  reader: WorksheetReader | null;
};

type WorksheetBatchCache = {
  sourceChecked?: boolean;
  confirmedText?: string;
  confirmedOtherText?: string;
  extracted: ExtractedWorksheet;
};

type CaptureIssueKind = "foreign_text" | "missing_text" | "missing_items" | "unclear_source" | "timeout";

type WorksheetCaptureIssue = {
  batchIndex: number;
  pageNumber: number;
  pageName: string;
  issueKinds: CaptureIssueKind[];
  visibleLabels: string[];
  diagnosticNote: string;
  regionNumber?: number;
};

class WorksheetPageCaptureError extends Error {
  constructor(
    message: string,
    readonly pageNumber: number,
    readonly pageName: string,
    readonly issueKinds: CaptureIssueKind[],
    readonly visibleLabels: string[],
    readonly diagnosticNote: string,
    readonly regionNumber?: number,
  ) {
    super(message);
    this.name = "WorksheetPageCaptureError";
  }
}

type WorksheetCacheResponse<T> = {
  found: boolean;
  payload?: T;
  updatedAt?: string;
  error?: string;
};

type SpeechFeedback = {
  usable: boolean;
  language_status: "target_language" | "mostly_target_language" | "mixed" | "wrong_language" | "gibberish";
  accepted_for_progress: boolean;
  relevance: "relevant" | "partly_relevant" | "not_relevant" | "not_checked";
  grammar_status: "clear" | "small_fix" | "needs_retry" | "not_checked";
  encouragement: string;
  corrected_response: string;
  parent_note: string;
  retry_prompt: string;
  used_words: string[];
  verdict: "correct" | "partly_correct" | "incorrect" | "not_checked";
  reference_answer: string;
  story_evidence: string;
  key_points_covered?: number;
  key_points_total?: number;
  word_evidence: Array<{
    target_word: string;
    used: boolean;
    meaningful_use: boolean;
    matched_form: string;
    reason: string;
  }>;
  should_retry: boolean;
};

type FootballAttemptResult = "checking" | "learner" | "opponent";

type SavedResponse = {
  id: string;
  storyTitle: string;
  beatId: string;
  language: Language;
  level: Level;
  kind: "question" | "ending";
  prompt: string;
  originalResponse: string;
  correctedResponse: string;
  relevance: SpeechFeedback["relevance"];
  grammarStatus: SpeechFeedback["grammar_status"];
  encouragement: string;
  parentNote: string;
  retryPrompt: string;
  usedWords: string[];
  shouldRetry: boolean;
  aiEvaluated: boolean;
  attempt: number;
  imageUrl: string | null;
  createdAt: string;
};

const comfortChoices: Array<{
  id: Comfort;
  title: string;
  description: string;
  symbol: string;
}> = [
  {
    id: "finding",
    title: "Finding my way",
    description: "We need frequent pauses, picture clues and help with words.",
    symbol: "◌",
  },
  {
    id: "growing",
    title: "Growing in confidence",
    description: "We can follow the main idea with a little support.",
    symbol: "◐",
  },
  {
    id: "stretch",
    title: "Ready to stretch",
    description: "We can follow details and explain our thinking.",
    symbol: "●",
  },
];

const tamilGlossary: Record<string, GlossaryEntry> = {
  "அடர்ந்த": {
    sentence: "அடர்ந்த காட்டில் மரங்கள் நெருக்கமாக வளரும்.",
    simple: "மிகவும் நெருக்கமான",
    english: "dense / thick",
  },
  "தொங்கிய": {
    sentence: "மரக்கிளையில் ஒரு விளக்கு தொங்கியது.",
    simple: "கீழே ஆடியபடி இருந்த",
    english: "hanging",
  },
  "புதிர்க் கதை": {
    sentence: "விடையை யோசிக்க வைக்கும் கதை ஒரு புதிர்க் கதை.",
    simple: "விடை தேடும் கதை",
    english: "riddle story",
  },
  "உணர்திறன்": {
    sentence: "மெல்லிய ஓசையையும் கேட்பது கூர்மையான உணர்திறன்.",
    simple: "சிறு மாற்றத்தையும் உணரும் திறன்",
    english: "sensitivity / power of perception",
  },
  "முன்வைக்கிறது": {
    sentence: "வேதாளம் விக்கிரமனிடம் ஒரு கேள்வியை முன்வைக்கிறது.",
    simple: "கேட்கிறது",
    english: "asks / poses (a question)",
  },
  "தீர்ப்பு": {
    sentence: "இருவரின் கருத்தையும் கேட்ட பிறகு அரசர் தீர்ப்பு கூறினார்.",
    simple: "முடிவு",
    english: "judgement / decision",
  },
  "அரசவை": {
    sentence: "மக்களின் கேள்விகளைக் கேட்க அரசவை கூடியது.",
    simple: "அரசரின் மன்றம்",
    english: "royal court",
  },
  "விசாரித்தபோது": {
    sentence: "என்ன நடந்தது என்று விசாரித்தபோது உண்மை தெரிந்தது.",
    simple: "கவனமாகக் கேட்டுத் தேடியபோது",
    english: "when they investigated",
  },
  "சுடுகாடு": {
    sentence: "சுடுகாடு ஊருக்கு வெளியே இருந்தது.",
    simple: "இறந்தவர்களை எரிக்கும் இடம்",
    english: "cremation ground",
  },
  "இசைக்கலைஞர்": {
    sentence: "இசைக்கலைஞர் வீணையை இனிமையாக வாசித்தார்.",
    simple: "இசை வாசிப்பவர்",
    english: "musician",
  },
  "மெத்தைகள்": {
    sentence: "படுக்கையின் மேல் மென்மையான மெத்தைகள் இருந்தன.",
    simple: "படுக்க உதவும் மென்மையான பொருட்கள்",
    english: "mattresses",
  },
  "மெல்லிய": {
    sentence: "சிலந்தி வலை மிகவும் மெல்லியதாக இருந்தது.",
    simple: "தடிமன் குறைந்த",
    english: "thin / delicate",
  },
  "அடையாளம்": {
    sentence: "மண்ணில் இருந்த காலடி அடையாளத்தை அவள் கண்டாள்.",
    simple: "தடம்",
    english: "mark / sign",
  },
  "ஆதாரம்": {
    sentence: "அவன் சொன்னது உண்மை என்பதற்கு ஒரு ஆதாரம் காட்டினான்.",
    simple: "உண்மையை நிரூபிக்கும் குறிப்பு",
    english: "evidence",
  },
  "நம்பத்தகுந்த": {
    sentence: "தெளிவான ஆதாரம் இருந்ததால் செய்தி நம்பத்தகுந்தது.",
    simple: "நம்பக்கூடிய",
    english: "credible / believable",
  },
  "வியப்புடன்": {
    sentence: "வானவில் தோன்றியதை குழந்தைகள் வியப்புடன் பார்த்தனர்.",
    simple: "ஆச்சரியமாக",
    english: "with wonder / surprise",
  },
  "நிபந்தனை": {
    sentence: "ஒரு நிபந்தனையை ஏற்ற பிறகே போட்டியில் சேர்ந்தான்.",
    simple: "கடைப்பிடிக்க வேண்டிய விதி",
    english: "condition",
  },
};

const mandarinGlossary: Record<string, GlossaryEntry> = {
  "火焰山": {
    sentence: "火焰山的火光把天空照红了。",
    simple: "一直燃烧的大山",
    english: "Flaming Mountains",
  },
  "炙热": {
    sentence: "中午的太阳十分炙热。",
    simple: "非常热",
    english: "scorching hot",
  },
  "芭蕉扇": {
    sentence: "铁扇公主手里有一把神奇的芭蕉扇。",
    simple: "用芭蕉叶做的大扇子",
    english: "plantain-leaf fan",
  },
  "熄灭": {
    sentence: "一阵大雨把篝火熄灭了。",
    simple: "让火不再燃烧",
    english: "extinguish / put out",
  },
  "借": {
    sentence: "我向同学借了一支铅笔。",
    simple: "暂时拿来用，以后归还",
    english: "borrow",
  },
  "拒绝": {
    sentence: "他不愿意参加，所以礼貌地拒绝了。",
    simple: "不同意",
    english: "refuse",
  },
  "恩怨": {
    sentence: "他们过去的恩怨让这次见面很不容易。",
    simple: "以前留下的矛盾",
    english: "past grievance",
  },
  "定风丹": {
    sentence: "定风丹能让人站在狂风中也不被吹走。",
    simple: "可以挡住大风的宝物",
    english: "wind-calming pearl",
  },
  "狂风": {
    sentence: "狂风把树枝吹得左右摇摆。",
    simple: "很强的大风",
    english: "gale / fierce wind",
  },
  "假扇子": {
    sentence: "这把假扇子看起来像真的，却没有真正的威力。",
    simple: "不是真的扇子",
    english: "fake fan",
  },
  "越来越": {
    sentence: "雨越下越大，河水也越来越高。",
    simple: "一步一步变得更……",
    english: "more and more",
  },
  "计策": {
    sentence: "孙悟空想出了一个聪明的计策。",
    simple: "解决问题的办法",
    english: "plan / stratagem",
  },
  "证据": {
    sentence: "地上的脚印是重要的证据。",
    simple: "能证明真相的线索",
    english: "evidence",
  },
  "村民": {
    sentence: "村民一起把倒下的树搬开。",
    simple: "住在村里的人",
    english: "villagers",
  },
  "威力": {
    sentence: "这件宝物的威力十分强大。",
    simple: "强大的力量",
    english: "power / might",
  },
  "脱险": {
    sentence: "小船回到岸边，大家终于脱险了。",
    simple: "离开危险",
    english: "escape danger",
  },
  "铁扇公主": {
    sentence: "铁扇公主住在翠云山的芭蕉洞里。",
    simple: "拥有芭蕉扇的公主",
    english: "Princess Iron Fan",
  },
  "孙悟空": {
    sentence: "孙悟空聪明、勇敢，也很会想办法。",
    simple: "本领高强的美猴王",
    english: "Sun Wukong / Monkey King",
  },
  "悟空": {
    sentence: "悟空遇到困难时，总会先观察再想办法。",
    simple: "孙悟空，也就是美猴王",
    english: "Wukong / the Monkey King",
  },
};

const image = (name: string) => `/story-images/${name}.png`;

const stories: Record<Language, Record<Level, Story>> = {
  ta: {
    P3: {
      title: "மூன்று சகோதரர்களின் மர்மம்",
      titleEnglish: "The Mystery of the Three Brothers",
      source: "A child-friendly adaptation of the traditional Vikram–Vetala tale ‘The Three Sensitive Brothers’.",
      beats: [
        {
          id: "ta3-1",
          eyebrow: "இரவுக் காட்டில்",
          title: "வேதாளத்தின் புதிய புதிர்",
          text: "இரவு ஆழ்ந்தது. அரசன் விக்கிரமன் அடர்ந்த காட்டில் நடந்தான். அவன் தோளில் தொங்கிய வேதாளம் மெதுவாகச் சிரித்தது… “அரசே, தூக்கம் வராதிருக்க ஒரு புதிர்க் கதை கேட்கிறாயா?”",
          image: image("tamil-cover"),
          alt: "King Vikram carrying the playful Vetala through a moonlit banyan forest",
          question: {
            prompt: "விக்கிரமன் எங்கே நடந்தான்?",
            parentCue: "Ask your child to point to the words or the picture clue before choosing.",
            choices: [
              { label: "அடர்ந்த காட்டில்", response: "ஆம்—கதை இரவுக் காட்டில் தொடங்குகிறது." },
              { label: "அரண்மனையில்", response: "அரண்மனை இன்னும் வரவில்லை. முதல் வரியையும் படத்தையும் மீண்டும் பார்ப்போம்." },
            ],
          },
        },
        {
          id: "ta3-2",
          eyebrow: "வேதாளத்தின் கதைக்குள்",
          title: "யார் மிகவும் உணர்திறன் கொண்டவர்?",
          text: "ஒரு கிராமத்தில் மூன்று சகோதரர்கள் வாழ்ந்தனர். அவர்களது தந்தை ஒரு ஆமையை அரச குளத்திற்குக் கொண்டு செல்லச் சொன்னார். ஆனால் மூவரும், “என் உணர்திறன் மிகவும் கூர்மை; நான் அதைத் தூக்க முடியாது!” என்று வாதிட்டனர். முடிவில், தீர்ப்பு கேட்க அவர்கள் அரசவைக்குச் சென்றனர்.",
          image: image("tamil-palace"),
          alt: "Three brothers bringing their unusual disagreement to a wise king",
          question: {
            prompt: "சகோதரர்கள் ஏன் அரசவைக்குச் சென்றனர்?",
            parentCue: "Let the child explain first; the choices are only a support.",
            choices: [
              { label: "தீர்ப்பு கேட்க", response: "சரி. யாரின் உணர்திறன் கூர்மையானது என்பதை அரசர் முடிவு செய்ய வேண்டும்." },
              { label: "விருந்து சாப்பிட", response: "விருந்து பிறகு வந்தது. அவர்கள் சென்ற முக்கிய காரணம் என்ன? ‘தீர்ப்பு’ என்ற சொல்லைப் பாருங்கள்." },
            ],
          },
        },
        {
          id: "ta3-3",
          eyebrow: "முதல் சோதனை",
          title: "சாதத்தில் வந்த புகை மணம்",
          text: "அரசர் மூவருக்கும் மணமுள்ள சாதம் வைத்தார். மூத்தவன் ஒரு கவளம் சாப்பிட்டதும் முகத்தைச் சுளித்தான். “இந்தச் சாதத்தில் புகை மணம் வருகிறது,” என்றான். விசாரித்தபோது, அந்த நெல் சுடுகாட்டின் அருகே விளைந்தது தெரிய வந்தது. அரசர் வியப்புடன் புருவத்தை உயர்த்தினார்.",
          image: image("tamil-palace"),
          alt: "The oldest brother notices an unexpected smell in the royal meal",
          question: {
            prompt: "மூத்தவனின் கூற்று உண்மை என்று எது காட்டியது?",
            parentCue: "This is an evidence question, not a vocabulary test.",
            choices: [
              { label: "நெல் விளைந்த இடம்", response: "அப்படித்தான். நெல் சுடுகாட்டின் அருகே விளைந்தது என்பது ஆதாரம்." },
              { label: "அரசரின் முகம்", response: "அரசர் வியந்தார்; ஆனால் கூற்றை நிரூபித்த ஆதாரம் நெல் விளைந்த இடம்." },
            ],
          },
        },
        {
          id: "ta3-4",
          eyebrow: "இரண்டாம் சோதனை",
          title: "இசைக்குள் மறைந்திருந்த குறிப்பு",
          text: "பிறகு ஓர் இசைக்கலைஞர் வீணை வாசித்தார். நடுவிலுள்ள சகோதரன், “இவரிடம் ஆட்டுப்பாலின் மணம் வருகிறது,” என்றான். எல்லோரும் திகைத்தனர். இசைக்கலைஞர் சிறு வயதில் ஆட்டுப்பால் குடித்து வளர்ந்ததாகச் சொன்னார். இரண்டாவது கூற்றும் உண்மையானது!",
          image: image("tamil-palace"),
          alt: "A veena musician performs while the second brother notices a hidden clue",
          question: {
            prompt: "இப்போது அரசருக்கு என்ன குழப்பம் இருக்கும்?",
            parentCue: "Invite a prediction; there is no score attached.",
            choices: [
              { label: "இருவரும் உண்மை சொன்னார்கள்", response: "ஆம். அதனால் யார் மிகவும் உணர்திறன் கொண்டவர் என்று முடிவு செய்வது கடினமாகிறது." },
              { label: "யாரும் உண்மை சொல்லவில்லை", response: "முதல் இரண்டு கூற்றுகளுக்கும் ஆதாரம் கிடைத்ததே. அந்தக் குறிப்புகளை மீண்டும் சொல்ல முடியுமா?" },
            ],
          },
        },
        {
          id: "ta3-5",
          eyebrow: "கடைசி இரவு",
          title: "ஏழு மெத்தைகளின் மர்மம்",
          text: "இளைய சகோதரனுக்காக அரசர் ஏழு மென்மையான மெத்தைகளை அடுக்கச் சொன்னார். ஆனால் நடு இரவில் அவன் வலியால் விழித்தான். காலையில் அவன் தோளில் மெல்லிய சிவப்பு அடையாளம் இருந்தது! பணியாளர்கள் மெத்தைகளை ஒவ்வொன்றாகத் தூக்கத் தொடங்கினர்…",
          image: image("tamil-cliffhanger"),
          alt: "The youngest brother sits awake on seven mattresses while the king investigates",
          question: {
            prompt: "மெத்தைகளுக்குக் கீழே என்ன இருக்கலாம்?",
            parentCue: "Pause here. Ask for a prediction and the clue that supports it.",
            stems: ["என் ஊகம்…", "அதற்கு ஆதாரம்…"],
          },
          cliffhanger: true,
        },
      ],
    },
    P5: {
      title: "ஏழாம் மெத்தையின் கீழ்",
      titleEnglish: "Beneath the Seventh Mattress",
      source: "A richer adaptation of the traditional Vikram–Vetala tale ‘The Three Sensitive Brothers’.",
      beats: [
        {
          id: "ta5-1",
          eyebrow: "நிலவொளிப் பாதை",
          title: "அமைதியைச் சோதித்த சிரிப்பு",
          text: "நிலவொளி மரக்கிளைகளின் வழியே வெள்ளிக் கோடுகளாக விழுந்தது. ஒவ்வொரு அடியிலும் உலர்ந்த சருகுகள் முறிந்தன. தோளில் தொங்கிய வேதாளம், விக்கிரமனின் அமைதியைச் சோதிப்பதுபோல் சிரித்தது. “அரசே, உணர்திறன் என்பது ஒருவர் சொல்வதா, அல்லது அவர் காட்டும் ஆதாரமா? இதோ ஒரு கதை…”",
          image: image("tamil-cover"),
          alt: "King Vikram listens as the Vetala begins a riddle in a moonlit forest",
          question: {
            prompt: "வேதாளம் எந்தக் கேள்வியை முன்வைக்கிறது?",
            parentCue: "Ask for the idea in the child’s own words, then reveal a sentence stem if needed.",
            stems: ["ஒருவரின் திறனை நம்புவதற்கு…", "சொல்லைவிட முக்கியமானது…"],
          },
        },
        {
          id: "ta5-2",
          eyebrow: "அரசவையில்",
          title: "மூன்று கூற்றுகள்—ஒரே தீர்ப்பு",
          text: "மூன்று சகோதரர்கள் தங்களுக்கே மிகக் கூர்மையான உணர்திறன் இருப்பதாக வாதிட்டனர். ஒரு ஆமையைத் தூக்கும் சிறிய பொறுப்புக்குக்கூட அவர்கள் தயங்கியதால், தந்தை அவர்களை அரசரிடம் அனுப்பினார். அரசர் உடனே தீர்ப்பு கூறவில்லை. “கூற்றுகளுக்கு நம்பத்தகுந்த ஆதாரம் வேண்டும்,” என்று சொல்லி, மூன்று வெவ்வேறு சோதனைகளை அமைத்தார்.",
          image: image("tamil-palace"),
          alt: "The wise king plans three fair tests for the brothers",
          question: {
            prompt: "அரசர் உடனே தீர்ப்பு கூறாதது ஏன் புத்திசாலித்தனமான முடிவு?",
            parentCue: "Look for cause and effect, not one ‘perfect’ sentence.",
            stems: ["உடனே நம்பியிருந்தால்…", "சோதனை மூலம்…"],
          },
        },
        {
          id: "ta5-3",
          eyebrow: "விருந்தில் முதல் ஆதாரம்",
          title: "ஒரு கவளம்; ஒரு சந்தேகம்",
          text: "விருந்தின்போது மூத்தவன் சாதத்தை முகர்ந்து பார்த்துவிட்டு, அதில் எரிந்த உடலின் புகை மணம் கலந்திருப்பதாகக் கூறினான். சமையல்காரர் மறுத்தார். எனினும் அரசர் விசாரிக்கச் சொன்னார். நெல் விளைந்த வயல் பழைய சுடுகாட்டை ஒட்டியிருந்தது தெரிய வந்ததும், மண்டபம் முழுவதும் அமைதி நிலவியது.",
          image: image("tamil-palace"),
          alt: "The royal court falls silent after the first brother’s claim is investigated",
          question: {
            prompt: "இந்த ஆதாரம் கூற்றை உறுதிப்படுத்துகிறதா, அல்லது அது வெறும் தற்செயலா? காரணத்துடன் சொல்லுங்கள்.",
            parentCue: "P5 can hold two possibilities before deciding.",
            stems: ["இது உறுதிப்படுத்துகிறது; ஏனெனில்…", "இன்னும் சந்தேகம் இருக்கலாம்; ஏனெனில்…"],
          },
        },
        {
          id: "ta5-4",
          eyebrow: "இசையில் இரண்டாம் ஆதாரம்",
          title: "கண்களுக்குத் தெரியாத மணம்",
          text: "அடுத்ததாக அரசவைக் கலைஞர் வீணை மீட்டினார். இரண்டாவது சகோதரன் இசையைப் பாராட்டினாலும், அவரிடம் ஆட்டுப்பாலின் மணம் இருப்பதாகக் கூறினான். முதலில் அது அவமதிப்பாகத் தோன்றியது. ஆனால் சிறு வயதில் தாயை இழந்த கலைஞர், ஆட்டுப்பால் குடித்தே வளர்ந்ததாக அமைதியாக விளக்கினார்.",
          image: image("tamil-palace"),
          alt: "The second brother listens closely to a musician in the royal court",
          question: {
            prompt: "‘முதலில் அது அவமதிப்பாகத் தோன்றியது’ என்ற வரி கதையின் பதற்றத்தை எவ்வாறு அதிகரிக்கிறது?",
            parentCue: "Discuss feeling and narrative effect—not just recall.",
            stems: ["வாசகர் முதலில்… என்று நினைக்கிறார்", "உண்மை தெரியும்போது…"],
          },
        },
        {
          id: "ta5-5",
          eyebrow: "மூன்றாம் சோதனை",
          title: "தோலில் தோன்றிய மெல்லிய கோடு",
          text: "இளையவனுக்காக ஏழு உயர்தர மெத்தைகள் ஒன்றன்மேல் ஒன்றாக அடுக்கப்பட்டன. பாதுகாப்புக் காவலர் கதவுக்கு வெளியே நின்றார்; யாரும் அறைக்குள் செல்லவில்லை. இருந்தும் விடியற்காலையில் இளையவன் வலியால் துடித்தான். அவன் தோளில் மிக மெல்லிய சிவப்புக் கோடு பதிந்திருந்தது. அரசர் பணியாளர்களை அழைத்து, ஒவ்வொரு மெத்தையையும் மெதுவாகத் தூக்கச் சொன்னார். ஆறாவது மெத்தை உயர்ந்தது… அனைவரும் மூச்சை நிறுத்தினர்…",
          image: image("tamil-cliffhanger"),
          alt: "The king and attendants investigate the unexplained red mark after a guarded night",
          question: {
            prompt: "கடைசி மெத்தையின் கீழ் என்ன இருக்கலாம்? உங்கள் முடிவை இரண்டு ஆதாரங்களுடன் விளக்குங்கள்.",
            parentCue: "The child now owns the ending. Let plausibility matter more than matching the traditional answer.",
            stems: ["என் முடிவு…", "முதல் ஆதாரம்…", "இரண்டாவது ஆதாரம்…"],
          },
          cliffhanger: true,
        },
      ],
    },
  },
  zh: {
    P3: {
      title: "孙悟空借芭蕉扇",
      titleEnglish: "Monkey King Borrows the Plantain Fan",
      source: "A child-friendly adaptation of the Flaming Mountains episode from Journey to the West.",
      beats: [
        {
          id: "zh3-1",
          eyebrow: "西行路上",
          title: "挡住去路的火焰山",
          text: "师徒四人继续往西走。忽然，前面的天空变得火红，热浪扑面而来。原来，炙热的火焰山挡住了去路！孙悟空眯起眼睛，举起金箍棒看了看山顶。",
          image: image("mandarin-cover"),
          alt: "Sun Wukong and his companions arrive before the enormous Flaming Mountains",
          question: {
            prompt: "什么挡住了他们的去路？",
            parentCue: "Ask the child to answer aloud before choosing.",
            choices: [
              { label: "火焰山", response: "对，火焰山挡住了西行的路。" },
              { label: "一条大河", response: "这一次不是河。看看天空和山是什么颜色？" },
            ],
          },
        },
        {
          id: "zh3-2",
          eyebrow: "村民的秘密",
          title: "只有一把扇子能灭火",
          text: "一位老村民告诉他们：“翠云山的铁扇公主有一把芭蕉扇。只有那把宝扇，才能熄灭山上的大火。”孙悟空马上说：“我去借扇子！”说完，他踩着筋斗云飞走了。",
          image: image("mandarin-cover"),
          alt: "A villager explains how the magical fan can put out the mountain fire",
          question: {
            prompt: "芭蕉扇有什么用？",
            parentCue: "Let the child find the exact action word in the story.",
            choices: [
              { label: "熄灭大火", response: "没错，宝扇能把火焰山的大火熄灭。" },
              { label: "变出食物", response: "故事没有说它能变食物。再找一找“熄灭”这个词。" },
            ],
          },
        },
        {
          id: "zh3-3",
          eyebrow: "芭蕉洞前",
          title: "铁扇公主拒绝了",
          text: "孙悟空来到芭蕉洞，礼貌地说明来意。铁扇公主却想起以前的恩怨，生气地说：“不借！”她举起芭蕉扇用力一扇。呼——一阵狂风把孙悟空吹到了很远的地方！",
          image: image("mandarin-fan"),
          alt: "Princess Iron Fan raises the magical fan as Sun Wukong asks to borrow it",
          question: {
            prompt: "铁扇公主为什么不肯借扇子？",
            parentCue: "This checks cause and effect inside the story.",
            choices: [
              { label: "她想起以前的恩怨", response: "对。过去的矛盾让她不愿意帮助孙悟空。" },
              { label: "扇子不见了", response: "扇子就在她手里。她拒绝的原因藏在“以前的恩怨”里。" },
            ],
          },
        },
        {
          id: "zh3-4",
          eyebrow: "第二次尝试",
          title: "一颗挡风的宝物",
          text: "孙悟空没有放弃。他借来一颗定风丹，又回到芭蕉洞。狂风再大，他也稳稳地站着。铁扇公主见赶不走他，只好拿出一把扇子。孙悟空接过扇子，高高兴兴地回到火焰山。",
          image: image("mandarin-fan"),
          alt: "Sun Wukong returns with a wind-calming treasure and receives a fan",
          question: {
            prompt: "定风丹怎样帮助了孙悟空？",
            parentCue: "Ask for a full cause-and-effect sentence if your child is ready.",
            choices: [
              { label: "让他不被狂风吹走", response: "说得好。因为站得稳，他终于拿到了扇子。" },
              { label: "把大火变小", response: "定风丹挡的是风。真正用来灭火的是哪一件宝物？" },
            ],
          },
        },
        {
          id: "zh3-5",
          eyebrow: "火焰山下",
          title: "火为什么更大了？",
          text: "孙悟空对着大火用力一扇。没想到，火不但没有熄灭，反而越来越大！火舌卷向天空，热浪追着他冲来。孙悟空这才明白：手里的是一把假扇子！他握紧金箍棒，眼睛一亮，似乎想到了新计策…",
          image: image("mandarin-cliffhanger"),
          alt: "The fake fan makes the flames surge as Sun Wukong thinks of another plan",
          question: {
            prompt: "孙悟空会怎样脱险，又怎样拿到真扇子？",
            parentCue: "Stop here. The child’s ending does not need to match the original novel.",
            stems: ["我猜孙悟空会…", "因为他可以…"],
          },
          cliffhanger: true,
        },
      ],
    },
    P5: {
      title: "真假芭蕉扇",
      titleEnglish: "The True and False Plantain Fans",
      source: "A richer adaptation of the Princess Iron Fan episode from the classic Journey to the West.",
      beats: [
        {
          id: "zh5-1",
          eyebrow: "烈焰之前",
          title: "一座不肯让路的山",
          text: "取经队伍走到一片寸草不生的土地。远处的山峰像被烧红的铁，热浪一层层压过来，连八戒也不敢抱怨了。村民说，火焰山常年燃烧；若不熄灭大火，任何人都无法继续西行。孙悟空抬头望着翻滚的火云，开始寻找破局的线索。",
          image: image("mandarin-cover"),
          alt: "The pilgrimage party studies the relentless Flaming Mountains",
          question: {
            prompt: "作者用哪两个细节表现火焰山的炙热？",
            parentCue: "Ask for evidence from the words, not just the illustration.",
            stems: ["第一个细节是…", "另一个细节是…"],
          },
        },
        {
          id: "zh5-2",
          eyebrow: "唯一的办法",
          title: "宝扇与旧怨",
          text: "一位老者告诉悟空，铁扇公主的芭蕉扇能令火势暂时平息，让雨水落下、草木重生。然而，悟空曾经降伏她的儿子红孩儿，两人之间留下了很深的恩怨。悟空知道借扇不会顺利，却仍决定先以礼相求。",
          image: image("mandarin-fan"),
          alt: "Sun Wukong prepares to ask Princess Iron Fan for the only treasure that can calm the fire",
          question: {
            prompt: "“却仍决定先以礼相求”表现了悟空怎样的一面？",
            parentCue: "Accept a supported interpretation, not only one adjective.",
            stems: ["这表现他…", "因为他明知道…却…"],
          },
        },
        {
          id: "zh5-3",
          eyebrow: "翠云山交锋",
          title: "一扇八万四千里",
          text: "铁扇公主听完来意，冷笑着拒绝了。她挥动芭蕉扇，狂风立刻卷起砂石，像一条巨龙扑向悟空。悟空连翻几个筋斗，仍被吹得无影无踪。后来，他借来定风丹，再次站到洞前；这一次，任凭风声怒吼，他的双脚也纹丝不动。",
          image: image("mandarin-fan"),
          alt: "Princess Iron Fan unleashes a magical gale while Sun Wukong returns prepared",
          question: {
            prompt: "第二次交锋和第一次相比，悟空改变了什么？这说明他如何解决问题？",
            parentCue: "Look for changed strategy and learning from failure.",
            stems: ["第一次他…；第二次他…", "这说明他会…"],
          },
        },
        {
          id: "zh5-4",
          eyebrow: "看似成功",
          title: "来得太容易的胜利",
          text: "铁扇公主见法宝失效，终于递出一把与真扇几乎一模一样的芭蕉扇。悟空急着救人，没有仔细试验，便带着扇子赶回火焰山。唐僧提醒他：“越接近成功，越要小心。”悟空笑着摆摆手，站到了烈焰之前。",
          image: image("mandarin-fan"),
          alt: "Sun Wukong leaves with a convincing fan while a warning goes unheeded",
          question: {
            prompt: "故事用哪些线索暗示这次“胜利”可能有问题？",
            parentCue: "Encourage two clues and a prediction.",
            stems: ["第一个线索是…", "另一个线索是…", "所以我预测…"],
          },
        },
        {
          id: "zh5-5",
          eyebrow: "烈焰反扑",
          title: "风助火势",
          text: "悟空双手握紧扇柄，朝山口猛扇三下。第一下，火焰弯下了腰；第二下，火星漫天飞舞；第三下，整座山突然发出轰鸣，烈焰反而扑得更高！悟空立刻看出这是假扇子，可退路已被火墙截断。就在衣角快要冒烟时，他望见岩壁上一道狭窄的裂缝…",
          image: image("mandarin-cliffhanger"),
          alt: "The false fan feeds the flames and traps Sun Wukong before a narrow opening",
          question: {
            prompt: "悟空应该先脱险，还是立刻回去夺真扇？设计一个合理的计策，并说明风险。",
            parentCue: "The child creates the ending; reasoning matters more than matching the classic plot.",
            stems: ["我会先…", "这个计策可行，因为…", "最大的风险是…"],
          },
          cliffhanger: true,
        },
      ],
    },
  },
};

function useNarratorVoice() {
  const [voice, setVoice] = useState<NarratorVoice>("marin");

  useEffect(() => {
    const applySavedVoice = () => {
      try {
        setVoice(localStorage.getItem("storylight-narrator-voice") === "cedar" ? "cedar" : "marin");
      } catch {
        setVoice("marin");
      }
    };
    applySavedVoice();
    window.addEventListener("storylight-narrator-voice", applySavedVoice);
    return () => window.removeEventListener("storylight-narrator-voice", applySavedVoice);
  }, []);

  function chooseVoice(next: NarratorVoice) {
    setVoice(next);
    try {
      localStorage.setItem("storylight-narrator-voice", next);
      window.dispatchEvent(new Event("storylight-narrator-voice"));
    } catch {
      // The selected voice still works for this session.
    }
  }

  return [voice, chooseVoice] as const;
}

function AudioPreparingNotice({ voice }: { voice: NarratorVoice }) {
  return <div className="audio-preparing-notice" role="status" aria-live="polite" aria-atomic="true">
    <span className="audio-preparing-spinner" aria-hidden="true" />
    <span><b>Preparing audio…</b><small>{voice === "marin" ? "Marin" : "Cedar"} will begin in a few seconds. Please wait.</small></span>
  </div>;
}

type NarrationWordTiming = { word: string; start: number; end: number };

function useOpenAINarration(adultConfirmed: boolean) {
  type CachedNarration = { audioBuffer: AudioBuffer; words: NarrationWordTiming[] };
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [error, setError] = useState("");
  const [activeSpeech, setActiveSpeech] = useState<{ text: string; mode: NarrationMode } | null>(null);
  const context = useRef<AudioContext | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const streamingAudio = useRef<HTMLAudioElement | null>(null);
  const request = useRef<AbortController | null>(null);
  const audioCache = useRef(new Map<string, CachedNarration>());
  const frame = useRef<number | null>(null);
  const run = useRef(0);

  function stop(updateState = true) {
    run.current += 1;
    request.current?.abort();
    request.current = null;
    if (streamingAudio.current) {
      streamingAudio.current.onplaying = null;
      streamingAudio.current.onended = null;
      streamingAudio.current.onerror = null;
      streamingAudio.current.pause();
      streamingAudio.current.removeAttribute("src");
      streamingAudio.current.load();
    }
    streamingAudio.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (source.current) {
      source.current.onended = null;
      try { source.current.stop(); } catch { /* The source may already have ended. */ }
      source.current.disconnect();
    }
    source.current = null;
    if (updateState) {
      setStatus("idle");
      setActiveSpeech(null);
    }
  }

  function pause() {
    if (status !== "playing") return;
    if (streamingAudio.current) streamingAudio.current.pause();
    else void context.current?.suspend();
    setStatus("paused");
  }

  async function resume() {
    if (status !== "paused") return;
    if (streamingAudio.current) await streamingAudio.current.play();
    else await context.current?.resume();
    setStatus("playing");
  }

  async function play({
    text,
    language,
    voice,
    mode = "story",
    onProgress,
    onWord,
    onEnded,
  }: {
    text: string;
    language: Language;
    voice: NarratorVoice;
    mode?: NarrationMode;
    onProgress?: (progress: number) => void;
    onWord?: (wordIndex: number, words: NarrationWordTiming[]) => void;
    onEnded?: () => void;
  }) {
    stop(false);
    const currentRun = run.current;
    setError("");
    setStatus("loading");
    setActiveSpeech({ text, mode });

    try {
      if (mode === "word") {
        const params = new URLSearchParams({
          adultConfirmed: String(adultConfirmed),
          text,
          language,
          voice,
          mode,
        });
        const audio = new Audio(`/api/audio/speech?${params.toString()}`);
        streamingAudio.current = audio;
        audio.preload = "auto";
        audio.onplaying = () => {
          if (currentRun === run.current) setStatus("playing");
        };
        audio.onended = () => {
          if (currentRun !== run.current) return;
          streamingAudio.current = null;
          setStatus("idle");
          setActiveSpeech(null);
          onEnded?.();
        };
        audio.onerror = () => {
          if (currentRun !== run.current) return;
          streamingAudio.current = null;
          setStatus("idle");
          setActiveSpeech(null);
          setError("OpenAI pronunciation could not start.");
          onEnded?.();
        };
        await audio.play();
        return;
      }
      const AudioContextConstructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("This browser cannot play generated narration.");
      const audioContext = context.current ?? new AudioContextConstructor();
      context.current = audioContext;
      await audioContext.resume();

      const cacheKey = `${voice}:${language}:${mode}:${onWord ? "timed" : "plain"}:${text}`;
      let cachedNarration = audioCache.current.get(cacheKey);
      if (!cachedNarration) {
        const controller = new AbortController();
        request.current = controller;
        const response = await fetch("/api/audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adultConfirmed, text, language, voice, mode, includeTimings: Boolean(onWord) }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const result = await responseJson<{ error?: string }>(response);
          throw new Error(result.error || "OpenAI narration could not start.");
        }
        if (onWord) {
          const result = await responseJson<{ audioBase64?: string; words?: NarrationWordTiming[]; error?: string }>(response);
          if (!result.audioBase64) throw new Error(result.error || "OpenAI narration could not start.");
          const binary = atob(result.audioBase64);
          const encodedAudio = new ArrayBuffer(binary.length);
          const bytes = new Uint8Array(encodedAudio);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          cachedNarration = {
            audioBuffer: await audioContext.decodeAudioData(encodedAudio),
            words: Array.isArray(result.words) ? result.words : [],
          };
        } else {
          cachedNarration = {
            audioBuffer: await audioContext.decodeAudioData(await response.arrayBuffer()),
            words: [],
          };
        }
        audioCache.current.set(cacheKey, cachedNarration);
      }
      if (currentRun !== run.current) return;

      const { audioBuffer, words } = cachedNarration;

      const nextSource = audioContext.createBufferSource();
      nextSource.buffer = audioBuffer;
      nextSource.connect(audioContext.destination);
      source.current = nextSource;
      request.current = null;
      const startedAt = audioContext.currentTime;
      let highlightedWord = -1;
      setStatus("playing");
      if (!words.length) onProgress?.(0);

      const updateProgress = () => {
        if (currentRun !== run.current || source.current !== nextSource) return;
        const elapsed = audioContext.currentTime - startedAt;
        if (words.length) {
          let nextWord = -1;
          for (let index = 0; index < words.length; index += 1) {
            if (elapsed >= words[index].start) nextWord = index;
            else break;
          }
          if (nextWord >= 0 && nextWord !== highlightedWord) {
            highlightedWord = nextWord;
            onWord?.(nextWord, words);
          }
        } else {
          onProgress?.(Math.min(0.995, elapsed / Math.max(audioBuffer.duration, 0.1)));
        }
        frame.current = requestAnimationFrame(updateProgress);
      };
      frame.current = requestAnimationFrame(updateProgress);
      nextSource.onended = () => {
        if (currentRun !== run.current) return;
        if (frame.current !== null) cancelAnimationFrame(frame.current);
        frame.current = null;
        source.current = null;
        setStatus("idle");
        setActiveSpeech(null);
        if (!words.length) onProgress?.(1);
        onEnded?.();
      };
      nextSource.start();
    } catch (caught) {
      if (currentRun !== run.current) return;
      request.current = null;
      setStatus("idle");
      setActiveSpeech(null);
      setError(caught instanceof Error ? caught.message : "OpenAI narration could not start.");
      onEnded?.();
    }
  }

  useEffect(() => () => {
    stop(false);
    void context.current?.close();
  }, []);

  return { status, error, activeSpeech, play, stop, pause, resume };
}

function makeTokens(text: string, language: Language, glossary: Record<string, GlossaryEntry>) {
  const phrases = Object.keys(glossary).sort((a, b) => b.length - a.length);
  const tokens: Array<{ value: string; clickable: boolean }> = [];
  let index = 0;
  while (index < text.length) {
    const phrase = phrases.find((key) => text.startsWith(key, index));
    if (phrase) {
      tokens.push({ value: phrase, clickable: true });
      index += phrase.length;
      continue;
    }
    const rest = text.slice(index);
    if (language === "ta") {
      const match = rest.match(/^\s+|^[\p{L}\p{M}]+|^./u);
      const value = match?.[0] ?? rest[0];
      tokens.push({ value, clickable: /[\p{L}\p{M}]/u.test(value) });
      index += value.length;
    } else {
      const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
      const first = segmenter.segment(rest)[Symbol.iterator]().next().value as
        | { segment: string; isWordLike?: boolean }
        | undefined;
      const value = first?.segment ?? rest[0];
      tokens.push({ value, clickable: first?.isWordLike ?? /[\p{L}\p{N}]/u.test(value) });
      index += value.length;
    }
  }
  return tokens;
}

function narrationTokenIndex(
  wordIndex: number,
  spokenWords: NarrationWordTiming[],
  displayTokens: Array<{ value: string; clickable: boolean }>,
) {
  const clickableIndices = displayTokens.flatMap((token, index) => token.clickable ? [index] : []);
  if (!clickableIndices.length) return -1;
  if (spokenWords.length <= 1) return clickableIndices[0];

  const approximatePosition = Math.round(
    wordIndex * (clickableIndices.length - 1) / Math.max(spokenWords.length - 1, 1),
  );
  const normalise = (value: string) => value.normalize("NFKC").replace(/[^\p{L}\p{M}\p{N}]/gu, "").toLocaleLowerCase();
  const spoken = normalise(spokenWords[wordIndex]?.word ?? "");
  if (!spoken) return clickableIndices[approximatePosition];

  let bestPosition = approximatePosition;
  let bestDistance = Number.POSITIVE_INFINITY;
  const start = Math.max(0, approximatePosition - 4);
  const end = Math.min(clickableIndices.length - 1, approximatePosition + 4);
  for (let position = start; position <= end; position += 1) {
    const displayed = normalise(displayTokens[clickableIndices[position]].value);
    if (displayed === spoken || displayed.includes(spoken) || spoken.includes(displayed)) {
      const distance = Math.abs(position - approximatePosition);
      if (distance < bestDistance) {
        bestPosition = position;
        bestDistance = distance;
      }
    }
  }
  return clickableIndices[bestPosition];
}

function narratorName(language: Language) {
  return language === "ta" ? "பாட்டி" : "奶奶";
}

function createFamilyId() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function worksheetResponseMode(section: WorksheetSection, language: Language): "spoken" | "written" {
  if (section.question.response_mode) return section.question.response_mode;
  const task = `${section.question.prompt} ${section.text} ${section.support?.goal ?? ""}`.toLocaleLowerCase();
  const writtenSignals = language === "ta"
    ? ["எழுதுக", "எழுது", "நிரப்புக", "நிரப்பு", "பூர்த்தி", "திருத்துக", "திருத்தி", "கோடிட்ட", "சரியான வடிவ", "சொல்லை மாற்ற", "எழுத்துப்பிழை", "தேர்ந்தெடு", "தேர்வு செய்"]
    : ["写", "填写", "填空", "改正", "汉字", "词语", "选择", "圈出", "抄写"];
  const englishSignals = ["write", "fill in", "correct the", "spelling", "character", "word form", "multiple choice"];
  return [...writtenSignals, ...englishSignals].some((signal) => task.includes(signal)) ? "written" : "spoken";
}

function VoiceTeacherFootballProgress({ covered, total, goal, writtenGoalRequired = false }: { covered: number; total: number; goal: boolean; writtenGoalRequired?: boolean }) {
  const safeTotal = Math.max(1, total);
  const safeCovered = goal ? safeTotal : Math.max(0, Math.min(safeTotal, covered));
  const readyToWrite = writtenGoalRequired && !goal && safeCovered >= safeTotal;
  const ballPosition = readyToWrite ? 80 : 8 + (safeCovered / safeTotal) * 76;
  return <div className={`teacher-football-progress ${goal ? "goal-scored" : ""}`} aria-label={`Voice answer progress: ${safeCovered} of ${safeTotal} ideas`}>
    <div className="teacher-football-pitch" aria-hidden="true">
      <span className="teacher-pitch-line" />
      <span className="teacher-progress-ball" style={{ left: `${ballPosition}%` }}>⚽</span>
      <span className="teacher-progress-goal"><i /><i /><i /></span>
    </div>
    <div><small>{safeCovered} of {safeTotal} answer ideas</small><b>{goal ? "GOOOAL!" : readyToWrite ? "Ready for your written shot" : safeCovered ? "Closer to goal!" : "Build the answer"}</b></div>
  </div>;
}

function VoiceTeacherWordProgress({ covered, total, goal }: { covered: number; total: number; goal: boolean }) {
  const safeTotal = Math.max(1, total);
  const safeCovered = goal ? safeTotal : Math.max(0, Math.min(safeTotal, covered));
  return <div className={`teacher-word-progress ${goal ? "word-complete" : ""}`} aria-label={`Word practice progress: ${safeCovered} of ${safeTotal} steps`}>
    <div aria-hidden="true">
      {Array.from({ length: safeTotal }, (_, index) => <span className={index < safeCovered ? "complete" : ""} key={index}>{index < safeCovered ? "✦" : "◇"}</span>)}
    </div>
    <p><small>{safeCovered} of {safeTotal} word steps</small><b>{goal ? "Word spark earned!" : safeCovered ? "One more step" : "Hear it. Explain it. Use it."}</b></p>
  </div>;
}

function VoiceTeacherReviewProgress({ covered, total, goal }: { covered: number; total: number; goal: boolean }) {
  const safeTotal = Math.max(1, total);
  const safeCovered = goal ? safeTotal : Math.max(0, Math.min(safeTotal, covered));
  return <div className={`teacher-word-progress ${goal ? "word-complete" : ""}`} aria-label={`Assessment review progress: ${safeCovered} of ${safeTotal} steps`}>
    <div aria-hidden="true">{Array.from({ length: safeTotal }, (_, index) => <span className={index < safeCovered ? "complete" : ""} key={index}>{index < safeCovered ? "✓" : "◇"}</span>)}</div>
    <p><small>{safeCovered} of {safeTotal} review ideas</small><b>{goal ? "Point understood" : safeCovered ? "You are getting it" : "Let’s talk about this point"}</b></p>
  </div>;
}

function TeacherVoiceHelp({
  adultConfirmed,
  familyId = "",
  language,
  level = "P5",
  narratorVoice,
  worksheetTitle,
  sourceText,
  question,
  learnerAttempt,
  clue,
  keyPoints,
  preparationTargets = [],
  vocabularyTargets = [],
  purpose = "standalone_story",
  progressStyle = "football",
  writtenGoalRequired = false,
  supportOnly = false,
  classroomMode = false,
  classroomCheckpoint = false,
  onDiscover,
  onAttempted,
  onGoal,
  onWordsUsed,
  startSignal = 0,
}: {
  adultConfirmed: boolean;
  familyId?: string;
  language: Language;
  level?: Level;
  narratorVoice: NarratorVoice;
  worksheetTitle: string;
  sourceText: string;
  question: string;
  learnerAttempt: string;
  clue: string;
  keyPoints: string[];
  preparationTargets?: string[];
  vocabularyTargets?: SatchelItem[];
  purpose?: "homework_question" | "homework_warmup" | "standalone_story" | "backpack_flashcard" | "assessment_review";
  progressStyle?: "football" | "word" | "review";
  writtenGoalRequired?: boolean;
  supportOnly?: boolean;
  classroomMode?: boolean;
  classroomCheckpoint?: boolean;
  onDiscover?: (item: SatchelItem) => void;
  onAttempted?: () => void;
  onGoal?: () => void;
  onWordsUsed?: (words: string[]) => void;
  startSignal?: number;
}) {
  const progressPointTotal = Math.max(1, Math.min(4, keyPoints.length || 3));
  const [voiceState, setVoiceState] = useState<"idle" | "connecting" | "thinking" | "adapting" | "listening" | "speaking" | "error">("idle");
  const [caption, setCaption] = useState("");
  const captionTokens = useMemo(() => makeWorksheetTokens(caption, language), [caption, language]);
  const [captionHelp, setCaptionHelp] = useState<{ word: string; loading: boolean; saved: boolean; help?: GlossaryEntry; error?: string } | null>(null);
  const [voiceError, setVoiceError] = useState("");
  const [easierRequests, setEasierRequests] = useState(0);
  const [footballProgress, setFootballProgress] = useState({ covered: 0, total: progressPointTotal, goal: false });
  const peer = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const audioElement = useRef<HTMLAudioElement | null>(null);
  const goalReported = useRef(false);
  const creditedVoiceWords = useRef(new Set<string>());
  const handledStartSignal = useRef(0);
  const sessionRun = useRef(0);

  function stop() {
    sessionRun.current += 1;
    channel.current?.close();
    peer.current?.close();
    stream.current?.getTracks().forEach((track) => track.stop());
    if (audioElement.current) {
      audioElement.current.pause();
      audioElement.current.srcObject = null;
    }
    channel.current = null;
    peer.current = null;
    stream.current = null;
    audioElement.current = null;
    setVoiceState("idle");
    setEasierRequests(0);
  }

  useEffect(() => () => stop(), []);

  async function start() {
    stop();
    const currentRun = sessionRun.current;
    setVoiceState("connecting");
    setVoiceError("");
    setCaption("");
    setFootballProgress({ covered: 0, total: progressPointTotal, goal: false });
    goalReported.current = false;
    creditedVoiceWords.current.clear();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot start microphone help.");
      const pc = new RTCPeerConnection();
      peer.current = pc;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioElement.current = audio;
      pc.ontrack = (event) => { audio.srcObject = event.streams[0]; };
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (currentRun !== sessionRun.current) { mediaStream.getTracks().forEach((track) => track.stop()); pc.close(); return; }
      stream.current = mediaStream;
      pc.addTrack(mediaStream.getAudioTracks()[0]);
      const dataChannel = pc.createDataChannel("oai-events");
      channel.current = dataChannel;
      dataChannel.onopen = () => {
        if (currentRun !== sessionRun.current) return;
        setVoiceState("listening");
        dataChannel.send(JSON.stringify({ type: "response.create" }));
      };
      dataChannel.onmessage = (event) => {
        if (currentRun !== sessionRun.current) return;
        try {
          const message = JSON.parse(event.data) as { type?: string; delta?: string; transcript?: string; response?: { output?: Array<{ type?: string; name?: string; call_id?: string; arguments?: string; content?: Array<{ transcript?: string }> }> } };
          const eventType = message.type ?? "";
          if (eventType.includes("audio_transcript.delta") && message.delta) setCaption((current) => current + message.delta);
          if (eventType.includes("audio_transcript.done") && message.transcript) setCaption(message.transcript);
          if (eventType === "output_audio_buffer.started" || eventType.includes("response.audio.delta") || eventType.includes("response.output_audio.delta")) setVoiceState("speaking");
          if (eventType === "output_audio_buffer.stopped") setVoiceState("listening");
          if (eventType === "response.done") {
            const output = message.response?.output ?? [];
            const progressCall = output.find((item) => item.type === "function_call" && item.name === "update_football_progress");
            if (progressCall?.call_id && progressCall.arguments) {
              const progress = JSON.parse(progressCall.arguments) as { covered_points?: number; total_points?: number; complete_answer_spoken?: boolean; goal_scored?: boolean; meaningfully_used_satchel_words?: string[] };
              const total = Math.max(1, Math.min(4, Number(progress.total_points) || progressPointTotal));
              const covered = Math.max(0, Math.min(total, Number(progress.covered_points) || 0));
              const goal = Boolean(progress.goal_scored) && Boolean(progress.complete_answer_spoken) && !writtenGoalRequired && !supportOnly;
              onAttempted?.();
              const allowedWords = new Set(vocabularyTargets.map((item) => item.word));
              const newlyUsedWords = (progress.meaningfully_used_satchel_words ?? []).filter((word) => allowedWords.has(word) && !creditedVoiceWords.current.has(word));
              newlyUsedWords.forEach((word) => creditedVoiceWords.current.add(word));
              if (newlyUsedWords.length) onWordsUsed?.(newlyUsedWords);
              setFootballProgress((current) => ({ covered: Math.max(current.covered, goal ? total : covered), total, goal: current.goal || goal }));
              if (goal && !goalReported.current) {
                goalReported.current = true;
                onGoal?.();
              }
              dataChannel.send(JSON.stringify({
                type: "conversation.item.create",
                item: { type: "function_call_output", call_id: progressCall.call_id, output: JSON.stringify({ progress_updated: true, word_sparks_updated: newlyUsedWords }) },
              }));
              dataChannel.send(JSON.stringify({ type: "response.create", response: { tool_choice: "none" } }));
              setCaption("");
              setVoiceState("thinking");
              return;
            }
            const finalCaption = output.flatMap((item) => item.content ?? []).map((item) => item.transcript ?? "").join(" ").trim();
            if (finalCaption) setCaption(finalCaption);
            setVoiceState("listening");
          }
        } catch {
          // Ignore non-JSON WebRTC events.
        }
      };
      const offer = await pc.createOffer();
      if (currentRun !== sessionRun.current) return;
      await pc.setLocalDescription(offer);
      if (currentRun !== sessionRun.current) return;
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          sdp: offer.sdp,
          mode: "teacher_help",
          language,
          voice: narratorVoice,
          worksheetTitle,
          curriculumText: sourceText,
          currentQuestion: question,
          learnerAttempt,
          currentClue: clue,
          keyPoints,
          homeworkQuestions: preparationTargets,
          satchelWords: vocabularyTargets.slice(0, 8).map((item) => ({ word: item.word, simpleMeaning: item.gloss?.simple ?? "", uses: item.uses ?? 0 })),
          teacherPurpose: purpose,
          goalRequiresWriting: writtenGoalRequired,
          supportOnly,
          classroomCheckpoint,
        }),
      });
      const answerSdp = await response.text();
      if (currentRun !== sessionRun.current) return;
      if (!response.ok) throw new Error("Teacher voice could not start.");
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (caught) {
      if (currentRun !== sessionRun.current) return;
      stop();
      setVoiceState("error");
      setVoiceError(caught instanceof Error ? caught.message : "Teacher voice could not start.");
    }
  }

  useEffect(() => {
    if (!startSignal || handledStartSignal.current === startSignal) return;
    handledStartSignal.current = startSignal;
    void start();
    // startSignal is an explicit one-shot request from the raise-hand control.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  function makeEasier() {
    const dataChannel = channel.current;
    if (!dataChannel || dataChannel.readyState !== "open") return;
    if (voiceState === "speaking") {
      dataChannel.send(JSON.stringify({ type: "response.cancel" }));
    }
    dataChannel.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: "I still do not understand. Move down one support level now. Do not repeat the same question. Use a simpler, more concrete prompt.",
        }],
      },
    }));
    dataChannel.send(JSON.stringify({ type: "response.create" }));
    setEasierRequests((value) => value + 1);
    setVoiceState("adapting");
    setCaption("Making the question easier…");
  }

  async function openCaptionWord(word: string) {
    if (!caption.trim() || captionHelp?.loading) return;
    const autoSave = language === "ta";
    setCaptionHelp({ word, loading: true, saved: autoSave });
    if (autoSave) onDiscover?.(satchelItemFromHelp(word, language));
    try {
      const response = await fetch("/api/worksheets/word-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adultConfirmed, familyId, language, level, word, context: caption.slice(0, 5000) }),
      });
      const help = await responseJson<GlossaryEntry & { error?: string }>(response);
      if (!response.ok || !help.english) throw new Error(help.error || "This caption word could not be explained.");
      const item = satchelItemFromHelp(word, language, help);
      const saved = !contextualHelpNeedsClarification(help);
      if (saved) onDiscover?.(item);
      setCaptionHelp({ word: item.word, loading: false, saved, help });
    } catch (problem) {
      setCaptionHelp({ word, loading: false, saved: autoSave, error: problem instanceof Error ? problem.message : "This caption word could not be explained." });
    }
  }

  return <section className={`teacher-voice-help state-${voiceState}`} aria-label="Teacher voice help">
    <div className="teacher-voice-heading">
      <span aria-hidden="true">◉</span>
      <div><b>{purpose === "backpack_flashcard" ? "Voice Teacher flashcard" : purpose === "assessment_review" ? "Review with the Voice Teacher" : "Voice Teacher"}</b><small>{supportOnly ? "Ask about the word or sentence that was unclear." : classroomCheckpoint ? "The teacher has paused to check understanding." : purpose === "backpack_flashcard" ? "Say what the word means, then use it in your own sentence." : purpose === "assessment_review" ? "Talk about this point together." : purpose === "homework_warmup" ? "This conversation prepares the printed homework question." : purpose === "homework_question" ? writtenGoalRequired ? "Talk it through first. Your written answer takes the final shot." : "Say one complete answer to score; writing comes afterwards." : `Explore this story in ${language === "ta" ? "Tamil" : "Mandarin"}.`}</small></div>
      {voiceState === "error"
        ? <button type="button" onClick={() => void start()}>Try voice again</button>
        : voiceState === "idle"
        ? <button type="button" onClick={() => void start()}>Talk to Voice Teacher</button>
        : <div className="teacher-voice-controls">
            <button type="button" className="make-easier-button" onClick={makeEasier} disabled={voiceState === "adapting"}>{easierRequests ? "Make it even easier" : "Make it easier"}</button>
            <button type="button" className="end-voice-button" onClick={stop}>End</button>
          </div>}
    </div>
    {progressStyle === "review"
      ? <VoiceTeacherReviewProgress covered={footballProgress.covered} total={footballProgress.total} goal={footballProgress.goal} />
      : progressStyle === "word"
      ? <VoiceTeacherWordProgress covered={footballProgress.covered} total={footballProgress.total} goal={footballProgress.goal} />
      : <VoiceTeacherFootballProgress covered={footballProgress.covered} total={footballProgress.total} goal={footballProgress.goal} writtenGoalRequired={writtenGoalRequired} />}
    {voiceState !== "idle" && <div className="teacher-voice-body" aria-live="polite">
      <small>{voiceState === "connecting" ? "Connecting to the teacher…" : voiceState === "thinking" ? "Checking your answer ideas…" : voiceState === "adapting" ? "Teacher is making it simpler…" : voiceState === "speaking" ? "Teacher is speaking…" : voiceState === "listening" ? "Your turn—speak now" : "Voice help needs another try"}</small>
      {caption ? <p className="teacher-caption-tokens" lang={language === "ta" ? "ta" : "zh-Hans"}>{captionTokens.map((token, index) => token.clickable ? <button type="button" key={`${token.start}-${index}`} onClick={() => void openCaptionWord(token.value)}>{token.value}</button> : <span key={`${token.start}-${index}`}>{token.value}</span>)}</p> : <p>{voiceState === "connecting" ? "The first guiding question will appear here." : "Listen, then answer aloud."}</p>}
      {captionHelp && <div className="teacher-caption-help">{captionHelp.loading ? <span>Checking what this means here…</span> : captionHelp.help ? <><b lang={language === "ta" ? "ta" : "zh-Hans"}>{captionHelp.word}</b><p>{captionHelp.help.simple}</p><small>{captionHelp.help.contextual?.pronunciation ? `${captionHelp.help.contextual.pronunciation} · ` : ""}{captionHelp.help.english}</small><em>{captionHelp.saved ? "Saved in your Magic Backpack ✓" : "This can mean different things—ask the Voice Teacher before saving."}</em></> : <span>{captionHelp.error}</span>}<button type="button" onClick={() => setCaptionHelp(null)}>Close</button></div>}
    </div>}
    {voiceError && <p className="teacher-voice-error" role="alert">{voiceError} Check microphone permission and try again.</p>}
    <p className="teacher-voice-privacy">Live microphone audio is used for this conversation and is not saved by Storylight.</p>
  </section>;
}

function RaiseHandButton({ onClick, label = "I have a question" }: { onClick: () => void; label?: string }) {
  return <button type="button" className="raise-hand-button" onClick={onClick}><span aria-hidden="true">✋</span><b>{label}</b><small>Pause and ask the Voice Teacher</small></button>;
}

function BackpackAddedNotice({ word }: { word: string }) {
  if (!word) return null;
  return <div className="backpack-added-toast" role="status"><span>🎒</span><p><b>{word}</b><small>Saved in your Magic Backpack</small></p><strong>✓</strong></div>;
}

function HandwrittenAnswerUpload({
  adultConfirmed,
  familyId,
  language,
  level,
  worksheetTitle,
  sourceText,
  question,
  keyPoints,
  writtenGoalRequired,
  onChecking,
  onResult,
}: {
  adultConfirmed: boolean;
  familyId: string;
  language: Language;
  level: Level;
  worksheetTitle: string;
  sourceText: string;
  question: string;
  keyPoints: string[];
  writtenGoalRequired: boolean;
  onChecking?: (checking: boolean) => void;
  onResult: (result: HandwritingFeedback) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "ready" | "checking" | "done" | "error">("idle");
  const [result, setResult] = useState<HandwritingFeedback | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function chooseFile(nextFile: File | null) {
    if (!nextFile) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(nextFile.type)) {
      setError("Use a JPG, PNG or WEBP photo.");
      setStatus("error");
      return;
    }
    if (nextFile.size > 8 * 1024 * 1024) {
      setError("This photo is over 8 MB. Crop it to the answer and try again.");
      setStatus("error");
      return;
    }
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
    setResult(null);
    setError("");
    setStatus("ready");
  }

  function takeAnotherPhoto() {
    setFile(null);
    setPreviewUrl("");
    setResult(null);
    setError("");
    setStatus("idle");
    if (inputRef.current) inputRef.current.value = "";
    inputRef.current?.click();
  }

  async function checkPhoto() {
    if (!file || status === "checking") return;
    setStatus("checking");
    setError("");
    onChecking?.(true);
    try {
      const form = new FormData();
      form.set("adultConfirmed", String(adultConfirmed));
      form.set("familyId", familyId);
      form.set("language", language);
      form.set("level", level);
      form.set("worksheetTitle", worksheetTitle);
      form.set("sourceText", sourceText);
      form.set("question", question);
      form.set("keyPoints", JSON.stringify(keyPoints));
      form.set("expectedTask", writtenGoalRequired ? "objective_writing" : "open_ended");
      form.set("image", file);
      const response = await fetch("/api/worksheets/check-handwriting", { method: "POST", body: form });
      const checked = await response.json() as HandwritingFeedback & { error?: string };
      if (!response.ok) throw new Error(checked.error || "The written answer could not be checked.");
      setResult(checked);
      setStatus("done");
      onResult(checked);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The written answer could not be checked.");
      setStatus("error");
    } finally {
      onChecking?.(false);
    }
  }

  const unreadable = result?.verdict === "unreadable" || result?.readability === "unreadable";
  const correct = result?.verdict === "correct" && result.accepted_for_progress;

  return <section className={`handwriting-answer ${status} ${correct ? "correct" : ""} ${unreadable ? "unreadable" : ""}`} aria-label="Written homework answer">
    <div className="handwriting-heading">
      <span aria-hidden="true">✎</span>
      <div>
        <b>{writtenGoalRequired ? "Write it to take the shot" : "Finish it on your worksheet"}</b>
        <small>{writtenGoalRequired ? "Write the answer, then photograph only that answer to score." : "After speaking, you can add a written-answer tick."}</small>
      </div>
    </div>
    <input ref={inputRef} className="handwriting-file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
    {!file ? <button type="button" className="photo-answer-button" onClick={() => inputRef.current?.click()}><span aria-hidden="true">▣</span> Photograph my answer</button> : <div className="handwriting-preview">
      <img src={previewUrl} alt="Preview of the photographed written answer" />
      <div>
        <button type="button" className="back-button" disabled={status === "checking"} onClick={takeAnotherPhoto}>Take another</button>
        <button type="button" className="primary-button" disabled={status === "checking" || correct} onClick={() => void checkPhoto()}>{status === "checking" ? "Reading your handwriting…" : correct ? "Written answer checked ✓" : "Check written answer"}</button>
      </div>
    </div>}
    {status === "checking" && <p className="handwriting-loading" role="status"><span aria-hidden="true">⚽</span><b>Reading your handwriting…</b><small>The photo is being checked now. No need to press again.</small></p>}
    {result && <div className={`handwriting-result ${result.verdict}`} role="status">
      <span aria-hidden="true">{correct ? "✓" : unreadable ? "↻" : "○"}</span>
      <div>
        <b>{correct ? writtenGoalRequired ? "GOOOAL! Written answer complete." : "Written answer complete ✓" : unreadable ? "I could not read this clearly." : result.verdict === "partly_correct" ? "One idea still needs work." : "Try this written answer again."}</b>
        {result.transcription && !unreadable && <small lang={language === "ta" ? "ta" : "zh-Hans"}>{language === "ta" ? "நான் படித்தது:" : "我读到："} {result.transcription}</small>}
        {result.feedback && <p lang={language === "ta" ? "ta" : "zh-Hans"}>{result.feedback}</p>}
        {!correct && <button type="button" onClick={takeAnotherPhoto}>{unreadable ? "Take a clearer photo" : "Try another photo"}</button>}
      </div>
    </div>}
    {error && <p className="handwriting-error" role="alert">{error}</p>}
    <p className="handwriting-privacy">Crop to this answer only—no names, faces or school details. The photo is checked and discarded.</p>
  </section>;
}

function OpenEndedFootballProgress({
  feedback,
  keyPointCount,
}: {
  feedback: SpeechFeedback;
  keyPointCount: number;
}) {
  const reportedTotal = Number.isFinite(feedback.key_points_total) ? Number(feedback.key_points_total) : 0;
  const total = Math.max(1, reportedTotal || keyPointCount || 2);
  const reportedCovered = Number.isFinite(feedback.key_points_covered) ? Number(feedback.key_points_covered) : 0;
  const fallbackCovered = feedback.verdict === "correct" ? total : feedback.verdict === "partly_correct" ? 1 : 0;
  const covered = Math.max(0, Math.min(total, reportedCovered || fallbackCovered));
  const goal = feedback.verdict === "correct" && feedback.accepted_for_progress;
  const displayCovered = goal ? total : covered;
  const progress = displayCovered / total;
  const ballPosition = 8 + progress * 76;

  return <section className={`open-answer-football ${goal ? "goal-scored" : ""}`} aria-label={`Answer progress: ${displayCovered} of ${total} ideas connected`}>
    <div className="open-answer-pitch" aria-hidden="true">
      <span className="pitch-start-line" />
      <span className="answer-ball" style={{ left: `${ballPosition}%` }}>⚽</span>
      <span className="answer-goal"><i /><i /><i /></span>
    </div>
    <div className="open-answer-score">
      <small>{displayCovered} of {total} answer ideas connected</small>
      <b>{goal ? "GOOOAL!" : displayCovered > 0 ? "Your ball is getting closer!" : "Build your answer"}</b>
      <p>{goal ? "You connected the important ideas." : "Each relevant idea moves the ball towards goal."}</p>
    </div>
  </section>;
}

function SpeechTurn({
  adultConfirmed,
  familyId,
  story,
  beat,
  language,
  level,
  kind = "question",
  targetWords,
  onWordsUsed,
  onSaved,
  onAttemptStarted,
  onAttemptFinished,
  guidedReasoning = false,
  hiddenKeyPoints = [],
  exerciseEntry = false,
  initialTranscript = "",
  initialFeedback = null,
  initialAiEvaluated = false,
  narrationStatus = "idle",
  activeSpeechText = "",
  onSpeakHelp,
}: {
  adultConfirmed: boolean;
  familyId: string;
  story: Story;
  beat: Beat;
  language: Language;
  level: Level;
  kind?: "question" | "ending";
  targetWords: string[];
  onWordsUsed: (words: string[]) => void;
  onSaved?: (value: { id: string; transcript: string; feedback: SpeechFeedback; aiEvaluated: boolean }) => void;
  onAttemptStarted?: (transcript: string) => void;
  onAttemptFinished?: (checked: boolean) => void;
  guidedReasoning?: boolean;
  hiddenKeyPoints?: string[];
  exerciseEntry?: boolean;
  initialTranscript?: string;
  initialFeedback?: SpeechFeedback | null;
  initialAiEvaluated?: boolean;
  narrationStatus?: "idle" | "loading" | "playing";
  activeSpeechText?: string;
  onSpeakHelp?: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState(initialTranscript);
  const [feedback, setFeedback] = useState<SpeechFeedback | null>(initialFeedback);
  const [aiEvaluated, setAiEvaluated] = useState(initialAiEvaluated);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [journalSaved, setJournalSaved] = useState(false);
  const [saveWarning, setSaveWarning] = useState("");
  const [attempt, setAttempt] = useState(1);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function stopRecording() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function transcribeRecording(blob: Blob) {
    if (!blob.size) {
      setError("No audio was captured. Please allow microphone access and try again.");
      return;
    }
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, blob.type.includes("mp4") ? "answer.m4a" : "answer.webm");
      form.append("adultConfirmed", String(adultConfirmed));
      form.append("language", language);
      form.append("storyContext", beat.text);
      form.append("targetWords", targetWords.join("\n"));
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const result = (await response.json()) as { transcript?: string; error?: string };
      if (!response.ok || !result.transcript) throw new Error(result.error ?? "The recording could not be transcribed.");
      setTranscript(result.transcript);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recording could not be transcribed.");
    } finally {
      setTranscribing(false);
    }
  }

  async function beginListening() {
    setFeedback(null);
    setError("");
    if (recording) {
      stopRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio here. You can still type a dummy learner response below.");
      return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = nextStream;
      const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const nextRecorder = preferredType
        ? new MediaRecorder(nextStream, { mimeType: preferredType })
        : new MediaRecorder(nextStream);
      chunks.current = [];
      nextRecorder.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      nextRecorder.onerror = () => {
        setRecording(false);
        setError("The recording stopped unexpectedly. Please try once more.");
      };
      nextRecorder.onstop = () => {
        setRecording(false);
        nextStream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: nextRecorder.mimeType || "audio/webm" });
        void transcribeRecording(blob);
      };
      recorder.current = nextRecorder;
      setRecording(true);
      nextRecorder.start();
    } catch {
      setError("Microphone access was not available. Allow it in your browser, or type a dummy learner response below.");
    }
  }

  async function submitResponse() {
    const clean = transcript.trim();
    if (!clean) {
      setError("Please say an answer first. The words will appear here as you speak.");
      return;
    }
    onAttemptStarted?.(clean);
    setSaving(true);
    setError("");
    setSaveWarning("");
    let checked = false;
    try {
      const response = await fetch("/api/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          storyTitle: story.title,
          beatId: beat.id,
          language,
          level,
          kind,
          prompt: beat.question?.prompt ?? "Narrate your ending to the story.",
          storyContext: beat.text,
          transcript: clean,
          targetWords,
          attempt,
          answerPolicy: guidedReasoning ? "guided_reasoning" : "language",
          keyPoints: guidedReasoning ? hiddenKeyPoints : [],
        }),
      });
      const result = (await response.json()) as {
        id?: string;
        feedback?: SpeechFeedback;
        aiEvaluated?: boolean;
        saved?: boolean;
        saveWarning?: string;
        error?: string;
      };
      if (!response.ok || !result.id || !result.feedback) throw new Error(result.error ?? "Your answer could not be saved.");
      setFeedback(result.feedback);
      setAiEvaluated(Boolean(result.aiEvaluated));
      setJournalSaved(Boolean(result.saved));
      setSaveWarning(result.saveWarning ?? "");
      checked = Boolean(result.aiEvaluated);
      onWordsUsed(result.feedback.used_words);
      onSaved?.({ id: result.id, transcript: clean, feedback: result.feedback, aiEvaluated: Boolean(result.aiEvaluated) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your answer could not be saved.");
    } finally {
      setSaving(false);
      onAttemptFinished?.(checked);
    }
  }

  function tryAgain() {
    setAttempt((value) => value + 1);
    setTranscript("");
    setFeedback(null);
    setAiEvaluated(false);
    setError("");
    setJournalSaved(false);
    setSaveWarning("");
  }

  const relevanceLabel = feedback?.language_status === "wrong_language"
    ? `Try this one in ${language === "ta" ? "Tamil" : "Mandarin"}`
    : feedback?.language_status === "gibberish"
      ? "That was not a usable answer"
      : feedback?.language_status === "mixed"
        ? `Use more ${language === "ta" ? "Tamil" : "Mandarin"}`
        : feedback?.relevance === "relevant"
          ? "You answered the question"
    : feedback?.relevance === "partly_relevant"
      ? "Your idea is partly connected"
      : feedback?.relevance === "not_relevant"
        ? "Let’s connect it to the question"
        : "Not checked yet";
  const verdictLabel = feedback?.verdict === "correct"
    ? "Correct"
    : feedback?.verdict === "partly_correct"
      ? "Partly correct"
      : feedback?.verdict === "incorrect"
        ? "Not correct yet"
        : "Not checked";
  const currentClue = feedback ? (feedback.retry_prompt || feedback.encouragement) : "";
  const clueAudioActive = Boolean(currentClue && activeSpeechText === currentClue && narrationStatus !== "idle");

  return (
    <div className={`speech-turn ${kind === "ending" ? "ending-speech-turn" : ""} ${exerciseEntry ? "worksheet-answer-turn" : ""}`}>
      {exerciseEntry ? (
        <>
          <div className="transcript-card worksheet-answer-entry">
            <span><b>Your answer</b><small>Type in {language === "ta" ? "Tamil" : "Mandarin"}, or use the microphone.</small></span>
            <div className="worksheet-answer-input-row">
              <textarea
                aria-label={`Your answer in ${language === "ta" ? "Tamil" : "Mandarin"}`}
                value={transcript}
                onChange={(event) => {
                  setTranscript(event.target.value);
                  setFeedback(null);
                  setAiEvaluated(false);
                  setJournalSaved(false);
                  setSaveWarning("");
                  setError("");
                }}
                placeholder={language === "ta" ? "உங்கள் பதிலை இங்கே எழுதுங்கள்…" : "在这里写下你的答案……"}
                rows={3}
              />
              <button className={`mic-button worksheet-mic-button ${recording ? "listening" : ""}`} onClick={beginListening} aria-pressed={recording} disabled={transcribing} type="button">
                <span>{recording ? "■" : transcribing ? "…" : "●"}</span>
                {recording ? "Stop & transcribe" : transcribing ? "Transcribing" : "Record"}
              </button>
            </div>
          </div>
          <div className="speech-actions worksheet-answer-actions">
            <p><span>◉</span> Audio is transcribed, then discarded.</p>
            <button className="coach-button" onClick={submitResponse} disabled={saving || transcribing || !transcript.trim()}>
              {saving ? "Checking…" : "Check answer"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="speech-invite">
            <div>
              <span className="speech-step">1 · Speak</span>
              <h3>{kind === "ending" ? "Tell the ending you can see in your mind" : guidedReasoning ? "Think it through aloud" : "Answer in your own words"}</h3>
              <p>{guidedReasoning ? `Think in any language if you need to, but say the answer in ${language === "ta" ? "Tamil" : "Mandarin"}. Storylight will nudge without revealing it.` : "Try to use one glowing story word. That is how a discovered word becomes yours."}</p>
            </div>
            <button className={`mic-button ${recording ? "listening" : ""}`} onClick={beginListening} aria-pressed={recording} disabled={transcribing}>
              <span>{recording ? "■" : transcribing ? "…" : "●"}</span>
              {recording ? "Stop & transcribe" : transcribing ? "Transcribing" : "Record answer"}
            </button>
          </div>

          <label className="transcript-card">
            <span><b>2 · OpenAI transcript</b><small>Correct only obvious transcription errors before saving.</small></span>
            <textarea
              value={transcript}
              onChange={(event) => {
                setTranscript(event.target.value);
                setFeedback(null);
                setAiEvaluated(false);
                setJournalSaved(false);
                setSaveWarning("");
                setError("");
              }}
              placeholder={language === "ta" ? "உங்கள் சோதனைப் பதில் இங்கே தோன்றும்…" : "你的测试回答会出现在这里……"}
              rows={kind === "ending" ? 5 : 3}
            />
          </label>

          <div className="speech-actions">
            <p><span>◉</span> The recording is sent for transcription, then discarded. Only text feedback is saved.</p>
            <button className="coach-button" onClick={submitResponse} disabled={saving || transcribing || !transcript.trim()}>
              {saving ? "Checking the response…" : kind === "ending" ? "Check & save ending" : `Check my ${language === "ta" ? "Tamil" : "Mandarin"} answer`}
            </button>
          </div>
        </>
      )}
      {error && <p className="speech-error" role="alert">{error}</p>}

      {feedback && guidedReasoning && (
        <div className={`coach-feedback guided-coach-feedback ${feedback.should_retry ? "needs-retry" : ""}`}>
          <div className={`answer-verdict verdict-${feedback.verdict}`} role="status">
            <span>{feedback.verdict === "correct" ? "✓" : feedback.verdict === "partly_correct" ? "◐" : "↺"}</span>
            <p><small>Answer check</small><b>{feedback.verdict === "correct" ? "Well done!" : feedback.verdict === "partly_correct" ? "Almost there" : "Try again"}</b></p>
          </div>
          {aiEvaluated && <OpenEndedFootballProgress feedback={feedback} keyPointCount={hiddenKeyPoints.length} />}
          {aiEvaluated ? feedback.verdict === "correct" && feedback.accepted_for_progress ? (
            <p className="guided-success-message" lang={language === "ta" ? "ta" : "zh-Hans"}>{feedback.encouragement}</p>
          ) : (
            <div className="guided-next-step">
              <div className="guided-clue-heading">
                <small>One clue</small>
                {onSpeakHelp && <button type="button" onClick={() => onSpeakHelp(currentClue)} disabled={clueAudioActive} aria-busy={clueAudioActive}>
                  <span>{narrationStatus === "loading" && clueAudioActive ? "…" : clueAudioActive ? "Ⅱ" : "▶"}</span>
                  {narrationStatus === "loading" && clueAudioActive ? "Preparing clue…" : clueAudioActive ? "Playing clue" : "Hear this clue"}
                </button>}
              </div>
              <p lang={language === "ta" ? "ta" : "zh-Hans"}>{feedback.retry_prompt || feedback.encouragement}</p>
            </div>
          ) : (
            <div className="coach-pending"><b>No pretend assessment.</b> {feedback.parent_note}</div>
          )}
          {saveWarning && <p className="journal-save-warning"><b>Your feedback is still available.</b> {saveWarning}</p>}
          {feedback.should_retry && <div className="retry-row guided-retry-row"><button onClick={tryAgain}>Try again</button></div>}
        </div>
      )}

      {feedback && !guidedReasoning && (
        <div className={`coach-feedback ${feedback.should_retry ? "needs-retry" : ""}`}>
          <div className={`answer-verdict verdict-${feedback.verdict}`} role="status">
            <span>{feedback.verdict === "correct" ? "✓" : feedback.verdict === "partly_correct" ? "◐" : "↺"}</span>
            <p><small>Answer check</small><b>{verdictLabel}</b></p>
          </div>
          <div className="coach-feedback-top">
            <span className={`relevance-chip relevance-${feedback.relevance}`}>{relevanceLabel}</span>
            <span className={`progress-chip ${feedback.accepted_for_progress ? "accepted" : "waiting"}`}>{feedback.accepted_for_progress ? "✓ Part completed" : "○ Part still waiting"}</span>
            <span className={`saved-chip ${journalSaved ? "" : "not-saved"}`}>{journalSaved ? "Saved to the QA journal" : "Checked · journal retry needed"}</span>
          </div>
          <p className="coach-encouragement" lang={language === "ta" ? "ta" : "zh-Hans"}>{feedback.encouragement}</p>
          {saveWarning && <p className="journal-save-warning"><b>Your feedback is still available.</b> {saveWarning}</p>}

          {aiEvaluated && !guidedReasoning ? (
            <div className="correction-compare">
              <div><small>You said</small><p>{transcript}</p></div>
              <div className="clearer-version"><small>{feedback.corrected_response === transcript ? "Clear as spoken" : "A clearer way"}</small><p>{feedback.corrected_response}</p></div>
            </div>
          ) : !aiEvaluated ? (
            <div className="coach-pending"><b>No pretend assessment.</b> {feedback.parent_note}</div>
          ) : null}

          {aiEvaluated && <p className="parent-note"><b>{guidedReasoning ? "Thinking nudge:" : "QA note:"}</b> {feedback.parent_note}</p>}
          {aiEvaluated && !guidedReasoning && feedback.story_evidence && (
            <div className="answer-evidence"><small>Story clue used for this check</small><p lang={language === "ta" ? "ta" : "zh-Hans"}>{feedback.story_evidence}</p></div>
          )}
          {aiEvaluated && !guidedReasoning && feedback.reference_answer && (
            <div className="reference-answer"><small>One answer to compare with</small><p lang={language === "ta" ? "ta" : "zh-Hans"}>{feedback.reference_answer}</p><span>Your wording can be different if it has the same supported idea.</span></div>
          )}
          {aiEvaluated && !guidedReasoning && feedback.word_evidence.length > 0 && (
            <div className="word-use-check"><small>Word Lantern check</small>{feedback.word_evidence.map((item) => (
              <div key={item.target_word} className={item.meaningful_use ? "word-use-pass" : "word-use-waiting"}>
                <b>{item.meaningful_use ? "✦" : "◇"} {item.target_word}</b>
                <span>{item.meaningful_use ? `Used meaningfully${item.matched_form ? ` as “${item.matched_form}”` : ""}` : item.used ? "The word was present, but did not fit the meaning yet" : "Not used in this answer"}</span>
              </div>
            ))}</div>
          )}
          {!!feedback.used_words.length && (
            <div className="word-sparks"><span>✦ Word spark earned</span>{feedback.used_words.map((word) => <b key={word}>{word}</b>)}</div>
          )}
          {(feedback.should_retry || kind === "question") && (
            <div className="retry-row">
              {feedback.retry_prompt && <p lang={language === "ta" ? "ta" : "zh-Hans"}>{feedback.retry_prompt}</p>}
              <button onClick={tryAgain}>Say it another way</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EndingStudio({
  adultConfirmed,
  familyId,
  language,
  level,
  story,
  beat,
  targetWords,
  onWordsUsed,
  onJournalChange,
}: {
  adultConfirmed: boolean;
  familyId: string;
  language: Language;
  level: Level;
  story: Story;
  beat: Beat;
  targetWords: string[];
  onWordsUsed: (words: string[]) => void;
  onJournalChange: () => void;
}) {
  const [ending, setEnding] = useState<{ id: string; transcript: string } | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  async function generateIllustration() {
    if (!ending) return;
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/illustrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          responseId: ending.id,
          storyTitle: story.title,
          language,
          level,
          narration: ending.transcript,
        }),
      });
      const result = (await response.json()) as { imageUrl?: string; error?: string };
      if (!response.ok || !result.imageUrl) throw new Error(result.error ?? "The illustration could not be created.");
      setImageUrl(`${result.imageUrl}&v=${Date.now()}`);
      onJournalChange();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The illustration could not be created.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <section className="ending-studio" aria-labelledby="ending-title">
      <div className="ending-heading">
        <div>
          <p className="overline">The story stops here. Yours begins.</p>
          <h2 id="ending-title">Tell the ending. Watch it become art.</h2>
        </div>
        <span className="ending-badge">Your idea leads</span>
      </div>

      <SpeechTurn
        adultConfirmed={adultConfirmed}
        familyId={familyId}
        story={story}
        beat={beat}
        language={language}
        level={level}
        kind="ending"
        targetWords={targetWords}
        onWordsUsed={onWordsUsed}
        onSaved={({ id, transcript }) => {
          setEnding({ id, transcript });
          setImageUrl("");
          onJournalChange();
        }}
      />

      <div className="illustration-studio">
        {imageUrl ? (
          <figure className="generated-ending">
            <img src={imageUrl} alt="An illustrated scene generated from the adult tester's narrated ending" />
            <figcaption>This QA image began with the tester’s simulated ending.</figcaption>
          </figure>
        ) : (
          <div className="illustration-placeholder">
            <span>✦</span>
            <h3>The wonder canvas</h3>
            <p>Save the spoken ending, then the illustration agent will turn that idea into one rich storybook scene.</p>
          </div>
        )}
        <button className="generate-button" onClick={generateIllustration} disabled={!ending || generating}>
          {generating ? "Painting the simulated ending…" : imageUrl ? "Paint another version" : "Turn the ending into a picture"}
        </button>
        {error && <p className="speech-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function JournalPanel({ familyId, refreshToken, onClose }: { familyId: string; refreshToken: number; onClose: () => void }) {
  const [items, setItems] = useState<SavedResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/responses?familyId=${encodeURIComponent(familyId)}&adultConfirmed=true`)
      .then(async (response) => {
        const result = (await response.json()) as { responses?: SavedResponse[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "The journal could not be opened.");
        if (active) setItems(result.responses ?? []);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "The journal could not be opened."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [familyId, refreshToken]);

  return (
    <div className="journal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="journal-sheet" role="dialog" aria-modal="true" aria-labelledby="journal-title">
        <button className="close-word" onClick={onClose} aria-label="Close QA journal">×</button>
        <p className="overline">Adult QA session</p>
        <h2 id="journal-title">The response journal</h2>
        <p className="journal-intro">The tester’s exact transcript stays beside the AI correction and relevance feedback. Audio is not stored by Storylight.</p>
        {loading && <div className="journal-empty">Opening the journal…</div>}
        {error && <p className="speech-error">{error}</p>}
        {!loading && !error && !items.length && <div className="journal-empty">Your adult test responses will gather here.</div>}
        <div className="journal-list">
          {items.map((item) => (
            <article className="journal-entry" key={item.id}>
              <div className="journal-meta">
                <span>{item.language === "ta" ? "Tamil" : "Mandarin"} · {item.level}</span>
                <time>{new Date(`${item.createdAt}Z`).toLocaleString()}</time>
              </div>
              <h3>{item.kind === "ending" ? "Simulated learner ending" : item.prompt}</h3>
              <div className="journal-words"><small>Tester’s exact transcript</small><p>{item.originalResponse}</p></div>
              {item.aiEvaluated && (
                <div className="journal-words correction"><small>Gentle correction</small><p>{item.correctedResponse}</p><span>{item.parentNote}</span></div>
              )}
              {!item.aiEvaluated && <p className="journal-pending">Saved without an invented judgement; language-coach connection pending.</p>}
              {!!item.usedWords.length && <div className="word-sparks"><span>✦ Used from the backpack</span>{item.usedWords.map((word) => <b key={word}>{word}</b>)}</div>}
              {item.imageUrl && <img className="journal-image" src={item.imageUrl} alt="Generated illustration of the tester's simulated ending" />}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

type WordSentenceResult = {
  verdict: "makes_sense" | "almost" | "does_not_make_sense";
  used_target_word: boolean;
  matched_form: string;
  feedback: string;
  corrected_sentence: string;
  english_meaning: string;
};

function SatchelSentencePractice({
  active,
  adultConfirmed,
  familyId,
  onMastered,
}: {
  active: SatchelItem;
  adultConfirmed: boolean;
  familyId: string;
  onMastered: (item: SatchelItem) => void;
}) {
  const [sentence, setSentence] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<WordSentenceResult | null>(null);
  const [error, setError] = useState("");
  const [credited, setCredited] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function transcribeSentence(blob: Blob) {
    if (!blob.size) {
      setError("No audio was captured. Please allow microphone access and try again.");
      return;
    }
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, blob.type.includes("mp4") ? "word-sentence.m4a" : "word-sentence.webm");
      form.append("adultConfirmed", String(adultConfirmed));
      form.append("language", active.language);
      form.append("storyContext", active.gloss?.sentence ?? active.word);
      form.append("targetWords", active.word);
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await responseJson<{ transcript?: string; error?: string }>(response);
      if (!response.ok || !data.transcript) throw new Error(data.error || "The sentence could not be transcribed.");
      setSentence(data.transcript);
      setResult(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The sentence could not be transcribed.");
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleRecording() {
    setError("");
    setResult(null);
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is unavailable here. Type a test sentence below instead.");
      return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = nextStream;
      const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const nextRecorder = preferredType ? new MediaRecorder(nextStream, { mimeType: preferredType }) : new MediaRecorder(nextStream);
      chunks.current = [];
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onstop = () => {
        setRecording(false);
        nextStream.getTracks().forEach((track) => track.stop());
        void transcribeSentence(new Blob(chunks.current, { type: nextRecorder.mimeType || "audio/webm" }));
      };
      nextRecorder.onerror = () => { setRecording(false); setError("The recording stopped unexpectedly. Please try again."); };
      recorder.current = nextRecorder;
      setRecording(true);
      nextRecorder.start();
    } catch {
      setError("Allow microphone access, or type a test sentence below.");
    }
  }

  async function checkSentence() {
    const clean = sentence.trim();
    if (!clean) return;
    setChecking(true);
    setError("");
    try {
      const response = await fetch("/api/words/check-sentence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          language: active.language,
          word: active.word,
          sentence: clean,
          contextSentence: active.gloss?.sentence ?? "",
          simpleMeaning: active.gloss?.simple ?? "",
          englishMeaning: active.gloss?.english ?? "",
        }),
      });
      const data = await responseJson<WordSentenceResult & { error?: string }>(response);
      if (!response.ok || !data.verdict) throw new Error(data.error || "The sentence could not be checked.");
      setResult(data);
      if (data.verdict === "makes_sense" && data.used_target_word && !credited) {
        setCredited(true);
        onMastered(active);
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The sentence could not be checked.");
    } finally {
      setChecking(false);
    }
  }

  return <div className="satchel-practice">
    <div className="satchel-practice-heading"><small>Say-a-sentence challenge</small><b>Use “{active.word}” in a sentence that makes sense.</b></div>
    <button className={`satchel-record ${recording ? "recording" : ""}`} onClick={toggleRecording} disabled={transcribing}>
      <span>{recording ? "■" : transcribing ? "…" : "●"}</span>{recording ? "Stop & transcribe" : transcribing ? "Transcribing…" : "Record my sentence"}
    </button>
    <label><span>Transcript (editable for obvious transcription errors)</span><textarea rows={3} value={sentence} onChange={(event) => { setSentence(event.target.value); setResult(null); setCredited(false); }} placeholder={active.language === "ta" ? `“${active.word}” உள்ள ஒரு வாக்கியம் சொல்லுங்கள்…` : `说一个包含“${active.word}”的句子……`} /></label>
    <button className="check-satchel-sentence" onClick={checkSentence} disabled={!sentence.trim() || checking || transcribing || !familyId}>{checking ? "Checking meaning…" : "Check whether my sentence makes sense"}</button>
    {error && <p className="satchel-practice-error" role="alert">{error}</p>}
    {result && <div className={`satchel-sentence-result result-${result.verdict}`} role="status">
      <b>{result.verdict === "makes_sense" && result.used_target_word ? "✓ Meaningful use counted" : result.verdict === "almost" ? "◐ Almost there" : "↺ Try a new sentence"}</b>
      <p>{result.feedback}</p>
      {result.matched_form && <small>Word form heard: {result.matched_form}</small>}
      {result.corrected_sentence && result.corrected_sentence !== sentence && <div><small>A clearer sentence</small><p lang={active.language === "ta" ? "ta" : "zh-Hans"}>{result.corrected_sentence}</p></div>}
      {result.english_meaning && <div><small>What your sentence means</small><p>{result.english_meaning}</p></div>}
    </div>}
  </div>;
}

function WordConstructionCard({ construction, language }: { construction?: WordConstruction; language: Language }) {
  if (!construction) return null;
  const isTamilFamily = construction.kind === "tamil_word_family";
  const isMandarinCompound = construction.kind === "mandarin_compound";
  return <section className="word-construction" aria-label="How this word is built">
    <div className="word-construction-heading">
      <small>{construction.kind === "whole_word" ? "Remember it as one word" : isTamilFamily ? "Build this Tamil word" : "Build this Mandarin word"}</small>
      <b>{construction.kind === "whole_word" ? "Learn the whole word, then meet it again." : isTamilFamily ? "Base word + useful ending" : "Characters and compound meaning"}</b>
    </div>
    <div className="word-parts" lang={language === "ta" ? "ta" : "zh-Hans"}>
      {construction.parts.map((part, index) => <div className="word-part-wrap" key={`${part.form}-${index}`}>
        {index > 0 && <span className="word-part-plus" aria-hidden="true">+</span>}
        <article className="word-part">
          <strong>{part.form}</strong>
          {part.pronunciation && <em>{part.pronunciation}</em>}
          <small>{part.meaning}</small>
        </article>
      </div>)}
    </div>
    {construction.related_forms.length > 0 && <div className="word-family">
      <small>{isMandarinCompound ? "Common combinations" : isTamilFamily ? "Word family" : "Meet it again"}</small>
      <div>{construction.related_forms.map((form, index) => <span key={`${form.form}-${index}`} lang={language === "ta" ? "ta" : "zh-Hans"}><b>{form.form}</b>{form.pronunciation && <em>{form.pronunciation}</em>}<small>{form.meaning}</small></span>)}</div>
    </div>}
  </section>;
}

function MagicSatchelPanel({
  items,
  onClose,
  onSpeak,
  adultConfirmed,
  familyId,
  narratorVoice,
  voiceStatus,
  activeSpeechText,
  onMastered,
  onSave,
  demoContext,
}: {
  items: SatchelItem[];
  onClose: () => void;
  onSpeak: (text: string, language: Language) => void;
  adultConfirmed: boolean;
  familyId: string;
  narratorVoice: NarratorVoice;
  voiceStatus: "idle" | "loading" | "playing" | "paused";
  activeSpeechText?: string;
  onMastered: (item: SatchelItem) => void;
  onSave: (item: SatchelItem) => void;
  demoContext: BackpackStoryContext;
}) {
  const uniqueItems = items.filter((item, index) => items.findIndex((candidate) => sameSatchelItem(candidate, item)) === index);
  const [language, setLanguage] = useState<Language>(uniqueItems[0]?.language ?? demoContext.language);
  const [sort, setSort] = useState<"needs_practice" | "mastered_first" | "newest" | "oldest">("needs_practice");
  const [mode, setMode] = useState<"browse" | "practice">("browse");
  const [activeKey, setActiveKey] = useState("");
  const [rung, setRung] = useState(0);
  const [practiceItems, setPracticeItems] = useState<SatchelItem[]>([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceIsDemo, setPracticeIsDemo] = useState(false);
  const [practiceComplete, setPracticeComplete] = useState(false);
  const [completedPracticeWords, setCompletedPracticeWords] = useState<string[]>([]);
  const [practiceStartSignal, setPracticeStartSignal] = useState(0);
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading" | "error">("idle");
  const [demoError, setDemoError] = useState("");
  const languageItems = uniqueItems.filter((item) => item.language === language);
  const sortedItems = [...languageItems].sort((left, right) => {
    const leftUses = left.uses ?? 0;
    const rightUses = right.uses ?? 0;
    if (sort === "needs_practice") return leftUses - rightUses || (right.savedAt ?? 0) - (left.savedAt ?? 0);
    if (sort === "mastered_first") return rightUses - leftUses || (right.savedAt ?? 0) - (left.savedAt ?? 0);
    if (sort === "oldest") return (left.savedAt ?? 0) - (right.savedAt ?? 0);
    return (right.savedAt ?? 0) - (left.savedAt ?? 0);
  });
  const active = sortedItems.find((item) => satchelItemKey(item) === activeKey) ?? sortedItems[0];
  const activeGlossary = active?.language === "ta" ? tamilGlossary : mandarinGlossary;
  const entry = active ? active.gloss ?? activeGlossary[active.word] : undefined;
  const meaningfulUses = active?.uses ?? 0;
  const mastered = meaningfulUses >= 3;
  const practiceItem = practiceItems[practiceIndex];
  const practiceSaved = Boolean(practiceItem && items.some((item) => sameSatchelItem(item, practiceItem)));

  function selectWord(item: SatchelItem) {
    setActiveKey(satchelItemKey(item));
    setRung(0);
  }

  async function startPractice() {
    setMode("practice");
    setPracticeIndex(0);
    setPracticeComplete(false);
    setCompletedPracticeWords([]);
    setDemoError("");
    if (languageItems.length) {
      setPracticeIsDemo(false);
      setPracticeItems([...languageItems].sort((left, right) => (left.uses ?? 0) - (right.uses ?? 0) || (right.savedAt ?? 0) - (left.savedAt ?? 0)).slice(0, 5));
      setPracticeStartSignal((current) => current + 1);
      return;
    }
    setPracticeIsDemo(true);
    setDemoStatus("loading");
    try {
      const response = await fetch("/api/words/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          language: demoContext.language,
          level: demoContext.level,
          title: demoContext.title,
          sourceText: demoContext.text,
        }),
      });
      const result = await responseJson<{ words?: Array<{ word: string; sentence: string; simple: string; english: string; construction: WordConstruction; contextual?: ContextualWordInfo }>; error?: string }>(response);
      if (!response.ok || !result.words?.length) throw new Error(result.error || "The story words could not be prepared.");
      const demoWords = result.words.map((item) => ({
        word: item.word,
        language: demoContext.language,
        uses: 0,
        gloss: { sentence: item.sentence, simple: item.simple, english: item.english, construction: item.construction, contextual: item.contextual },
        senseKey: demoContext.language === "zh" ? `${item.contextual?.canonical_form || item.word}\u241f${item.contextual?.meaning_here || item.english}` : item.word,
        sourceSentence: item.contextual?.source_sentence,
      }));
      setLanguage(demoContext.language);
      setPracticeItems(demoWords);
      setPracticeStartSignal((current) => current + 1);
      setDemoStatus("idle");
    } catch (problem) {
      setDemoStatus("error");
      setDemoError(problem instanceof Error ? problem.message : "The five-word demo is unavailable right now.");
    }
  }

  function completePracticeWord(item: SatchelItem) {
    const key = satchelItemKey(item);
    setCompletedPracticeWords((current) => current.includes(key) ? current : [...current, key]);
  }

  function nextPracticeWord() {
    if (practiceIndex >= practiceItems.length - 1) {
      setPracticeComplete(true);
      return;
    }
    setPracticeIndex((value) => value + 1);
  }

  return (
    <div className="satchel-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="satchel-sheet" role="dialog" aria-modal="true" aria-labelledby="satchel-title">
        <button className="close-word" onClick={onClose} aria-label="Close Magic Backpack">×</button>
        <p className="overline">Your growing word collection</p>
        <h2 id="satchel-title">The Magic Backpack</h2>
        <p className="satchel-intro">Collect useful words, see how they are built, and practise using them aloud with the Voice Teacher.</p>

        <div className="backpack-mode-tabs" role="tablist" aria-label="Magic Backpack activities">
          <button className={mode === "browse" ? "active" : ""} onClick={() => setMode("browse")}>My words</button>
          <button className={mode === "practice" ? "active" : ""} onClick={() => void startPractice()}>Practise with Voice Teacher</button>
        </div>

        {mode === "browse" && !uniqueItems.length && <div className="empty-satchel">
          <span>🎒</span>
          <h3>See how your Backpack works</h3>
          <p>Try five useful words chosen from “{demoContext.title}”. Save only the words you want to keep.</p>
          <button className="backpack-demo-button" onClick={() => void startPractice()}>Try the 5-word story demo <span>→</span></button>
        </div>}

        {mode === "browse" && uniqueItems.length > 0 && <>
          <div className="backpack-controls">
            <div className="backpack-language-tabs" aria-label="Word language">
              <button className={language === "ta" ? "active" : ""} onClick={() => { setLanguage("ta"); setActiveKey(""); }}>Tamil <span>{uniqueItems.filter((item) => item.language === "ta").length}</span></button>
              <button className={language === "zh" ? "active" : ""} onClick={() => { setLanguage("zh"); setActiveKey(""); }}>Mandarin <span>{uniqueItems.filter((item) => item.language === "zh").length}</span></button>
            </div>
            <label>Show first<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="needs_practice">Needs practice</option><option value="mastered_first">Mastered</option><option value="newest">Newest saved</option><option value="oldest">Oldest saved</option></select></label>
          </div>
          {!sortedItems.length ? <div className="backpack-language-empty"><p>No {language === "ta" ? "Tamil" : "Mandarin"} words saved yet.</p><button onClick={() => void startPractice()}>Try a story-word demo</button></div> : <div className="backpack-browser">
            <div className="backpack-word-list" role="list" aria-label="Saved words">
              {sortedItems.map((item) => {
                const itemEntry = item.gloss ?? (item.language === "ta" ? tamilGlossary[item.word] : mandarinGlossary[item.word]);
                const itemUses = Math.min(3, item.uses ?? 0);
                return <button role="listitem" className={`${active && sameSatchelItem(active, item) ? "active" : ""}`} key={satchelItemKey(item)} onClick={() => selectWord(item)}>
                  <span><b lang={item.language === "ta" ? "ta" : "zh-Hans"}>{item.word}</b><small>{itemEntry?.simple ?? "Saved word"}</small></span>
                  <i aria-label={`${itemUses} of 3 meaningful uses`}>{[0, 1, 2].map((value) => <em className={value < itemUses ? "filled" : ""} key={value} />)}</i>
                </button>;
              })}
            </div>
            {active && <div className="satchel-card backpack-word-detail">
              <div className="satchel-card-top"><span>{active.language === "ta" ? "Tamil" : "Mandarin"}</span><span>{mastered ? "Mastered" : `${meaningfulUses} / 3 uses`}</span></div>
              <button className={`satchel-word ${voiceStatus === "loading" && activeSpeechText === active.word ? "voice-loading" : ""}`} onClick={() => onSpeak(active.word, active.language)} disabled={voiceStatus === "loading" && activeSpeechText === active.word}>{active.word}<span>{voiceStatus === "loading" && activeSpeechText === active.word ? "…" : voiceStatus === "playing" && activeSpeechText === active.word ? "Ⅱ" : "▶"}</span></button>
              <div className={`satchel-mastery ${meaningfulUses ? "sparked" : ""} ${mastered ? "mastered" : ""}`}>
                <span>{mastered ? "✦" : meaningfulUses ? "◐" : "◇"}</span>
                <p><b>{mastered ? "A word I can use ✦" : meaningfulUses ? "Building this word" : "Saved word"}</b><small>{mastered ? `Used meaningfully ${meaningfulUses} times` : `Used ${meaningfulUses} of 3 times`}</small></p>
              </div>
              <WordConstructionCard construction={entry?.construction} language={active.language} />
              {active.language === "zh" && entry?.contextual && <div className="satchel-clue context-sense"><small>Here it means · {entry.contextual.pronunciation}</small><p>{entry.contextual.meaning_here}</p><blockquote lang="zh-Hans">{entry.contextual.source_sentence}</blockquote></div>}
              {rung === 0 && <p>Say the word, then explain it in your own way.</p>}
              {rung === 1 && <div className="satchel-clue"><small>In a sentence</small><p>{entry?.sentence ?? "Return to the story sentence and use it as a clue."}</p></div>}
              {rung === 2 && <div className="satchel-clue"><small>A simpler way</small><p>{entry?.simple ?? "Ask the Voice Teacher to make it simpler."}</p></div>}
              {rung === 3 && <div className="satchel-clue english"><small>English</small><p>{entry?.english ?? "Ask a grown-up for one short English rescue."}</p></div>}
              <button className="reveal-clue" onClick={() => setRung(Math.min(3, rung + 1))} disabled={rung === 3}>{rung === 0 ? "Give me a context clue" : rung === 1 ? "Make it simpler" : rung === 2 ? "Show English" : "Clues revealed"}</button>
              <button className="practice-this-word" onClick={() => { setPracticeItems([active]); setPracticeIndex(0); setPracticeIsDemo(false); setPracticeComplete(false); setCompletedPracticeWords([]); setPracticeStartSignal((current) => current + 1); setMode("practice"); }}>Practise this word with Voice Teacher</button>
              <SatchelSentencePractice key={satchelItemKey(active)} active={active} adultConfirmed={adultConfirmed} familyId={familyId} onMastered={onMastered} />
            </div>}
          </div>}
        </>}

        {mode === "practice" && demoStatus === "loading" && <div className="backpack-demo-loading" aria-live="polite"><span>✦</span><div><b>Building five flashcards from this story…</b><small>The Voice Teacher will help with each word.</small></div></div>}
        {mode === "practice" && demoStatus === "error" && <div className="backpack-demo-error" role="alert"><p>{demoError}</p><button onClick={() => void startPractice()}>Try again</button></div>}
        {mode === "practice" && demoStatus === "idle" && practiceComplete && <div className="backpack-practice-summary">
          <span>✦</span><h3>Flashcard practice complete</h3><p>You completed {completedPracticeWords.length} of {practiceItems.length} words.</p>
          {practiceIsDemo && <small>{practiceItems.filter((item) => items.some((saved) => sameSatchelItem(saved, item))).length} demo words saved in your Backpack.</small>}
          <button onClick={() => setMode("browse")}>Back to my words</button>
        </div>}
        {mode === "practice" && demoStatus === "idle" && practiceItem && !practiceComplete && <div className="backpack-flashcard">
          <div className="backpack-flashcard-top"><span>{practiceIsDemo ? "5-word story demo" : "Voice Teacher practice"}</span><b>{practiceIndex + 1} of {practiceItems.length}</b></div>
          <button className={`backpack-flashcard-word ${voiceStatus === "loading" && activeSpeechText === practiceItem.word ? "voice-loading" : ""}`} onClick={() => onSpeak(practiceItem.word, practiceItem.language)}>{practiceItem.word}<span>▶ Hear it</span></button>
          <p className="backpack-flashcard-meaning" lang={practiceItem.language === "ta" ? "ta" : "zh-Hans"}>{practiceItem.gloss?.simple}</p>
          <WordConstructionCard construction={practiceItem.gloss?.construction} language={practiceItem.language} />
          {practiceIsDemo && <button className={`satchel-save-button story-save ${practiceSaved ? "saved" : ""}`} disabled={practiceSaved} onClick={() => onSave({ ...practiceItem, savedAt: Date.now() })}>{practiceSaved ? "Saved in my Magic Backpack ✓" : "Save it in my Magic Backpack"}</button>}
          <TeacherVoiceHelp
            key={`${practiceItem.language}:${practiceItem.word}:${practiceIndex}`}
            adultConfirmed={adultConfirmed}
            language={practiceItem.language}
            level={demoContext.level}
            narratorVoice={narratorVoice}
            worksheetTitle={demoContext.title}
            sourceText={practiceItem.gloss?.sentence ?? demoContext.text}
            question={`Practise the word: ${practiceItem.word}`}
            learnerAttempt=""
            clue={practiceItem.gloss?.simple ?? ""}
            keyPoints={["Explain the word's meaning", "Use the word naturally in an original sentence"]}
            vocabularyTargets={[practiceItem]}
            purpose="backpack_flashcard"
            progressStyle="word"
            classroomMode
            startSignal={practiceStartSignal}
            onDiscover={onSave}
            onGoal={() => completePracticeWord(practiceItem)}
            onWordsUsed={(words) => {
              if (items.some((item) => sameSatchelItem(item, practiceItem)) && words.includes(practiceItem.word)) onMastered(practiceItem);
            }}
          />
          <div className="backpack-flashcard-actions"><button onClick={nextPracticeWord}>{practiceIndex === practiceItems.length - 1 ? "Finish practice" : "Skip for now"}</button><button className="primary" onClick={nextPracticeWord} disabled={!completedPracticeWords.includes(satchelItemKey(practiceItem))}>{practiceIndex === practiceItems.length - 1 ? "Finish" : "Next flashcard →"}</button></div>
        </div>}
      </section>
    </div>
  );
}

type WorksheetToken = { value: string; start: number; end: number; clickable: boolean };

function makeWorksheetTokens(text: string, language: Language): WorksheetToken[] {
  const tokens: WorksheetToken[] = [];
  if (language === "zh" && typeof Intl.Segmenter !== "undefined") {
    const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
    for (const part of segmenter.segment(text)) {
      tokens.push({
        value: part.segment,
        start: part.index,
        end: part.index + part.segment.length,
        clickable: part.isWordLike ?? /[\p{L}\p{N}]/u.test(part.segment),
      });
    }
    return tokens;
  }

  const pattern = /\s+|[\p{L}\p{M}\p{N}]+|./gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    tokens.push({
      value,
      start: match.index,
      end: match.index + value.length,
      clickable: /[\p{L}\p{M}\p{N}]/u.test(value),
    });
  }
  return tokens;
}

function worksheetSentenceAt(text: string, start: number, end: number) {
  const left = Math.max(
    text.lastIndexOf(".", Math.max(0, start - 1)),
    text.lastIndexOf("。", Math.max(0, start - 1)),
    text.lastIndexOf("!", Math.max(0, start - 1)),
    text.lastIndexOf("！", Math.max(0, start - 1)),
    text.lastIndexOf("?", Math.max(0, start - 1)),
    text.lastIndexOf("？", Math.max(0, start - 1)),
  );
  const candidates = [".", "。", "!", "！", "?", "？"]
    .map((mark) => text.indexOf(mark, end))
    .filter((value) => value >= 0);
  const right = candidates.length ? Math.min(...candidates) + 1 : text.length;
  return text.slice(left + 1, right).trim() || text.slice(Math.max(0, start - 120), Math.min(text.length, end + 120)).trim();
}

async function imageCopyForUpload(file: File, maxDimension: number, quality: number) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    const stem = file.name.replace(/\.[^.]+$/, "") || "worksheet-page";
    return new File([blob], `${stem}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

const WORKSHEET_PAGE_TRANSPORT_BYTES = 760 * 1024;
const WORKSHEET_FAST_READ_TIMEOUT_MS = 55_000;
const WORKSHEET_TARGETED_READ_TIMEOUT_MS = 75_000;
const WORKSHEET_MIN_READING_LONG_EDGE = 1600;

async function fullPageJpegWithinBytes(file: File, maxBytes: number) {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/jpeg" && file.size <= maxBytes) return file;

  const bitmap = await createImageBitmap(file);
  const originalLongEdge = Math.max(bitmap.width, bitmap.height);
  const minimumLongEdge = Math.min(originalLongEdge, WORKSHEET_MIN_READING_LONG_EDGE);
  const longEdges = [
    Math.min(originalLongEdge, 2600),
    Math.min(originalLongEdge, 2400),
    Math.min(originalLongEdge, 2200),
    Math.min(originalLongEdge, 2000),
    Math.min(originalLongEdge, 1800),
    minimumLongEdge,
  ].filter((value, index, values) => value >= minimumLongEdge && values.indexOf(value) === index);

  try {
    for (const longEdge of longEdges) {
      const scale = Math.min(1, longEdge / originalLongEdge);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) continue;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      let low = 0.82;
      let high = 0.95;
      let best: Blob | null = null;
      for (let iteration = 0; iteration < 7; iteration += 1) {
        const quality = (low + high) / 2;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob && blob.size <= maxBytes) {
          best = blob;
          low = quality;
        } else {
          high = quality;
        }
      }
      canvas.width = 1;
      canvas.height = 1;
      if (best) {
        const stem = file.name.replace(/\.[^.]+$/, "") || "worksheet-page";
        return new File([best], `${stem}-reading.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
      }
    }

    const finalCopy = await imageCopyForUpload(file, minimumLongEdge, 0.76);
    if (finalCopy.size <= maxBytes) return finalCopy;
    throw new Error("The complete page could not be made small enough while keeping the Tamil or Mandarin text legible.");
  } finally {
    bitmap.close();
  }
}

const MAX_WORKSHEET_PAGES = 24;
const PDF_RENDER_LONG_EDGE = 2800;

async function splitPdfIntoFullPageImages(file: File) {
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdfDocument = await loadingTask.promise;

  try {
    if (pdfDocument.numPages > MAX_WORKSHEET_PAGES) {
      throw new Error(`This PDF contains ${pdfDocument.numPages} pages. Please upload at most ${MAX_WORKSHEET_PAGES} relevant pages at a time.`);
    }

    const pages: File[] = [];
    const stem = file.name.replace(/\.pdf$/i, "") || "worksheet";
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const originalViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(4, Math.max(0.35, PDF_RENDER_LONG_EDGE / Math.max(originalViewport.width, originalViewport.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error(`Page ${pageNumber} could not be prepared for reading.`);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport, background: "rgb(255,255,255)" }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.96));
      page.cleanup();
      canvas.width = 1;
      canvas.height = 1;
      if (!blob) throw new Error(`Page ${pageNumber} could not be prepared for reading.`);
      const rendered = new File([blob], `${stem}-page-${String(pageNumber).padStart(3, "0")}.jpg`, {
        type: "image/jpeg",
        lastModified: file.lastModified,
      });
      pages.push(await highFidelityFullPageCopy(rendered));
    }
    return pages;
  } finally {
    await pdfDocument.destroy();
  }
}

async function highFidelityFullPageCopy(file: File) {
  return fullPageJpegWithinBytes(file, WORKSHEET_PAGE_TRANSPORT_BYTES);
}

const WORKSHEET_REQUEST_SOFT_LIMIT = 2.25 * 1024 * 1024;

function packWorksheetPages(pages: UploadedPage[]) {
  const groups: UploadedPage[][] = [];
  let current: UploadedPage[] = [];
  let currentBytes = 0;

  for (const page of pages) {
    const mustTravelAlone = page.file.type === "application/pdf" || page.file.size > WORKSHEET_REQUEST_SOFT_LIMIT;
    const wouldOverflow = currentBytes + page.file.size > WORKSHEET_REQUEST_SOFT_LIMIT;
    if (current.length && (mustTravelAlone || wouldOverflow || current.length >= 2)) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(page);
    currentBytes += page.file.size;
    if (mustTravelAlone) {
      groups.push(current);
      current = [];
      currentBytes = 0;
    }
  }

  if (current.length) groups.push(current);
  return groups;
}

function mergeWorksheetExtractions(items: ExtractedWorksheet[]): ExtractedWorksheet {
  const supported = items.find((item) => item.detected_language === "ta" || item.detected_language === "zh");
  return {
    title: items.map((item) => item.title.trim()).find(Boolean) || "School passage",
    detected_language: supported?.detected_language ?? "ta",
    passage_text: items.map((item) => item.passage_text.trim()).filter(Boolean).join("\n\n"),
    other_text: items.map((item) => item.other_text.trim()).filter(Boolean).join("\n\n"),
    confidence_notes: items.flatMap((item) => item.confidence_notes),
    content_complete: items.every((item) => item.content_complete),
    unreadable_regions: items.flatMap((item) => item.unreadable_regions),
    page_audits: items.flatMap((item) => item.page_audits ?? []),
    reviewRegions: items.flatMap((item,index) => (item.reviewRegions||[]).map(r=>({...r,id:`${index}-${r.id}`}))),
    ocrFailure: items.map(item=>item.ocrFailure).filter(Boolean).join(' '),
    ocrReaderVersion: items.every(item=>item.ocrReaderVersion===2)?2:undefined,
    structureAccepted: items.every(item=>item.structureAccepted),
  };
}

async function responseJson<T>(response: Response): Promise<T & { error?: string }> {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as T & { error?: string };
  } catch {
    const tooLarge = response.status === 413 || /payload too large/i.test(raw);
    return {
      error: tooLarge
        ? "This page set is larger than the safe request size."
        : "The worksheet service returned an unreadable response. Please try this batch again.",
    } as T & { error?: string };
  }
}

const WORKSHEET_CACHE_VERSION = "worksheet-analysis-v7-simple-first";
const WORKSHEET_SET_CACHE_VERSION = "worksheet-set-v9-flexible-reading-composition";

async function digestText(value: string) {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

async function digestFile(file: File) {
  return bytesToHex(sha256(new Uint8Array(await file.arrayBuffer())));
}

async function worksheetSetKey(pages: UploadedPage[]) {
  const hashes = pages.map((page) => page.hash).sort();
  return digestText(`${WORKSHEET_SET_CACHE_VERSION}:set:${hashes.join(":")}`);
}

async function worksheetBatchKey(pages: UploadedPage[]) {
  return digestText(`${WORKSHEET_CACHE_VERSION}:batch:${pages.map((page) => page.hash).join(":")}`);
}

async function worksheetPageKey(page: UploadedPage) {
  return digestText(`${WORKSHEET_CACHE_VERSION}:page:${page.hash}`);
}

function RobotRechargeGame({ onDone }: { onDone: () => void }) {
  const [robot, setRobot] = useState(0);
  const [cells, setCells] = useState([6, 14, 22]);
  const won = cells.length === 0;

  function move(dx: number, dy: number) {
    if (won) return;
    setRobot((current) => {
      const row = Math.floor(current / 5);
      const column = current % 5;
      const nextRow = Math.max(0, Math.min(4, row + dy));
      const nextColumn = Math.max(0, Math.min(4, column + dx));
      const next = nextRow * 5 + nextColumn;
      setCells((values) => values.filter((value) => value !== next));
      return next;
    });
  }

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const direction = moves[event.key];
      if (!direction) return;
      event.preventDefault();
      move(...direction);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [won]);

  return (
    <div className="robot-break-game">
      <div className="game-status"><span>{won ? "✦" : "⚡"}</span><div><b>{won ? "Robot fully charged!" : `${cells.length} energy cells left`}</b><small>{won ? "A quick reset—now back to the story." : "Use the arrows or buttons to collect every cell."}</small></div></div>
      <div className="robot-grid" aria-label="Robot recharge grid">
        {Array.from({ length: 25 }, (_, index) => <div key={index} className={index === robot ? "robot-cell robot-here" : cells.includes(index) ? "robot-cell energy-here" : "robot-cell"}>{index === robot ? "🤖" : cells.includes(index) ? "⚡" : ""}</div>)}
      </div>
      {won ? <button className="primary-button" onClick={onDone}>Return to the story <span>→</span></button> : (
        <div className="game-controls" aria-label="Move the robot">
          <button onClick={() => move(0, -1)} aria-label="Move up">↑</button>
          <span><button onClick={() => move(-1, 0)} aria-label="Move left">←</button><button onClick={() => move(0, 1)} aria-label="Move down">↓</button><button onClick={() => move(1, 0)} aria-label="Move right">→</button></span>
        </div>
      )}
    </div>
  );
}

function RewardMaker({
  adultConfirmed,
  familyId,
  reader,
  section,
  language,
  level,
  onDone,
}: {
  adultConfirmed: boolean;
  familyId: string;
  reader: WorksheetReader;
  section: WorksheetSection;
  language: Language;
  level: Level;
  onDone: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [narration, setNarration] = useState("");
  const [creating, setCreating] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const fullStoryText = reader.sections.map((item) => item.text).join("\n\n");

  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, blob.type.includes("mp4") ? "reward.m4a" : "reward.webm");
      form.append("adultConfirmed", String(adultConfirmed));
      form.append("language", language);
      form.append("storyContext", fullStoryText);
      form.append("targetWords", "");
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      const result = await response.json() as { transcript?: string; error?: string };
      if (!response.ok || !result.transcript) throw new Error(result.error || "The narration could not be transcribed.");
      setNarration(result.transcript);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The narration could not be transcribed.");
    } finally {
      setTranscribing(false);
    }
  }

  async function toggleRecording() {
    setError("");
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is unavailable here. Type the narration instead.");
      return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = nextStream;
      const preferred = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const nextRecorder = preferred ? new MediaRecorder(nextStream, { mimeType: preferred }) : new MediaRecorder(nextStream);
      chunks.current = [];
      nextRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      nextRecorder.onstop = () => {
        setRecording(false);
        nextStream.getTracks().forEach((track) => track.stop());
        void transcribe(new Blob(chunks.current, { type: nextRecorder.mimeType || "audio/webm" }));
      };
      recorder.current = nextRecorder;
      setRecording(true);
      nextRecorder.start();
    } catch {
      setError("Allow microphone access, or type the narration instead.");
    }
  }

  async function createReward() {
    if (!narration.trim()) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/worksheets/reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          worksheetId: reader.worksheetId,
          sectionId: section.id,
          title: reader.title,
          sectionTitle: "An alternate ending after the full story",
          sectionText: fullStoryText,
          visualBible: reader.visual_bible,
          language,
          level,
          mode: "ending",
          narration: narration.trim(),
        }),
      });
      const result = await response.json() as { imageUrl?: string; error?: string };
      if (!response.ok || !result.imageUrl) throw new Error(result.error || "The creation could not be made.");
      setImageUrl(result.imageUrl);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The creation could not be made.");
    } finally {
      setCreating(false);
    }
  }

  if (imageUrl) return (
    <div className="reward-result">
      <img src={imageUrl} alt="A storybook illustration generated from the tester's alternate ending" />
      <div>
        <span>✦ Your alternate ending became a picture</span>
        <p>{narration}</p>
        <div className="reward-result-actions">
          <a className="download-reward-button" href={imageUrl} download={`${reader.title || "storylight"}-alternate-ending.png`}>Download picture ↓</a>
          <button className="primary-button" onClick={onDone}>Finish the adventure <span>→</span></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="reward-maker">
      <p className="reward-maker-prompt">The original story has ended. What else could have happened? Tell a different ending that still makes sense with the characters and events.</p>
      <button className={`reward-mic ${recording ? "recording" : ""}`} onClick={toggleRecording} disabled={transcribing}><span>{recording ? "■" : "●"}</span>{recording ? "Stop & transcribe" : transcribing ? "Transcribing…" : "Narrate it"}</button>
      <textarea value={narration} onChange={(event) => setNarration(event.target.value)} rows={5} placeholder={language === "ta" ? "வேறு முடிவை இங்கே சொல்லுங்கள்…" : "说一个不一样的结局……"} />
      {error && <p className="worksheet-error">{error}</p>}
      <button className="primary-button" onClick={createReward} disabled={!narration.trim() || creating}>{creating ? "Painting your new ending…" : "Turn my ending into a picture"}<span>✦</span></button>
      <small>One image is generated for this break. Raw audio is discarded after transcription.</small>
    </div>
  );
}

function AdventureBreak({
  adultConfirmed,
  familyId,
  reader,
  section,
  language,
  level,
  onClose,
  onComplete,
}: {
  adultConfirmed: boolean;
  familyId: string;
  reader: WorksheetReader;
  section: WorksheetSection;
  language: Language;
  level: Level;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [choice, setChoice] = useState<"choose" | "game" | "ending">("choose");
  const isExercise = reader.sections.some((item) => item.section_kind === "exercise_item");
  const isStory = !isExercise && (reader.content_kind === "story" || reader.content_kind === "mixed");
  return (
    <div className="adventure-break-overlay" role="dialog" aria-modal="true" aria-labelledby="adventure-break-title">
      <section className="adventure-break-card">
        <button className="close-word" onClick={onClose} aria-label="Close adventure break">×</button>
        <p className="overline">{isExercise ? "Exercise complete" : "Story complete"} · reward unlocked</p>
        <h2 id="adventure-break-title">{isStory ? "You stayed with the whole journey. Choose your ending reward." : isExercise ? "You worked through every question. Choose a quick reward." : "You completed the whole reading journey. Choose a quick reward."}</h2>
        {choice === "choose" ? (
          <div className={`reward-choices ${isStory ? "" : "single-choice"}`}>
            <button onClick={() => setChoice("game")}><span>🤖</span><b>Play a quick game</b><small>A fast movement puzzle. About one minute.</small></button>
            {isStory && <button onClick={() => setChoice("ending")}><span>🎨</span><b>Invent another ending</b><small>Tell a new ending and turn it into a downloadable picture.</small></button>}
          </div>
        ) : choice === "game" ? <RobotRechargeGame onDone={onComplete} /> : (
          <RewardMaker adultConfirmed={adultConfirmed} familyId={familyId} reader={reader} section={section} language={language} level={level} onDone={onComplete} />
        )}
      </section>
    </div>
  );
}

function GuidedExerciseSupport({
  activity,
  status,
  language,
}: {
  activity: WorksheetWordActivity | null;
  status: "idle" | "loading" | "ready" | "error";
  language: Language;
}) {
  const [revealedClues, setRevealedClues] = useState(0);
  if (status === "loading" || status === "idle") return <section className="specific-scaffold loading" aria-live="polite"><span>◌</span><p>Finding a useful clue from this exact worksheet item…</p></section>;
  if (status === "error" || !activity?.scaffold_available) return <section className="specific-scaffold unavailable"><span>!</span><p>A specific clue could not be prepared. The original worksheet question and word help still work.</p></section>;
  const clues = [activity.clue_one, activity.clue_two, activity.construction_frame].filter(Boolean);
  return <section className="specific-scaffold" aria-label="Specific help for this worksheet item">
    <div className="scaffold-focus"><small>Look closely at</small><b lang={language === "ta" ? "ta" : "zh-Hans"}>{activity.focus_text}</b></div>
    <div className="specific-clue-list">
      {clues.slice(0, revealedClues).map((clue, index) => <article key={`${index}-${clue}`} className={index === clues.length - 1 ? "construction-clue" : ""}><span>{index + 1}</span><div><small>{index === 0 ? "Related clue" : index === 1 ? "Notice the change" : "Build the answer"}</small><p lang={language === "ta" ? "ta" : "zh-Hans"}>{clue}</p></div></article>)}
    </div>
    {revealedClues < clues.length && <button type="button" className="reveal-specific-clue" onClick={() => setRevealedClues((value) => Math.min(clues.length, value + 1))}>{revealedClues === 0 ? "Show a useful clue" : revealedClues === 1 ? "Show what changes" : "Give me a word frame"} →</button>}
    {revealedClues === clues.length && <p className="scaffold-ready">Now construct the answer on the right. The app will check the word you make.</p>}
  </section>;
}

type LearningSignalId = "strategy" | "patterns" | "logic" | "story" | "making" | "discovery" | "collaboration" | "movement";
type InterestDefinition = { id: string; label: string; symbol: string; signals: LearningSignalId[] };
type SavedInterestProfile = { interests: string[]; today: string; customInterest?: string; updatedAt?: string };
type RankedLearningSignal = {
  id: LearningSignalId;
  label: string;
  mechanic: string;
  description: string;
  watchFor: [string, string, string];
  score: number;
  sources: Array<{ interest: string; weight: number; today: boolean }>;
};
type InterestOverlay = {
  selectedInterest: string;
  companionName: string;
  thinkingMode: string;
  activityMechanic: string;
  activityTitle: string;
  visualMetaphor: string;
  mission: string;
  missionSteps: string[];
  parentReason: string;
};

const learningSignalLibrary: Record<LearningSignalId, { label: string; mechanic: string; description: string; watchFor: [string, string, string] }> = {
  strategy: { label: "Strategy & foresight", mechanic: "Predict → plan → justify", description: "Think ahead, choose a route and explain why.", watchFor: ["Makes a prediction before answering", "Compares more than one possible move", "Explains why the chosen move fits the evidence"] },
  patterns: { label: "Pattern & sequence", mechanic: "Notice → reconstruct → vary", description: "Find a structure, remember its order and use it again.", watchFor: ["Notices a repeated form or sequence", "Can reconstruct the order without copying", "Uses the same pattern in a new sentence"] },
  logic: { label: "Logic & rules", mechanic: "Classify → infer → test", description: "Spot the hidden rule and check whether it holds.", watchFor: ["Groups examples using a relevant rule", "States an inference rather than guessing", "Tests the inference against the source"] },
  story: { label: "Story & perspective", mechanic: "Imagine → role-play → explain", description: "Enter a viewpoint and use language for a purpose.", watchFor: ["Adopts a character or audience perspective", "Uses target-language words for a real purpose", "Explains how the viewpoint affected the response"] },
  making: { label: "Building & revision", mechanic: "Plan → make → test → revise", description: "Create something, inspect the result and improve it.", watchFor: ["Makes a plan before producing the answer", "Checks the result against the question", "Revises meaningfully after noticing a mismatch"] },
  discovery: { label: "Clues & discovery", mechanic: "Search → connect → report", description: "Find evidence, connect clues and reveal a conclusion.", watchFor: ["Returns to the source to find a clue", "Connects two clues rather than naming one", "Reports a conclusion supported by those clues"] },
  collaboration: { label: "Teamwork & response", mechanic: "Listen → coordinate → respond", description: "Use language to help a partner complete a shared goal.", watchFor: ["Listens before taking a turn", "Uses language to coordinate a shared action", "Builds on the partner’s contribution"] },
  movement: { label: "Rhythm & movement", mechanic: "Hear → move → recall", description: "Use timing, rhythm and action to support memory.", watchFor: ["Links a word or sequence to an action", "Recalls more accurately after movement or rhythm", "Can recall again after the movement cue is removed"] },
};

const interestDefinitions: InterestDefinition[] = [
  { id: "football", label: "Football & sports", symbol: "⚽", signals: ["strategy", "collaboration", "movement", "patterns"] },
  { id: "chess", label: "Chess & puzzles", symbol: "♞", signals: ["strategy", "logic", "patterns"] },
  { id: "dance", label: "Music & dance", symbol: "♪", signals: ["patterns", "movement", "story"] },
  { id: "making", label: "Experiments & making", symbol: "⚙", signals: ["making", "logic", "discovery"] },
  { id: "comics", label: "Comics & drawing", symbol: "✎", signals: ["story", "patterns", "making"] },
  { id: "nature", label: "Animals & nature", symbol: "❧", signals: ["discovery", "story", "patterns"] },
  { id: "space", label: "Space & stars", symbol: "✦", signals: ["discovery", "logic", "story"] },
  { id: "action", label: "Ninja & action games", symbol: "⚡", signals: ["strategy", "movement", "patterns"] },
  { id: "robots", label: "Robots & machines", symbol: "▣", signals: ["making", "logic", "strategy"] },
  { id: "cooking", label: "Cooking & food", symbol: "◒", signals: ["patterns", "making", "collaboration"] },
  { id: "mystery", label: "Mysteries & detectives", symbol: "⌕", signals: ["discovery", "logic", "story"] },
  { id: "books", label: "Stories & books", symbol: "▤", signals: ["story", "patterns", "discovery"] },
];

const legacyInterestLabels: Record<string, string> = {
  Football: "Football & sports", Chess: "Chess & puzzles", "Fighting games": "Ninja & action games",
  Mystery: "Mysteries & detectives", Space: "Space & stars", Animals: "Animals & nature",
};
const defaultInterestProfile: SavedInterestProfile = {
  interests: ["Football & sports", "Chess & puzzles", "Ninja & action games", "Mysteries & detectives"],
  today: "Football & sports",
};

function normaliseInterestProfile(value?: Partial<SavedInterestProfile> | null): SavedInterestProfile {
  const interests = (value?.interests ?? defaultInterestProfile.interests)
    .map((item) => legacyInterestLabels[item] ?? item)
    .filter((item, index, all) => item && all.indexOf(item) === index);
  const safeInterests = interests.length ? interests : defaultInterestProfile.interests;
  const today = legacyInterestLabels[value?.today ?? ""] ?? value?.today;
  return { interests: safeInterests, today: today && safeInterests.includes(today) ? today : safeInterests[0], customInterest: value?.customInterest ?? "", updatedAt: value?.updatedAt };
}

function loadInterestProfile() {
  try { return normaliseInterestProfile(JSON.parse(localStorage.getItem("storylight-interests-v1") || "null")); }
  catch { return defaultInterestProfile; }
}

function deriveLearningSignals(profile: SavedInterestProfile): RankedLearningSignal[] {
  const scores = new Map<LearningSignalId, { score: number; sources: RankedLearningSignal["sources"] }>();
  for (const label of profile.interests) {
    const interest = interestDefinitions.find((item) => item.label === label);
    const today = label === profile.today;
    const weight = today ? 2.5 : 1;
    interest?.signals.forEach((signal) => {
      const current = scores.get(signal) ?? { score: 0, sources: [] };
      scores.set(signal, { score: current.score + weight, sources: [...current.sources, { interest: label, weight, today }] });
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 4)
    .map(([id, result]) => ({ id, ...learningSignalLibrary[id], score: result.score, sources: result.sources }));
}

function InterestProfilePanel({ onClose, onSaved }: { onClose: () => void; onSaved: (profile: SavedInterestProfile) => void }) {
  const [profile, setProfile] = useState<SavedInterestProfile>(() => loadInterestProfile());
  const [saved, setSaved] = useState(false);
  const signals = deriveLearningSignals(profile);
  function toggle(label: string) {
    setSaved(false);
    setProfile((current) => {
      const selected = current.interests.includes(label);
      const interests = selected ? current.interests.filter((item) => item !== label) : [...current.interests, label];
      if (!interests.length) return current;
      return { ...current, interests, today: interests.includes(current.today) ? current.today : interests[0] };
    });
  }
  function save() {
    const next = { ...profile, updatedAt: new Date().toISOString() };
    localStorage.setItem("storylight-interests-v1", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("storylight-interest-profile", { detail: next }));
    setProfile(next); setSaved(true); onSaved(next);
  }
  return <div className="interest-profile-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="interest-profile-sheet" role="dialog" aria-modal="true" aria-labelledby="interest-profile-title">
      <button className="close-word" onClick={onClose} aria-label="Close interest profile">×</button>
      <p className="overline">Learner lens settings · Saved on this device</p>
      <h1 id="interest-profile-title">Interests and activity signals</h1>
      <p className="interest-profile-lede">This is the occasional deeper setup. The daily beacon handles the quick “what sounds good today?” check-in.</p>
      <div className="wonder-deck">{interestDefinitions.map((interest) => <button key={interest.id} className={profile.interests.includes(interest.label) ? "selected" : ""} onClick={() => toggle(interest.label)} aria-pressed={profile.interests.includes(interest.label)}><span>{interest.symbol}</span><b>{interest.label}</b></button>)}</div>
      <div className="today-spark-row"><label><span>What feels exciting today?</span><select value={profile.today} onChange={(event) => { setSaved(false); setProfile({ ...profile, today: event.target.value }); }}>{profile.interests.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Anything else lately?</span><input value={profile.customInterest ?? ""} onChange={(event) => { setSaved(false); setProfile({ ...profile, customInterest: event.target.value.slice(0, 80) }); }} placeholder="e.g. roller coasters, magic tricks" /></label></div>
      <section className="learning-lens"><div><small>Possible activity ingredients</small><h2>What Storylight will test</h2><p>These are hypotheses generated from the selected interests. Each selected interest contributes +1 to its linked signals; today’s spark receives an additional +1.5. The curriculum stays fixed.</p></div><div className="signal-grid">{signals.map((signal) => <article key={signal.id}><span>{signal.label} · weight {signal.score.toFixed(1)}</span><b>{signal.mechanic}</b><p>{signal.description}</p></article>)}</div></section>
      <p className="interest-caution"><b>Important:</b> liking football does not prove a child is a strategic learner. It gives Storylight a reason to try prediction and planning, then observe whether that approach actually helps. The detailed curriculum-fit trace appears inside each worksheet activity.</p>
      <div className="interest-profile-actions"><span>{saved ? "✓ Profile saved on this device" : profile.updatedAt ? "Previously saved · edit anytime" : "Not saved yet"}</span><button className="primary-button" onClick={save}>Save learner profile <span>→</span></button></div>
    </section>
  </div>;
}

function TodaySparkBeacon({
  profile,
  open,
  confirmed,
  onToggle,
  onChoose,
  onNotNow,
  onEditProfile,
}: {
  profile: SavedInterestProfile;
  open: boolean;
  confirmed: boolean;
  onToggle: () => void;
  onChoose: (interest: string) => void;
  onNotNow: () => void;
  onEditProfile: () => void;
}) {
  const choices = [profile.today, ...profile.interests.filter((item) => item !== profile.today)].slice(0, 6);
  return <aside className={`spark-beacon ${open ? "open" : ""} ${confirmed ? "settled" : "attention"}`} aria-label="Today's interest check-in">
    {!open ? <button className="spark-beacon-trigger" onClick={onToggle}>
      <span className="spark-beacon-orb">✦</span>
      <span><small>{confirmed ? "Today’s spark" : "One-tap check-in"}</small><b>{confirmed ? profile.today : "What sounds good today?"}</b></span>
    </button> : <section className="spark-beacon-card">
      <button className="spark-beacon-close" onClick={onToggle} aria-label="Collapse today's spark">×</button>
      <div className="spark-beacon-heading"><span className="spark-beacon-orb">✦</span><div><small>Quick session check-in</small><h2>What’s the spark today?</h2><p>One tap. Storylight will choose a fitting activity mechanic later.</p></div></div>
      <div className="spark-quick-choices">{choices.map((interest) => <button key={interest} className={interest === profile.today ? "current" : ""} onClick={() => onChoose(interest)}><span>{interest === profile.today ? "↺" : "○"}</span><b>{interest}</b>{interest === profile.today && <small>Same as last time</small>}</button>)}</div>
      <div className="spark-beacon-actions"><button onClick={onNotNow}>Not now</button><button onClick={onEditProfile}>Something else or edit learner lens →</button></div>
    </section>}
  </aside>;
}

function InterestDecisionTrace({
  profile,
  candidates,
  overlay,
  curriculumQuestion,
}: {
  profile: SavedInterestProfile;
  candidates: RankedLearningSignal[];
  overlay: InterestOverlay | null;
  curriculumQuestion: string;
}) {
  const selected = candidates.find((candidate) => candidate.label === overlay?.thinkingMode && candidate.mechanic === overlay.activityMechanic) ?? candidates[0];
  return <details className="interest-decision-trace">
    <summary><span><small>Adult QA inspector</small><b>Show how interests became this activity</b></span><span>Algorithm trace ＋</span></summary>
    <div className="decision-trace-body">
      <section className="decision-algorithm-flow" aria-label="Interest matching algorithm">
        <article><span>1</span><div><small>Interest input</small><b>{profile.today}</b><p>Only today’s chosen spark is used for this activity{profile.customInterest ? ` · Parent note: ${profile.customInterest}` : ""}.</p></div></article>
        <article><span>2</span><div><small>Possible thinking actions</small><b>{candidates.map((candidate) => candidate.label).join(" · ")}</b><p>The interest opens a few activity possibilities. It does not label the learner.</p></div></article>
        <article><span>3</span><div><small>Curriculum gate</small><b>{curriculumQuestion}</b><p>Only a candidate that can serve this unchanged question should be selected.</p></div></article>
        <article><span>4</span><div><small>Activity output</small><b>{overlay ? `${overlay.thinkingMode} · ${overlay.activityMechanic}` : "Matching in progress…"}</b><p>The setting and sequence may change. The worksheet source, answer and learning outcome may not.</p></div></article>
      </section>

      <section className="candidate-signal-panel">
        <div><small>Ranked candidates sent to the matching model</small><p>Interest weight proposes possibilities; it does not decide the winner by itself.</p></div>
        <div className="candidate-signal-list">{candidates.map((candidate, index) => {
          const chosen = candidate.id === selected?.id;
          return <article key={candidate.id} className={chosen ? "chosen" : "alternative"}>
            <span>{chosen ? "✓" : index + 1}</span>
            <div><b>{candidate.label}</b><small>{candidate.mechanic}</small><p>Suggested by {candidate.sources.map((source) => source.interest).join(" · ")}</p></div>
            <strong>{chosen ? "Chosen" : "Option"}</strong>
          </article>;
        })}</div>
      </section>

      <section className="qa-watch-panel">
        <div><small>What to watch for in this test</small><h3>{selected?.label ?? "Chosen activity"}</h3><p>Look for observable behaviour—not whether the learner merely says the theme is fun.</p></div>
        <ul>{(selected?.watchFor ?? ["Engages with the curriculum task", "Explains the response", "Transfers the approach to another item"]).map((item) => <li key={item}><span>□</span>{item}</li>)}</ul>
        <p><b>Interpret cautiously:</b> one successful session is a clue, not a learning-style label. Compare the same curriculum demand with a different activity route before concluding that the mechanism helped.</p>
      </section>
    </div>
  </details>;
}

function RealtimeInterestCompanion({ adultConfirmed, language, level, reader, section, narratorVoice, onOpenWord }: { adultConfirmed:boolean; language:Language; level:Level; reader:WorksheetReader; section:WorksheetSection; narratorVoice:NarratorVoice; onOpenWord:(word:string,context:string)=>void }) {
  const [today,setToday]=useState(defaultInterestProfile.today); const [customInterest,setCustomInterest]=useState(""); const [overlay,setOverlay]=useState<InterestOverlay|null>(null); const [matching,setMatching]=useState(false); const [voiceState,setVoiceState]=useState<"idle"|"connecting"|"listening"|"speaking"|"error">("idle"); const [voiceError,setVoiceError]=useState(""); const [caption,setCaption]=useState("");
  const peer=useRef<RTCPeerConnection|null>(null); const stream=useRef<MediaStream|null>(null); const channel=useRef<RTCDataChannel|null>(null);
  const activityProfile=normaliseInterestProfile({interests:[today],today,customInterest}); const rankedSignals=deriveLearningSignals(activityProfile); const captionTokens=useMemo(()=>makeWorksheetTokens(caption,language),[caption,language]);
  useEffect(()=>{const apply=()=>{const p=loadInterestProfile();setToday(p.today);setCustomInterest(p.customInterest??"")};const timer=window.setTimeout(apply,0);window.addEventListener("storylight-interest-profile",apply);return()=>{window.clearTimeout(timer);window.removeEventListener("storylight-interest-profile",apply)}},[]);
  // This request intentionally resets its loading state whenever the saved interest profile or active curriculum section changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{let cancelled=false;const currentProfile=normaliseInterestProfile({interests:[today],today,customInterest});const learningSignals=deriveLearningSignals(currentProfile);setMatching(true);fetch("/api/interests/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({adultConfirmed,language,level,worksheetTitle:reader.title,curriculumText:section.text,currentQuestion:section.question.prompt,interests:[today],today,customInterest,learningSignals})}).then(async r=>{const x=await responseJson<InterestOverlay>(r);if(!r.ok)throw Error(x.error);return x}).then(x=>{if(!cancelled)setOverlay(x)}).catch(()=>{if(!cancelled)setOverlay({selectedInterest:today,companionName:"Kavi",thinkingMode:learningSignals[0]?.label??"Strategy & foresight",activityMechanic:learningSignals[0]?.mechanic??"Predict → plan → justify",activityTitle:today==="Football & sports"?"Make the right substitution":"Find the best move",visualMetaphor:today==="Football & sports"?"Each word is a player. The incorrect word is out of position.":"The interest changes the action used to solve the same worksheet question.",mission:`Use the worksheet clue to complete a ${today} challenge.`,missionSteps:today==="Football & sports"?["Spot the word out of position","Substitute the correct word","Say the repaired sentence"]:["Notice the clue","Choose a move","Explain the decision"],parentReason:"Today’s chosen spark suggests the interaction. The worksheet question and correct answer stay unchanged."})}).finally(()=>{if(!cancelled)setMatching(false)});return()=>{cancelled=true}},[adultConfirmed,language,level,reader.title,section.text,section.question.prompt,today,customInterest]);
  function stop(){channel.current?.close();peer.current?.close();stream.current?.getTracks().forEach(t=>t.stop());channel.current=null;peer.current=null;stream.current=null;setVoiceState("idle")}
  useEffect(()=>()=>stop(),[]);
  async function start(){if(!overlay)return;setVoiceState("connecting");setVoiceError("");setCaption("");try{const pc=new RTCPeerConnection();peer.current=pc;const audio=document.createElement("audio");audio.autoplay=true;pc.ontrack=e=>{audio.srcObject=e.streams[0]};const ms=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});stream.current=ms;pc.addTrack(ms.getAudioTracks()[0]);const dc=pc.createDataChannel("oai-events");channel.current=dc;dc.onopen=()=>{setVoiceState("listening");dc.send(JSON.stringify({type:"response.create"}))};dc.onmessage=e=>{try{const m=JSON.parse(e.data) as {type?:string;delta?:string;transcript?:string;response?:{output?:Array<{content?:Array<{transcript?:string}>}>}};const eventType=m.type??"";if(eventType.includes("audio_transcript.delta")&&m.delta)setCaption((current)=>current+m.delta);if(eventType.includes("audio_transcript.done")&&m.transcript)setCaption(m.transcript);if(eventType==="output_audio_buffer.started"||eventType.includes("response.audio.delta")||eventType.includes("response.output_audio.delta"))setVoiceState("speaking");if(eventType==="output_audio_buffer.stopped")setVoiceState("listening");if(eventType==="response.done"){const finalTranscript=m.response?.output?.flatMap((item)=>item.content??[]).map((item)=>item.transcript??"").join(" ").trim();if(finalTranscript)setCaption(finalTranscript);setVoiceState("listening")}}catch{}};const offer=await pc.createOffer();await pc.setLocalDescription(offer);const r=await fetch("/api/realtime/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({adultConfirmed,sdp:offer.sdp,language,voice:narratorVoice,worksheetTitle:reader.title,curriculumText:section.text,currentQuestion:section.question.prompt,interest:overlay.selectedInterest,thinkingMode:overlay.thinkingMode,activityMechanic:overlay.activityMechanic,missionSteps:overlay.missionSteps,mission:overlay.mission,companionName:overlay.companionName})});const sdp=await r.text();if(!r.ok)throw Error("The live voice connection could not start.");await pc.setRemoteDescription({type:"answer",sdp})}catch(e){stop();setVoiceState("error");setVoiceError(e instanceof Error?e.message:"Voice connection failed.")}}
  return <section className="worksheet-voice-support">
    <details className="optional-live-companion"><summary><span>Need more help? Talk to Kavi</span><small>Optional · short live captions · {narratorVoice==="marin"?"Marin":"Cedar"} voice</small></summary><div className="live-caption-panel">
      <div><small>Live words</small>{caption?<p lang={language==="ta"?"ta":"zh-Hans"}>{captionTokens.map((token,index)=>token.clickable?<button key={`${token.start}-${index}`} onClick={()=>onOpenWord(token.value,caption)}>{token.value}</button>:<span key={`${token.start}-${index}`}>{token.value}</span>)}</p>:<p className="caption-placeholder">Kavi’s next short line will appear here while it is spoken. Tap any word for help.</p>}</div>
      <div className="live-caption-actions"><span>{voiceState==="connecting"?"Connecting…":voiceState==="speaking"?"Speaking slowly…":voiceState==="listening"?"Listening…":voiceState==="error"?"Needs another try":`Voice: ${narratorVoice==="marin"?"Marin":"Cedar"}`}</span>{voiceState==="idle"||voiceState==="error"?<button disabled={!overlay||matching} onClick={start}>Start short voice help <b>◉</b></button>:<button onClick={stop}>End voice help</button>}</div>
    </div>{voiceError&&<p className="realtime-error">{voiceError} Check microphone permission and try again.</p>}</details>
    <InterestDecisionTrace profile={activityProfile} candidates={rankedSignals} overlay={overlay} curriculumQuestion={section.question.prompt} />
  </section>
}

function WorksheetInterestIllustration({ activity, status, today, position, total }: { activity: WorksheetWordActivity | null; status: "idle" | "loading" | "ready" | "error"; today: string; position: number; total: number }) {
  const definition = interestDefinitions.find((item) => item.label === today) ?? interestDefinitions[0];
  const isFootball = today === "Football & sports";
  const focusWord = status === "loading" ? "…" : activity?.is_word_substitution ? activity.target_word : "Q";
  return <div className={`worksheet-interest-illustration interest-${definition.id}`} role="img" aria-label={`Illustration showing how ${today} supports worksheet question ${position}`}>
    <div className="illustration-sky"><span>{definition.symbol}</span><small>Today’s spark</small><b>{today}</b></div>
    <div className="illustration-field">
      <i className="field-line line-one" /><i className="field-line line-two" />
      <span className="illustration-focus-word"><small>{isFootball ? "Player out of position" : "Worksheet focus"}</small><b>{focusWord}</b></span>
      <span className="illustration-substitute"><small>{isFootball ? "Choose a substitute" : "Choose the correction"}</small><b>?</b></span>
      <span className="illustration-arrow">→</span>
    </div>
    <div className="illustration-caption"><small>Q{position} of {total} · Illustration only</small><p>{activity?.is_word_substitution ? `The worksheet supplies “${activity.target_word}”. ${today} supplies the ${isFootball ? "substitution" : "correction"} action.` : status === "loading" ? "Reading the exact worksheet task before drawing the activity." : "The illustration supports the worksheet; the activity controls are beside it."}</p></div>
  </div>;
}

function WorksheetSubstitutionActivity({ activity, status, today, language, onSentenceReady, onSpeak }: { activity: WorksheetWordActivity | null; status: "idle" | "loading" | "ready" | "error"; today: string; language: Language; onSentenceReady: (sentence: string) => void; onSpeak: (sentence: string) => void }) {
  const [selected, setSelected] = useState("");
  const [checked, setChecked] = useState(false);
  const definition = interestDefinitions.find((item) => item.label === today) ?? interestDefinitions[0];
  const isFootball = today === "Football & sports";

  if (status === "loading" || status === "idle") return <section className="worksheet-substitution loading"><span>◌</span><div><small>Building from this worksheet question</small><b>Finding the exact word the learner must correct…</b></div></section>;
  if (status === "error") return <section className="worksheet-substitution unavailable"><span>!</span><div><small>Worksheet activity unavailable</small><b>Continue with the original question below.</b><p>No unrelated activity will be shown.</p></div></section>;
  if (!activity?.is_word_substitution) return <section className="worksheet-substitution not-applicable"><span>✓</span><div><small>Curriculum fit check</small><b>This question is not a one-word substitution task.</b><p>Storylight will keep the original worksheet activity instead of forcing a football game onto it.</p></div></section>;

  const parts = activity.source_sentence.split(activity.target_word);
  const correct = checked && selected === activity.correct_word;
  function checkSelection() {
    if (!selected) return;
    setChecked(true);
    if (activity && selected === activity.correct_word) onSentenceReady(activity.corrected_sentence);
  }

  return <section className="worksheet-substitution">
    <header><span>{definition.symbol}</span><div><small>Step 2 · Use today’s spark</small><h2>{isFootball ? "Make one word substitution" : "Choose the correct replacement"}</h2></div></header>
    <div className="worksheet-interest-relation"><span><small>The worksheet asks</small><b>{activity.worksheet_skill_english}</b></span><i>→</i><span><small>{today} changes the action</small><b>{isFootball ? "Substitute one word-player" : "Choose one correction"}</b></span></div>
    <p className="substitution-instruction" lang={language === "ta" ? "ta" : "zh-Hans"}>{activity.instruction_target}</p>
    <div className="substitution-source" lang={language === "ta" ? "ta" : "zh-Hans"}>{parts.map((part, index) => <span key={`${part}-${index}`}>{part}{index < parts.length - 1 && <mark>{activity.target_word}</mark>}</span>)}</div>
    <div className="substitution-bench"><small>{isFootball ? "Substitution bench · Tap one replacement" : "Tap one replacement"}</small><div role="group" aria-label="Choose the correct replacement word">{activity.options.map((option, index) => <button type="button" key={option} className={`${selected === option ? "selected" : ""} ${checked && option === activity.correct_word ? "correct" : ""} ${checked && selected === option && option !== activity.correct_word ? "incorrect" : ""}`} onClick={() => { setSelected(option); setChecked(false); onSentenceReady(""); }}><span>{index + 1}</span><b>{option}</b></button>)}</div></div>
    <button type="button" className="check-substitution" disabled={!selected} onClick={checkSelection}>{checked ? "Check again" : isFootball ? "Make this substitution →" : "Check this replacement →"}</button>
    {checked && <div className={`substitution-result ${correct ? "correct" : "incorrect"}`} role="status"><span>{correct ? "✓" : "↺"}</span><div><small>{correct ? "Correct substitution" : "Compare with the worksheet answer"}</small><b>{activity.correct_word}</b><p>{activity.short_reason_english}</p><blockquote lang={language === "ta" ? "ta" : "zh-Hans"}>{activity.corrected_sentence}</blockquote><div><button type="button" onClick={() => onSpeak(activity.corrected_sentence)}>▶ Listen to the corrected sentence</button>{!correct && <button type="button" onClick={() => { setSelected(activity.correct_word); setChecked(true); onSentenceReady(activity.corrected_sentence); }}>Use the correct substitute</button>}</div></div></div>}
    <p className="substitution-rule"><b>Direct connection:</b> The sentence and answer come from this worksheet. The interest changes only how the learner practises it.</p>
  </section>;
}

function WorksheetQuestionGuide({
  section,
  pageNumber,
  localPosition,
  pageItems,
  completed,
  streak,
  totalCompleted,
  totalQuestions,
  successMessage,
  language,
  questionBlock,
  activity,
  activityStatus,
  learnerScore,
  opponentScore,
  currentResult,
  onSelectQuestion,
}: {
  section: WorksheetSection;
  pageNumber: number;
  localPosition: number;
  pageItems: Array<{ label: string; completed: boolean; attempted: boolean; checking: boolean; current: boolean; sectionIndex: number; result?: FootballAttemptResult; written: boolean }>;
  completed: boolean;
  streak: number;
  totalCompleted: number;
  totalQuestions: number;
  successMessage?: string;
  language: Language;
  questionBlock: ReactNode;
  activity: WorksheetWordActivity | null;
  activityStatus: "idle" | "loading" | "ready" | "error";
  learnerScore: number;
  opponentScore: number;
  currentResult?: FootballAttemptResult;
  onSelectQuestion: (sectionIndex: number) => void;
}) {
  const matchMessage = currentResult === "checking"
    ? "Checking this shot… You can open another question."
    : currentResult === "learner"
      ? "Goal! Your first answer was correct."
      : currentResult === "opponent"
        ? "The opponent scores this round. Correct it and keep playing."
        : "Your first answer to each question sets the match score.";
  return <div className={`worksheet-question-guide ${completed ? "completed" : ""}`} aria-label={`Page ${pageNumber}, ${section.item_label || `question ${localPosition}`} of ${pageItems.length}`}>
    <header>
      <p>Page {pageNumber} · {pageItems.length}-question football match</p>
    </header>
    <section className={`football-match ${currentResult ?? "ready"}`} aria-label={`You ${learnerScore}, opponent ${opponentScore}`}>
      <div className="football-scoreboard">
        <span><small>You</small><b>{learnerScore}</b></span>
        <i>–</i>
        <span><small>Opponent</small><b>{opponentScore}</b></span>
      </div>
      <div className="football-mini-pitch" aria-hidden="true"><i className="football-goal left" /><i className="football-halfway" /><i className="football-goal right" /><span>⚽</span></div>
      <p role="status">{matchMessage}</p>
    </section>
    <div className="page-question-map" aria-label={`${pageItems.length} questions on page ${pageNumber}`}>
      {pageItems.map((item) => <button type="button" key={item.label} className={`${item.completed ? "complete" : ""} ${item.attempted ? "attempted" : ""} ${item.checking ? "checking" : ""} ${item.current ? "current" : ""} ${item.result ? `result-${item.result}` : ""}`} aria-current={item.current ? "step" : undefined} onClick={() => onSelectQuestion(item.sectionIndex)}><b>{item.result === "learner" ? "⚽" : item.completed ? "✓" : item.label}</b><small>{item.written && item.result === "learner" ? "Goal · Written ✓" : item.result === "learner" ? "Goal" : item.written ? "Written ✓" : item.completed && item.result === "opponent" ? "Corrected" : item.completed ? "Correct" : item.checking ? "Checking" : item.result === "opponent" ? "Opponent" : item.attempted ? "Tried" : item.current ? "Here" : "Open"}</small></button>)}
    </div>
    {!completed && questionBlock}
    {completed ? <section className={`worksheet-success-panel ${currentResult === "learner" ? "goal-scored" : "correction-complete"}`} role="status">
      <span>{currentResult === "learner" ? "⚽" : "✓"}</span>
      <small>{currentResult === "learner" ? "Goal!" : "Correction complete"}</small>
      <p lang={language === "ta" ? "ta" : "zh-Hans"}>{successMessage || "Well done—you used the clue and completed this question."}</p>
      <div><b>{learnerScore}–{opponentScore} in this page match</b><small>{streak} correct · {totalCompleted} of {totalQuestions} worksheet items completed</small></div>
    </section> : <GuidedExerciseSupport key={`${section.id}-left-support`} activity={activity} status={activityStatus} language={language} />}
  </div>;
}

function ReadingPathChooser({ title, hasHomework, onChoose }: { title: string; hasHomework: boolean; onChoose: (path: Exclude<ReadingPath, "choose">) => void }) {
  return <section className="reading-path-shell" aria-labelledby="reading-path-title">
    <div className="reading-path-card">
      <p className="overline">Choose how to read</p>
      <h1 id="reading-path-title">{title}</h1>
      <p className="reading-path-lede">{hasHomework ? "Both choices lead to the same printed homework. Story warm-ups are optional and never block the final questions." : "Both choices use the same story. Answers never block the next paragraph."}</p>
      <div className="reading-path-options">
        <button type="button" onClick={() => onChoose("whole_story")}>
          <span>01</span>
          <b>Read the whole story first</b>
          <small>{hasHomework ? "See and listen to everything, then choose warm-up practice or go straight to the homework." : "See and listen to the complete story. Start the conversation only when you are ready."}</small>
          <i>Choose this →</i>
        </button>
        <button type="button" onClick={() => onChoose("paragraphs")}>
          <span>02</span>
          <b>Read paragraph by paragraph</b>
          <small>{hasHomework ? "Each optional warm-up builds evidence for the final homework and offers a bonus goal." : "Read one part, try its question, or leave it incomplete and continue."}</small>
          <i>Choose this →</i>
        </button>
      </div>
    </div>
  </section>;
}

function WholeStoryReader({
  reader,
  language,
  listening,
  loading,
  paused,
  tokens,
  activeToken,
  onListen,
  onWord,
  onRaiseHand,
  teacherHelp,
  preparationQuestionCount,
  homeworkQuestionCount,
  preparationStatus,
  onStartPreparation,
  onStartHomework,
  onChangePath,
}: {
  reader: WorksheetReader;
  language: Language;
  listening: boolean;
  loading: boolean;
  paused: boolean;
  tokens: WorksheetToken[];
  activeToken: number;
  onListen: () => void;
  onWord: (token: WorksheetToken) => void;
  onRaiseHand: () => void;
  teacherHelp?: ReactNode;
  preparationQuestionCount: number;
  homeworkQuestionCount: number;
  preparationStatus: "idle" | "aligning" | "ready" | "error";
  onStartPreparation: () => void;
  onStartHomework: () => void;
  onChangePath: () => void;
}) {
  return <section className="whole-story-shell">
    <header className="whole-story-heading">
      <div><p className="overline">Whole-story reading</p><h1>{reader.title}</h1></div>
      <button type="button" className="back-button" onClick={onChangePath}>Change reading style</button>
    </header>
    <div className="whole-story-controls">
      <button type="button" className={`listen-button ${listening ? "speaking" : ""}`} onClick={onListen} disabled={loading} aria-busy={loading}>
        <span className="listen-icon">{loading ? "…" : listening && !paused ? "Ⅱ" : "▶"}</span>
        <span><b>{loading ? "Preparing the Voice Teacher…" : paused ? "Continue" : listening ? "Pause" : "Listen"}</b><small>{loading ? "The lesson will begin in a moment." : paused ? "Continue from the same place" : listening ? "The Voice Teacher is reading · words highlight as you listen" : "The Voice Teacher will read in parts and pause for questions"}</small></span>
      </button>
      {listening && !teacherHelp && <RaiseHandButton onClick={onRaiseHand} />}
    </div>
    {teacherHelp}
    <article className="whole-story-paper" lang={language === "ta" ? "ta" : "zh-Hans"}>
      <div className="whole-story-interactive-text">
        {tokens.map((token, index) => token.clickable ? <button type="button" key={`${token.start}-${index}`} className={`worksheet-token ${activeToken === index ? "active" : ""}`} onClick={() => onWord(token)}>{token.value}</button> : <span key={`${token.start}-${index}`}>{token.value}</span>)}
      </div>
    </article>
    <footer className="whole-story-actions">
      {homeworkQuestionCount > 0 ? <>
        <div className="whole-story-choice-copy">
          {preparationStatus === "aligning" ? <div className="preparation-loading" role="status" aria-live="polite">
            <div className="preparation-loading-title"><span aria-hidden="true">⚽</span><div><b>Building your {preparationQuestionCount}-question warm-up…</b><p>Matching each question to your homework.</p></div></div>
            <div className="preparation-goal-dots" aria-hidden="true">{Array.from({ length: Math.min(preparationQuestionCount, 8) }, (_, index) => <span key={index} style={{ animationDelay: `${index * 120}ms` }}>⚽</span>)}</div>
          </div> : preparationStatus === "error" ? <>
            <b>Warm-up unavailable</b>
            <p>Start the homework. No skip goals will be awarded.</p>
          </> : <>
            <b>Choose your kickoff</b>
            <p><strong>{preparationQuestionCount} warm-up {preparationQuestionCount === 1 ? "question" : "questions"}</strong> · 1 goal each</p>
            <small className="kickoff-explainer">Answer → ⚽ moves closer → GOAL!</small>
          </>}
        </div>
        <div className="whole-story-question-choices">
          <button type="button" className={`practice-first-button ${preparationStatus === "aligning" ? "is-loading" : ""}`} onClick={onStartPreparation} disabled={preparationStatus === "aligning" || preparationStatus === "error" || preparationQuestionCount === 0}>
            <span>⚽</span><b>{preparationStatus === "aligning" ? "Preparing warm-up…" : "Play the warm-up"}</b><small>{preparationStatus === "aligning" ? `${preparationQuestionCount} questions · 1 goal each` : `Score up to ${preparationQuestionCount} ${preparationQuestionCount === 1 ? "goal" : "goals"}`}</small>
          </button>
          <button type="button" className="skip-preparation-button" onClick={onStartHomework}>
            <span>→</span><b>Start homework now</b><small>{preparationStatus === "error" ? "No warm-up goals this time" : `Skip warm-up · opponent starts with ${preparationQuestionCount} ${preparationQuestionCount === 1 ? "goal" : "goals"}`}</small>
          </button>
        </div>
      </> : <>
        <p>Finished reading? Continue with a short conversation about the story. An unanswered question is never locked.</p>
        <button type="button" className="primary-button" onClick={onStartPreparation}>Start the conversation <span>→</span></button>
      </>}
    </footer>
  </section>;
}

function CompositionPlanner({
  adultConfirmed,
  familyId,
  reader,
  language,
  narratorVoice,
  onDiscover,
}: {
  adultConfirmed: boolean;
  familyId: string;
  reader: WorksheetReader;
  language: Language;
  narratorVoice: NarratorVoice;
  onDiscover: (item: SatchelItem) => void;
}) {
  const stages = reader.sections.filter((item) => item.section_kind === "composition_stage");
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [completed, setCompleted] = useState<string[]>([]);
  const [incomplete, setIncomplete] = useState<string[]>([]);
  const [visual, setVisual] = useState<{ status: "waiting" | "creating" | "ready" | "failed"; url?: string }>({ status: "waiting" });
  const active = stages[activeIndex] ?? stages[0];

  if (!active) return <section className="composition-empty"><h1>Composition guide</h1><p>This page needs another parent check before its planning stages can be shown.</p></section>;

  function moveTo(index: number) {
    setActiveIndex(Math.max(0, Math.min(stages.length - 1, index)));
  }

  function leaveIncomplete() {
    setIncomplete((current) => current.includes(active.id) ? current : [...current, active.id]);
    if (activeIndex < stages.length - 1) moveTo(activeIndex + 1);
  }

  async function saveAndContinue() {
    const currentText = (drafts[active.id] ?? "").trim();
    if (!currentText) { leaveIncomplete(); return; }
    setCompleted((current) => current.includes(active.id) ? current : [...current, active.id]);
    setIncomplete((current) => current.filter((id) => id !== active.id));
    const accumulated = stages.map((stage) => drafts[stage.id]?.trim()).filter(Boolean).join("\n\n");
    const nextIndex = Math.min(stages.length - 1, activeIndex + 1);
    if (activeIndex < stages.length - 1) moveTo(nextIndex);
    setVisual({ status: "creating", url: visual.url });
    try {
      const response = await fetch("/api/worksheets/illustrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          worksheetId: reader.worksheetId,
          sectionId: `composition-${activeIndex + 1}`,
          title: reader.title,
          sectionTitle: active.title,
          sectionText: accumulated,
          visualBible: reader.visual_bible,
          illustrationPrompt: "Depict only the setting, characters, actions and mood explicitly present in the learner's saved composition ideas so far. Do not invent the next event, a solution, an ending, captions or written words.",
        }),
      });
      const result = await response.json() as { imageUrl?: string };
      if (!response.ok || !result.imageUrl) throw new Error("Illustration failed");
      setVisual({ status: "ready", url: `${result.imageUrl}&v=${activeIndex + 1}` });
    } catch {
      setVisual((current) => ({ status: "failed", url: current.url }));
    }
  }

  return <section className="composition-planner-shell">
    <aside className="composition-visual-panel">
      {visual.url ? <img src={visual.url} alt="The learner's composition ideas brought together as an illustration" /> : <div className="composition-visual-placeholder"><span>✦</span><h2>Your story will appear here</h2><p>Each saved stage adds only the details you have written.</p></div>}
      <div className={`composition-visual-status ${visual.status}`} role="status">
        <b>{visual.status === "creating" ? "Bringing your latest ideas to life…" : visual.status === "ready" ? "The picture now includes your saved ideas." : visual.status === "failed" ? "The picture could not update, but your writing is safe." : "The picture begins after your first saved idea."}</b>
        <small>You can keep writing while the picture updates.</small>
      </div>
    </aside>
    <article className="composition-workspace">
      <header><p className="overline">Composition preparation</p><h1>{reader.title}</h1><p>The textbook structure guides the writing. The picture never invents the next part for you.</p></header>
      <nav className="composition-stage-map" aria-label="Composition planning stages">
        {stages.map((stage, index) => <button type="button" key={stage.id} className={`${index === activeIndex ? "current" : ""} ${completed.includes(stage.id) ? "complete" : ""} ${incomplete.includes(stage.id) ? "incomplete" : ""}`} onClick={() => moveTo(index)}><span>{completed.includes(stage.id) ? "✓" : index + 1}</span><b>{stage.title}</b><small>{completed.includes(stage.id) ? "Saved" : incomplete.includes(stage.id) ? "Incomplete" : index === activeIndex ? "Here" : "Open"}</small></button>)}
      </nav>
      <section className="composition-stage-card">
        <div className="composition-stage-heading"><small>Stage {activeIndex + 1} of {stages.length}</small><AssessmentReviewReader text={active.question.prompt} language={language} level={reader.level} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} onDiscover={onDiscover} teacherTitle={reader.title} contextLabel="composition prompt" teacherQuestion={active.question.prompt} /></div>
        <details className="composition-textbook-cue"><summary>See the textbook guidance for this stage</summary><AssessmentReviewReader text={active.text} language={language} level={reader.level} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} onDiscover={onDiscover} teacherTitle={reader.title} contextLabel="textbook guidance" /></details>
        <label className="composition-draft"><span>Write your idea or paragraph</span><textarea value={drafts[active.id] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [active.id]: event.target.value }))} placeholder="Write in your own words…" /></label>
        <div className="composition-stage-actions"><button type="button" className="back-button" onClick={leaveIncomplete}>Leave incomplete</button><button type="button" className="primary-button" onClick={() => void saveAndContinue()}>Save idea & update picture <span>→</span></button></div>
      </section>
    </article>
  </section>;
}

function WorksheetStudio({
  adultConfirmed,
  familyId,
  initialLanguage,
  initialLevel,
  comfort,
  onClose,
  onOpenSatchel,
  onOpenInterestProfile,
  onDiscover,
  satchelItems,
  satchelPulse,
  onWordsUsed,
  onBackpackContextChange,
  launchMode,
}: {
  adultConfirmed: boolean;
  familyId: string;
  initialLanguage: Language;
  initialLevel: Level;
  comfort: Comfort;
  onClose: () => void;
  onOpenSatchel: () => void;
  onOpenInterestProfile: () => void;
  onDiscover: (item: SatchelItem) => void;
  satchelItems: SatchelItem[];
  satchelPulse: boolean;
  onWordsUsed: (words: string[], language: Language) => void;
  onBackpackContextChange: (context: BackpackStoryContext | null) => void;
  launchMode: WorksheetLaunchMode;
}) {
  const [stage, setStage] = useState<"upload" | "order" | "capture" | "review" | "reader">("upload");
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [level, setLevel] = useState<Level>(initialLevel);
  const [pages, setPages] = useState<UploadedPage[]>([]);
  const [orderConfidence, setOrderConfidence] = useState("");
  const sourceManifest=useRef('');
  const [pendingRestore,setPendingRestore]=useState<{cached:WorksheetSetCache;pages:UploadedPage[];language:Language;level:Level}|null>(null);
  useEffect(()=>{if(pendingRestore&&language===pendingRestore.language&&level===pendingRestore.level){const pending=pendingRestore;setPendingRestore(null);void restoreSetCache(pending.cached,pending.pages).catch(e=>setError(e.message));}},[pendingRestore,language,level]);
  const packageInput=useRef<HTMLInputElement>(null);
  const [importedPackage,setImportedPackage]=useState<ReturnType<typeof parseLessoncraftPackage>|null>(null);
  const [savedSources,setSavedSources]=useState<{cacheKey:string;title:string;language:Language;level:Level}[]>([]);
  async function libraryRequest(action:string,extra:Record<string,unknown>={}){const r=await fetch('/api/worksheets/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed,familyId,action,...extra})});const data=await r.json() as any;if(!r.ok)throw Error(data.error||'Saved source unavailable');return data;}
  useEffect(()=>{if(adultConfirmed&&familyId)void libraryRequest('list').then(d=>setSavedSources(d.items)).catch(()=>{});},[adultConfirmed,familyId]);
  async function saveSourcePages(sourcePages:UploadedPage[]){
    for(const page of sourcePages){if(page.storedId)continue;const form=new FormData();form.set('familyId',familyId);form.set('adultConfirmed',String(adultConfirmed));form.set('file',page.file);const r=await fetch('/api/worksheets/library',{method:'POST',body:form});const d=await r.json() as any;if(!r.ok)throw Error(d.error||'The original page could not be saved');page.storedId=d.id;}
  }
  async function saveSourceManifest(sourcePages:UploadedPage[],cacheKey:string){const signature=cacheKey+sourcePages.map(p=>p.storedId).join(':')+language+level;if(sourceManifest.current===signature)return;if(!cacheKey||!sourcePages.length||sourcePages.some(p=>!p.storedId))return;await libraryRequest('save',{cacheKey,title:sourcePages[0].sourceDocumentName,language,level,pages:sourcePages.map(({file,previewUrl,...p})=>({...p,fileName:file.name,mime:file.type}))});sourceManifest.current=signature;const d=await libraryRequest('list');setSavedSources(d.items);}
  async function openSavedSource(item:{cacheKey:string;language:Language;level:Level}){
    setBusy(true);setError('');try{const d=await libraryRequest('open',{cacheKey:item.cacheKey});setLanguage(d.language);setLevel(d.level);const restored:UploadedPage[]=[];for(const p of d.pages){const response=await fetch(`/api/worksheets/library?familyId=${encodeURIComponent(familyId)}&id=${encodeURIComponent(p.storedId)}`);if(!response.ok)throw Error('A saved original could not be opened.');const blob=await response.blob(),file=new File([blob],p.fileName,{type:p.mime});restored.push({...p,file,previewUrl:URL.createObjectURL(file)});}setCacheKeyRef.current=item.cacheKey;const response=await fetch('/api/worksheets/cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed,familyId,action:'lookup',cacheKind:'set',cacheKey:item.cacheKey,language:d.language,level:d.level})});const cached=await response.json() as any;if(cached.found)setPendingRestore({cached:cached.payload,pages:restored,language:d.language,level:d.level});else{commitPages(restored);setStage('order');setCacheNotice('Originals restored. Start reading to prepare this saved set.');}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}

  const [batches, setBatches] = useState<WorksheetBatch[]>([]);
  const [activeBatchIndex, setActiveBatchIndex] = useState(0);
  const [extracted, setExtracted] = useState<ExtractedWorksheet | null>(null);
  const [confirmedText, setConfirmedText] = useState("");
  const [confirmedOtherText, setConfirmedOtherText] = useState("");
  const [sourceChecked, setSourceChecked] = useState(false);
  const [autoAcceptHigh,setAutoAcceptHigh]=useState(false);
  useEffect(()=>{setAutoAcceptHigh(localStorage.getItem(`storylight:review-policy:${familyId}`)==='true');},[familyId]);
  const [recaptureNote, setRecaptureNote] = useState("");
  const [captureIssue, setCaptureIssue] = useState<WorksheetCaptureIssue | null>(null);
  const [reader, setReader] = useState<WorksheetReader | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cacheNotice, setCacheNotice] = useState("");
  const [analysisSeconds, setAnalysisSeconds] = useState(0);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [pipelineClock, setPipelineClock] = useState(() => Date.now());
  const [activeToken, setActiveToken] = useState(-1);
  const [activeQuestionToken, setActiveQuestionToken] = useState(-1);
  const [activeWholeStoryToken, setActiveWholeStoryToken] = useState(-1);
  const narration = useOpenAINarration(adultConfirmed);
  const [narratorVoice] = useNarratorVoice();
  const [readingPath, setReadingPath] = useState<ReadingPath>("choose");
  const [wholeStoryStage, setWholeStoryStage] = useState<WholeStoryStage>("reading");
  const [wholeStoryReadingPosition, setWholeStoryReadingPosition] = useState(0);
  const [preparationStatus, setPreparationStatus] = useState<"idle" | "aligning" | "ready" | "error">("idle");
  const [skippedPreparationGoals, setSkippedPreparationGoals] = useState(0);
  const [incompleteSections, setIncompleteSections] = useState<number[]>([]);
  const [activitySpark, setActivitySpark] = useState(defaultInterestProfile.today);
  const [assessmentProfile, setAssessmentProfile] = useState<{ strengths: string[]; focusAreas: string[] } | null>(null);
  const [backpackNotice, setBackpackNotice] = useState("");
  const [teacherRequest, setTeacherRequest] = useState<ClassroomTeacherRequest | null>(null);
  const [wordActivity, setWordActivity] = useState<WorksheetWordActivity | null>(null);
  const [wordActivityStatus, setWordActivityStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [activityAnswer, setActivityAnswer] = useState("");
  const [answeredSections, setAnsweredSections] = useState<number[]>([]);
  const [attemptedSections, setAttemptedSections] = useState<number[]>([]);
  const [checkingSections, setCheckingSections] = useState<number[]>([]);
  const [handwritingResults, setHandwritingResults] = useState<Record<number, HandwritingFeedback>>({});
  const [writtenSections, setWrittenSections] = useState<number[]>([]);
  const [firstAttemptScores, setFirstAttemptScores] = useState<Record<number, FootballAttemptResult>>({});
  const [successMessages, setSuccessMessages] = useState<Record<number, string>>({});
  const [rewardAvailable, setRewardAvailable] = useState(false);
  const [rewardOpen, setRewardOpen] = useState(false);
  const [wordPanel, setWordPanel] = useState<{
    word: string;
    context: string;
    rung: number;
    loading: boolean;
    help?: GlossaryEntry;
    error?: string;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const storyStartRef = useRef<HTMLElement | null>(null);
  const tokenRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const questionTokenRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wordCache = useRef(new Map<string, GlossaryEntry>());
  const pagesRef = useRef<UploadedPage[]>([]);
  const batchesRef = useRef<WorksheetBatch[]>([]);
  const readerRef = useRef<WorksheetReader | null>(null);
  const pipelineRun = useRef(0);
  const activityQueueRunning = useRef(false);
  const orderAnalysisTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setCacheKeyRef = useRef("");
  const setCacheSaveChain = useRef<Promise<void>>(Promise.resolve());
  const preparationAlignmentRef = useRef("");
  const backpackNoticeTimer = useRef<number | null>(null);
  const teacherHelpAnchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!adultConfirmed || !familyId) return;
    let cancelled = false;
    fetch("/api/assessments/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adultConfirmed, action: "load", familyId, language, level }),
    }).then((response) => responseJson<{ found?: boolean; profile?: { strengths: string[]; focusAreas: string[] } | null }>(response)).then((result) => {
      if (!cancelled) setAssessmentProfile(result.found && result.profile ? result.profile : null);
    }).catch(() => { if (!cancelled) setAssessmentProfile(null); });
    return () => { cancelled = true; };
  }, [adultConfirmed, familyId, language, level]);

  const section = reader?.sections[sectionIndex];
  const sectionNarrationStatus = section && narration.activeSpeech?.text === section.text ? narration.status : "idle";
  const currentReaderBatchIndex = section
    ? Math.max(0, Number(section.id.match(/^batch-(\d+)-/)?.[1] ?? 1) - 1)
    : -1;
  const currentPageSectionIndices = useMemo(() => {
    if (!reader || currentReaderBatchIndex < 0) return [];
    const prefix = `batch-${currentReaderBatchIndex + 1}-`;
    return reader.sections.map((item, index) => item.id.startsWith(prefix) ? index : -1).filter((index) => index >= 0);
  }, [reader, currentReaderBatchIndex]);
  const currentPageSections = currentPageSectionIndices.map((index) => reader?.sections[index]).filter((item): item is WorksheetSection => Boolean(item));
  const worksheetSatchelItems = useMemo(
    () => satchelItems.filter((item) => item.language === language).sort((first, second) => (first.uses ?? 0) - (second.uses ?? 0)).slice(0, 8),
    [satchelItems, language],
  );
  const pageQuestionIndex = Math.max(0, currentPageSectionIndices.indexOf(sectionIndex));
  const pageQuestionPosition = pageQuestionIndex + 1;
  const pageQuestionCount = Math.max(1, currentPageSectionIndices.length);
  const pageCompletedCount = currentPageSectionIndices.filter((index) => answeredSections.includes(index)).length;
  const pageAttemptedCount = currentPageSectionIndices.filter((index) => attemptedSections.includes(index) || answeredSections.includes(index)).length;
  const pageLearnerScore = currentPageSectionIndices.filter((index) => firstAttemptScores[index] === "learner").length;
  const pageOpponentScore = currentPageSectionIndices.filter((index) => firstAttemptScores[index] === "opponent").length;
  const overallLearnerGoals = Object.values(firstAttemptScores).filter((result) => result === "learner").length;
  const overallOpponentGoals = Object.values(firstAttemptScores).filter((result) => result === "opponent").length;
  const currentQuestionAttempted = attemptedSections.includes(sectionIndex) || answeredSections.includes(sectionIndex);
  const pageReadyToContinue = currentPageSectionIndices.every((index) => attemptedSections.includes(index) || answeredSections.includes(index));
  const currentPageNumber = batches[currentReaderBatchIndex]?.pageStart ?? currentReaderBatchIndex + 1;
  const pageItems = currentPageSections.map((item, index) => ({
    label: item.item_label || `Q${index + 1}`,
    completed: answeredSections.includes(currentPageSectionIndices[index]),
    attempted: attemptedSections.includes(currentPageSectionIndices[index]),
    checking: checkingSections.includes(currentPageSectionIndices[index]),
    current: currentPageSectionIndices[index] === sectionIndex,
    sectionIndex: currentPageSectionIndices[index],
    result: firstAttemptScores[currentPageSectionIndices[index]],
    written: writtenSections.includes(currentPageSectionIndices[index]),
  }));
  const guidedExercise = section?.section_kind === "exercise_item";
  const currentResponseMode = section ? worksheetResponseMode(section, language) : "spoken";
  const writtenGoalRequired = guidedExercise && currentResponseMode === "written";
  const compositionGuide = reader?.learning_mode === "composition_guide";
  const readAlong = reader?.learning_mode === "read_along";
  const hasNextSection = Boolean(reader && sectionIndex < reader.sections.length - 1);
  const nextSectionOnCurrentPage = currentPageSectionIndices.includes(sectionIndex + 1);
  const canMoveToNextSection = guidedExercise
    ? nextSectionOnCurrentPage ? currentQuestionAttempted : pageReadyToContinue
    : true;
  const nextSectionLabel = guidedExercise
    ? nextSectionOnCurrentPage
      ? currentQuestionAttempted ? "Next question" : "Try this question, or choose another above"
      : pageReadyToContinue ? `Continue to Page ${batches[currentReaderBatchIndex + 1]?.pageStart ?? currentPageNumber + 1}` : "Try every question on this page"
    : answeredSections.includes(sectionIndex)
      ? readingPath === "whole_story" ? "Next question" : "Next paragraph"
      : readingPath === "whole_story" ? "Next question · leave incomplete" : "Next paragraph · leave incomplete";
  const readerHasExercise = Boolean(reader?.sections.some((item) => item.section_kind === "exercise_item"));
  const firstHomeworkSectionIndex = reader?.sections.findIndex((item) => item.section_kind === "exercise_item") ?? -1;
  const homeworkQuestionCount = reader?.sections.filter((item) => item.section_kind === "exercise_item").length ?? 0;
  const preparationGoalCount = reader?.sections.filter((item) => item.section_kind === "reading").length ?? 0;
  const wholeStoryText = useMemo(() => reader?.sections.filter((item) => item.section_kind === "reading").map((item) => item.text).join("\n\n") ?? "", [reader]);
  const wholeStoryReadingIndices = useMemo(() => reader?.sections.map((item, index) => item.section_kind === "reading" ? index : -1).filter((index) => index >= 0) ?? [], [reader]);
  const wholeStoryTokens = useMemo(() => makeWorksheetTokens(wholeStoryText, language), [wholeStoryText, language]);
  const wholeStoryActiveIndex = wholeStoryReadingIndices[wholeStoryReadingPosition] ?? wholeStoryReadingIndices[0] ?? -1;
  const wholeStoryActiveText = wholeStoryActiveIndex >= 0 ? reader?.sections[wholeStoryActiveIndex]?.text ?? "" : "";
  const wholeStoryNarrationStatus = wholeStoryActiveText && narration.activeSpeech?.text === wholeStoryActiveText ? narration.status : "idle";
  const wholeStorySpeaking = wholeStoryNarrationStatus === "playing" || wholeStoryNarrationStatus === "paused";
  const wholeStoryTeacherSectionIndex = teacherRequest?.sectionIndex ?? wholeStoryActiveIndex;
  const wholeStoryTeacherSection = wholeStoryTeacherSectionIndex >= 0 ? reader?.sections[wholeStoryTeacherSectionIndex] : undefined;
  const tokens = useMemo(
    () => section ? makeWorksheetTokens(section.text, language) : [],
    [section, language],
  );
  const questionTokens = useMemo(
    () => section ? makeWorksheetTokens(section.question.prompt, language) : [],
    [section, language],
  );
  const currentPreparationTargets = useMemo(() => {
    if (!reader || !section) return [];
    if (section.section_kind === "exercise_item") {
      return [`${section.item_label || "Homework question"}: ${section.text}`];
    }
    const printedItems = reader.sections.filter((item) => item.section_kind === "exercise_item");
    const alignedTargets = (section.question.preparation_for ?? []).flatMap((label) => printedItems
      .filter((item) => item.section_kind === "exercise_item" && (item.item_label || "").trim() === label.trim())
      .map((item) => `${label}: ${item.text}`));
    if (alignedTargets.length) return alignedTargets;
    return printedItems.map((item, index) => `${item.item_label || `Q${index + 1}`}: ${item.text}`);
  }, [reader, section]);
  const hasPendingBatches = batches.some((batch) => ["queued", "reading", "review", "build_queued", "building"].includes(batch.status));
  const activeReviewBatch = batches[activeBatchIndex];
  const nextParentCheckIndex = batches.findIndex((batch, index) => (
    index !== activeBatchIndex
    && batch.status === "review"
    && !batch.sourceChecked
    && Boolean(batch.extracted)
  ));

  const preparationSignature = useMemo(() => {
    if (!reader) return "";
    const readingSections = reader.sections.filter((item) => item.section_kind === "reading");
    const homeworkSections = reader.sections.filter((item) => item.section_kind === "exercise_item");
    if (!readingSections.length || !homeworkSections.length) return "";
    return `${reader.worksheetId}:${readingSections.map((item) => item.id).join("|")}:${homeworkSections.map((item) => `${item.id}:${item.text}`).join("|")}`;
  }, [reader]);

  useEffect(() => {
    if (!reader || !preparationSignature) {
      setPreparationStatus("idle");
      return;
    }
    const readingSections = reader.sections.filter((item) => item.section_kind === "reading");
    if (readingSections.every((item) => item.question.preparation_aligned && item.question.preparation_quality_version === 3)) {
      preparationAlignmentRef.current = preparationSignature;
      setPreparationStatus("ready");
      return;
    }
    if (preparationAlignmentRef.current === preparationSignature) return;
    preparationAlignmentRef.current = preparationSignature;
    setPreparationStatus("aligning");
    const homeworkSections = reader.sections.filter((item) => item.section_kind === "exercise_item");
    let cancelled = false;
    fetch("/api/worksheets/align-preparation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adultConfirmed,
        familyId,
        language,
        level,
        readingSections: readingSections.map((item) => ({ id: item.id, title: item.title, text: item.text, currentPrompt: item.question.prompt })),
        homeworkItems: homeworkSections.map((item, index) => ({
          label: item.item_label || `Q${index + 1}`,
          printedMaterial: item.text,
          taskPrompt: item.question.prompt,
        })),
      }),
    }).then(async (response) => {
      const result = await responseJson<{ sections?: Array<{ section_id: string; prompt: string; thinking_goal: string; evidence_prompt: string; key_points: string[]; preparation_for: string[] }>; error?: string }>(response);
      if (!response.ok || !result.sections) throw new Error(result.error || "Homework preparation could not be aligned.");
      return result.sections;
    }).then((alignments) => {
      if (cancelled || preparationAlignmentRef.current !== preparationSignature) return;
      const byId = new Map(alignments.map((item) => [item.section_id, item]));
      const currentReader = readerRef.current;
      if (!currentReader) return;
      const alignedReader: WorksheetReader = {
        ...currentReader,
        sections: currentReader.sections.map((item) => {
          if (item.section_kind !== "reading") return item;
          const alignment = byId.get(item.id);
          if (!alignment) return item;
          return {
            ...item,
            question: {
              prompt: alignment.prompt,
              thinking_goal: alignment.thinking_goal,
              evidence_prompt: alignment.evidence_prompt,
              key_points: alignment.key_points,
              preparation_for: alignment.preparation_for,
              preparation_aligned: true,
              preparation_quality_version: 3,
            },
          };
        }),
      };
      commitReader(alignedReader);
      void persistSetCache(batchesRef.current, alignedReader);
      setPreparationStatus("ready");
    }).catch(() => {
      if (!cancelled) setPreparationStatus("error");
    });
    return () => { cancelled = true; };
    // The signature snapshots the exact reader sections used for this request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adultConfirmed, familyId, language, level, preparationSignature]);

  useEffect(() => {
    if (!reader || hasPendingBatches) {
      setRewardAvailable(false);
      return;
    }
    const allFinished = readerHasExercise
      ? reader.sections.every((_, index) => attemptedSections.includes(index) || answeredSections.includes(index))
      : reader.sections.every((_, index) => answeredSections.includes(index));
    setRewardAvailable(allFinished);
  }, [reader, readerHasExercise, hasPendingBatches, attemptedSections, answeredSections]);

  useEffect(() => {
    if (!worksheetInterestActivitiesEnabled) return undefined;
    const apply = () => setActivitySpark(loadInterestProfile().today);
    const timer = window.setTimeout(apply, 0);
    window.addEventListener("storylight-interest-profile", apply);
    return () => { window.clearTimeout(timer); window.removeEventListener("storylight-interest-profile", apply); };
  }, []);

  // Each worksheet item receives a fresh activity built from its exact source and question.
  useEffect(() => {
    if (!section || section.section_kind !== "exercise_item") {
      setWordActivity(null);
      setWordActivityStatus("idle");
      setActivityAnswer("");
      return;
    }
    let cancelled = false;
    setWordActivity(null);
    setWordActivityStatus("loading");
    setActivityAnswer("");
    fetch("/api/worksheets/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adultConfirmed,
        language,
        level,
        itemLabel: section.item_label,
        sourceText: section.text,
        questionPrompt: section.question.prompt,
        goal: section.support?.goal,
        keyPoints: section.question.key_points,
      }),
    }).then(async (response) => {
      const result = await responseJson<WorksheetWordActivity>(response);
      if (!response.ok) throw new Error(result.error || "Activity preparation failed.");
      return result;
    }).then((result) => {
      if (!cancelled) { setWordActivity(result); setWordActivityStatus("ready"); }
    }).catch(() => {
      if (!cancelled) setWordActivityStatus("error");
    });
    return () => { cancelled = true; };
  }, [adultConfirmed, language, level, section]);

  useEffect(() => {
    const hasActiveRead = batches.some((batch) => batch.status === "reading" || batch.status === "building");
    if (!hasActiveRead) {
      setPipelineClock(Date.now());
      return;
    }
    const tick = () => setPipelineClock(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [batches]);

  useEffect(() => {
    if (analysisStartedAt === null) {
      setAnalysisSeconds(0);
      return;
    }
    const tick = () => setAnalysisSeconds(Math.max(0, Math.floor((Date.now() - analysisStartedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [analysisStartedAt]);

  function commitPages(next: UploadedPage[]) {
    pagesRef.current = next;
    setPages(next);
  }

  function commitBatches(next: WorksheetBatch[]) {
    batchesRef.current = next;
    setBatches(next);
  }

  function updateBatch(index: number, patch: Partial<WorksheetBatch>) {
    const next = batchesRef.current.map((batch, position) => position === index ? { ...batch, ...patch } : batch);
    commitBatches(next);
  }

  function showCaptureIssue(problem: WorksheetPageCaptureError, batchIndex: number, openRecovery = true) {
    updateBatch(batchIndex, {
      status: "failed",
      error: problem.message,
      diagnostic: problem.diagnosticNote || problem.message,
      readStartedAt: undefined,
      retryingRegion: problem.regionNumber,
    });
    if (!openRecovery) {
      setCacheNotice(`Page ${problem.pageNumber} needs another read. Pages already ready for review or learning remain available.`);
      return;
    }
    setCaptureIssue({
      batchIndex,
      pageNumber: problem.pageNumber,
      pageName: problem.pageName,
      issueKinds: problem.issueKinds,
      visibleLabels: problem.visibleLabels,
      diagnosticNote: problem.diagnosticNote,
      regionNumber: problem.regionNumber,
    });
    setActiveBatchIndex(batchIndex);
    setError("");
    if (readerRef.current) {
      setCacheNotice(`Page ${problem.pageNumber} needs another read, but your ready activity is still available. Retry that page whenever you are ready.`);
      setStage("reader");
    } else {
      setCacheNotice("");
      setStage("capture");
    }
  }

  function commitReader(next: WorksheetReader | null) {
    readerRef.current = next;
    setReader(next);
    if (!next) {
      onBackpackContextChange(null);
      return;
    }
    const readingText = next.sections.filter((item) => item.section_kind === "reading").map((item) => item.text).filter(Boolean).join("\n\n");
    const fallbackText = next.sections.map((item) => item.text).filter(Boolean).join("\n\n");
    onBackpackContextChange({ language: next.language, level: next.level, title: next.title, text: readingText || fallbackText });
  }

  async function cacheRequest<T>(
    action: "lookup" | "save",
    cacheKind: "set" | "batch",
    cacheKey: string,
    payload?: T,
  ) {
    const response = await fetch("/api/worksheets/cache", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adultConfirmed,
        action,
        familyId,
        cacheKind,
        cacheKey,
        language,
        level,
        payload,
      }),
    });
    const result = await responseJson<WorksheetCacheResponse<T>>(response);
    if (!response.ok) throw new Error(result.error || "The saved worksheet analysis is unavailable.");
    return result;
  }

  async function persistSetCache(
    nextBatches = batchesRef.current,
    nextReader = readerRef.current,
    nextPages = pagesRef.current,
    confidence = orderConfidence,
  ) {
    if (!setCacheKeyRef.current || !nextPages.length || !familyId) return;
    const stableBatches = nextBatches.map((batch) => ({
      ...batch,
      status: batch.status === "reading"
        ? "queued" as const
        : batch.status === "building"
          ? batch.sourceChecked ? "build_queued" as const : "queued" as const
          : batch.status,
      error: batch.status === "failed" ? batch.error : "",
      diagnostic: batch.status === "failed" ? batch.diagnostic : "",
      attempt: undefined,
      maxAttempts: undefined,
      readStartedAt: undefined,
      regionCount: undefined,
      regionsCompleted: undefined,
      retryingRegion: undefined,
    }));
    const stableReader = nextReader ? {
      ...nextReader,
      sections: nextReader.sections.map((item) => ({
        ...item,
        imageStatus: item.imageStatus === "creating" ? "waiting" as const : item.imageStatus,
      })),
    } : null;
    const payload: WorksheetSetCache = {
      orderedHashes: nextPages.map((page) => page.hash),
      orderNotes: nextPages.map((page) => page.orderNote ?? ""),
      orderConfidence: confidence,
      batches: stableBatches,
      reader: stableReader,
    };
    const cacheKey = setCacheKeyRef.current;
    setCacheSaveChain.current = setCacheSaveChain.current
      .catch(() => undefined)
      .then(async () => {
        await cacheRequest("save", "set", cacheKey, payload);
      })
      .catch((problem) => {
        console.error("Worksheet set cache save failed", problem);
        setError("Your latest changes could not be saved. Keep this page open and retry.");
      });
    await setCacheSaveChain.current;
    if(nextPages.every(p=>p.storedId))await saveSourceManifest(nextPages,cacheKey);
  }

  function pagesInCachedOrder(sourcePages: UploadedPage[], cached: WorksheetSetCache) {
    if (cached.orderedHashes.length !== sourcePages.length) return null;
    const candidates = new Map<string, UploadedPage[]>();
    sourcePages.forEach((page) => candidates.set(page.hash, [...(candidates.get(page.hash) ?? []), page]));
    const ordered = cached.orderedHashes.flatMap((hash, index) => {
      const matches = candidates.get(hash);
      const page = matches?.shift();
      return page ? [{ ...page, orderNote: cached.orderNotes[index] || "Restored from the saved page order." }] : [];
    });
    return ordered.length === sourcePages.length ? ordered : null;
  }

  async function restoreSetCache(cached: WorksheetSetCache, sourcePages: UploadedPage[]) {
    const ordered = pagesInCachedOrder(sourcePages, cached);
    if (!ordered) return false;
    const restoredBatches = cached.batches.map((batch) => ({
      ...batch,
      status: batch.status === "reading"
        ? "queued" as const
        : batch.status === "building" || (batch.status === "review" && batch.sourceChecked)
          ? "build_queued" as const
          : batch.status,
    }));
    const restoredReader = cached.reader ? {
      ...cached.reader,
      sections: cached.reader.sections.map((item) => ({
        ...item,
        imageStatus: item.imageStatus === "creating" ? "waiting" as const : item.imageStatus,
      })),
    } : null;
    commitPages(ordered);
    commitBatches(restoredBatches);
    commitReader(restoredReader);
    setOrderConfidence(cached.orderConfidence || "Previous page order restored from this browser's saved analysis.");
    setAnsweredSections([]);
    setAttemptedSections([]);
    setCheckingSections([]);
    setHandwritingResults({});
    setWrittenSections([]);
    setFirstAttemptScores({});
    setSuccessMessages({});
    setIncompleteSections([]);
    setReadingPath("choose");
    setWholeStoryStage("reading");
    setSkippedPreparationGoals(0);
    setRewardAvailable(false);
    setRewardOpen(false);
    const nextRunId = pipelineRun.current + 1;
    pipelineRun.current = nextRunId;

    if (restoredReader?.sections.length) {
      setLanguage(restoredReader.language);
      setLevel(restoredReader.level);
      setSectionIndex(0);
      setStage("reader");
      setCacheNotice("Previous analysis found — opening the saved reader without repeating OCR, sectioning or completed illustrations.");
      const missingImages = restoredReader.sections.filter((item) => !item.imageUrl);
      if (missingImages.length) void generateSceneImages(restoredReader, missingImages);
      if (restoredBatches.slice(1).some((batch) => batch.status === "queued" || batch.status === "failed")) {
        void processRemainingBatches(nextRunId);
      }
      if (restoredBatches.some((batch) => batch.status === "build_queued")) {
        window.setTimeout(() => void drainActivityBuildQueue(), 0);
      }
      return true;
    }

    const firstUncheckedReview = restoredBatches.findIndex((batch) => batch.status === "review" && !batch.sourceChecked && !!batch.extracted);
    const firstQueuedReview = restoredBatches.findIndex((batch) => batch.status === "build_queued" && !!batch.extracted);
    const firstReview = firstUncheckedReview >= 0 ? firstUncheckedReview : firstQueuedReview;
    if (firstReview >= 0) {
      const batch = restoredBatches[firstReview];
      setActiveBatchIndex(firstReview);
      setExtracted(batch.extracted ?? null);
      setConfirmedText(batch.confirmedText ?? batch.extracted?.passage_text ?? "");
      setConfirmedOtherText(batch.confirmedOtherText ?? batch.extracted?.other_text ?? "");
      setSourceChecked(Boolean(batch.sourceChecked));
      setStage("review");
      setCacheNotice(batch.status === "build_queued"
        ? "Previously accepted text found — its activities are now queued for preparation."
        : "Previous text analysis found — opening the saved parent review without reading these pages again.");
      if (restoredBatches.some((item) => item.status === "build_queued")) {
        window.setTimeout(() => void drainActivityBuildQueue(), 0);
      }
      return true;
    }

    setStage("order");
    setCacheNotice("Previous page order found. Storylight will reuse any saved reading batches as they are needed.");
    window.setTimeout(() => void startBatchAnalysis(ordered), 0);
    return true;
  }

  function stopWorksheetNarration() {
    narration.stop();
    setActiveToken(-1);
    setActiveQuestionToken(-1);
    setActiveWholeStoryToken(-1);
  }

  useEffect(() => {
    stopWorksheetNarration();
    setWordPanel(null);
    setTeacherRequest(null);
    tokenRefs.current = [];
    questionTokenRefs.current = [];
    return () => stopWorksheetNarration();
  }, [sectionIndex, stage]);

  useEffect(() => {
    if (activeToken < 0) return;
    const token = tokenRefs.current[activeToken];
    if (!token) return;
    const frame = window.requestAnimationFrame(() => {
      const bounds = token.getBoundingClientRect();
      const topGuard = 170;
      const bottomGuard = window.innerHeight - 130;
      if (bounds.top < topGuard || bounds.bottom > bottomGuard) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        token.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center", inline: "nearest" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeToken]);

  useEffect(() => () => {
    pipelineRun.current += 1;
    if (orderAnalysisTimer.current) clearTimeout(orderAnalysisTimer.current);
    pagesRef.current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    if (backpackNoticeTimer.current) window.clearTimeout(backpackNoticeTimer.current);
  }, []);

  function speakWorksheetWord(text: string, slow = true) {
    if (narration.status === "loading" && narration.activeSpeech?.text === text) return;
    stopWorksheetNarration();
    void narration.play({
      text,
      language,
      voice: narratorVoice,
      mode: slow ? "word" : "sentence",
    });
  }

  function openStorySection(index: number) {
    const currentReader = readerRef.current;
    const currentSection = currentReader?.sections[sectionIndex];
    const targetSection = currentReader?.sections[index];
    if (!currentSection || !targetSection) return;
    if (currentSection.section_kind === "exercise_item" && targetSection.section_kind === "exercise_item") {
      const currentPage = Number(currentSection.id.match(/^batch-(\d+)-/)?.[1] ?? 1);
      const targetPage = Number(targetSection.id.match(/^batch-(\d+)-/)?.[1] ?? 1);
      if (targetPage > currentPage) {
        const pagePrefix = `batch-${currentPage}-`;
        const triedCurrentPage = currentReader.sections.every((item, position) => !item.id.startsWith(pagePrefix) || attemptedSections.includes(position) || answeredSections.includes(position));
        if (!triedCurrentPage) return;
      }
    } else if (currentSection.section_kind === "reading" && index > sectionIndex && !answeredSections.includes(sectionIndex) && !attemptedSections.includes(sectionIndex)) {
      setIncompleteSections((current) => current.includes(sectionIndex) ? current : [...current, sectionIndex]);
    }
    stopWorksheetNarration();
    setSectionIndex(index);
    window.setTimeout(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      storyStartRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }, 0);
  }

  function speakSection() {
    if (!section) return;
    if (sectionNarrationStatus === "playing") {
      narration.pause();
      return;
    }
    if (sectionNarrationStatus === "paused") {
      setTeacherRequest(null);
      void narration.resume();
      return;
    }
    if (sectionNarrationStatus === "loading") return;
    stopWorksheetNarration();
    setTeacherRequest(null);

    const tokenAt = (charIndex: number) => {
      const direct = tokens.findIndex((token) => token.clickable && charIndex >= token.start && charIndex < token.end);
      if (direct >= 0) return direct;
      return tokens.findIndex((token) => token.clickable && token.start >= charIndex);
    };
    const firstToken = tokenAt(0);
    if (firstToken >= 0) setActiveToken(firstToken);
    void narration.play({
      text: section.text,
      language,
      voice: narratorVoice,
      mode: "story",
      onWord: (wordIndex, spokenWords) => {
        const nextToken = narrationTokenIndex(wordIndex, spokenWords, tokens);
        if (nextToken >= 0) setActiveToken(nextToken);
      },
      onProgress: (progress) => {
        if (progress >= 1) return;
        const nextToken = tokenAt(Math.floor(section.text.length * progress));
        if (nextToken >= 0) setActiveToken(nextToken);
      },
      onEnded: () => {
        setActiveToken(-1);
        setTeacherRequest({ kind: "checkpoint", context: "question", focusWord: "", signal: Date.now() });
      },
    });
  }

  function playWholeStorySection(position: number) {
    if (!reader) return;
    const readerSectionIndex = wholeStoryReadingIndices[position];
    const readingSection = reader.sections[readerSectionIndex];
    if (!readingSection) return;
    stopWorksheetNarration();
    setTeacherRequest(null);
    setWholeStoryReadingPosition(position);
    const sectionStart = wholeStoryText.indexOf(readingSection.text);
    const sectionTokens = makeWorksheetTokens(readingSection.text, language);
    const firstLocalToken = sectionTokens.findIndex((token) => token.clickable);
    if (firstLocalToken >= 0) {
      const globalToken = wholeStoryTokens.findIndex((token) => token.start >= sectionStart + sectionTokens[firstLocalToken].start && token.clickable);
      if (globalToken >= 0) setActiveWholeStoryToken(globalToken);
    }
    void narration.play({
      text: readingSection.text,
      language,
      voice: narratorVoice,
      mode: "story",
      onWord: (wordIndex, spokenWords) => {
        const localToken = narrationTokenIndex(wordIndex, spokenWords, sectionTokens);
        if (localToken < 0) return;
        const globalToken = wholeStoryTokens.findIndex((token) => token.start >= sectionStart + sectionTokens[localToken].start && token.clickable);
        if (globalToken >= 0) setActiveWholeStoryToken(globalToken);
      },
      onEnded: () => {
        setActiveWholeStoryToken(-1);
        setTeacherRequest({ kind: "checkpoint", context: "question", focusWord: "", signal: Date.now(), sectionIndex: readerSectionIndex });
      },
    });
  }

  function speakWholeStory() {
    if (!wholeStoryActiveText) return;
    if (wholeStoryNarrationStatus === "playing") {
      narration.pause();
      return;
    }
    if (wholeStoryNarrationStatus === "paused") {
      setTeacherRequest(null);
      void narration.resume();
      return;
    }
    if (wholeStoryNarrationStatus === "loading") return;
    playWholeStorySection(wholeStoryReadingPosition);
  }

  async function addFiles(next: File[]) {
    const accepted = next.filter((file) => ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)).slice(0, 8);
    pagesRef.current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    commitPages([]);
    commitBatches([]);
    commitReader(null);
    setCaptureIssue(null);
    setAnalysisStartedAt(null);
    pipelineRun.current += 1;
    setCacheNotice("Creating private page fingerprints so Storylight can recognise a re-upload…");
    setBusy(true);
    setError("");
    try {
      const sourceHashes = await Promise.all(accepted.map((file) => digestFile(file)));
      const uploaded: UploadedPage[] = [];
      for (let sourceIndex = 0; sourceIndex < accepted.length; sourceIndex += 1) {
        const source = accepted[sourceIndex];
        const sourceHash = sourceHashes[sourceIndex];
        const sourceDocumentId = `${sourceHash}-${sourceIndex}`;
        const preparedPages = source.type === "application/pdf"
          ? await (async () => {
              setCacheNotice(`Separating ${source.name} into complete pages without cropping…`);
              return splitPdfIntoFullPageImages(source);
            })()
          : [source];

        if (uploaded.length + preparedPages.length > MAX_WORKSHEET_PAGES) {
          throw new Error(`Please upload at most ${MAX_WORKSHEET_PAGES} worksheet pages at a time.`);
        }

        for (let sourcePageIndex = 0; sourcePageIndex < preparedPages.length; sourcePageIndex += 1) {
          const prepared = preparedPages[sourcePageIndex];
          const originalIndex = uploaded.length;
          const hash = source.type === "application/pdf"
            ? await digestText(`${WORKSHEET_CACHE_VERSION}:source:${sourceHash}:pdf-page:${sourcePageIndex + 1}`)
            : sourceHash;
          uploaded.push({
            id: `${hash}-${originalIndex}`,
            file: prepared,
            previewUrl: URL.createObjectURL(prepared),
            originalIndex,
            hash,
            sourceDocumentId,
            sourceDocumentName: source.name,
            sourceKind: source.type === "application/pdf" ? "pdf" : "image",
            sourcePageNumber: sourcePageIndex + 1,
          });
        }
      }
      await saveSourcePages(uploaded);
      commitPages(uploaded);
      setCacheKeyRef.current = await worksheetSetKey(uploaded);
      await saveSourceManifest(uploaded,setCacheKeyRef.current);
      setOrderConfidence("");
      setConfirmedText("");
      setConfirmedOtherText("");
      setSourceChecked(false);
      setRecaptureNote("");
      setCacheNotice("");
      setError(accepted.length === next.length ? "" : "Only the first eight PDF, JPG, PNG or WEBP source files can be used.");
    } catch (problem) {
      setCacheNotice("");
      setError(problem instanceof Error ? problem.message : "Storylight could not prepare these pages. Please select them again.");
    } finally {
      setBusy(false);
    }
  }

  function movePage(index: number, amount: number) {
    const target = index + amount;
    if (target < 0 || target >= pagesRef.current.length) return;
    const next = [...pagesRef.current];
    [next[index], next[target]] = [next[target], next[index]];
    commitPages(next);
    pipelineRun.current += 1;
    commitBatches([]);
    setCaptureIssue(null);
    setBusy(true);
    setError("");
    if (orderAnalysisTimer.current) clearTimeout(orderAnalysisTimer.current);
    orderAnalysisTimer.current = setTimeout(() => {
      orderAnalysisTimer.current = null;
      void startBatchAnalysis(next);
    }, 650);
  }

  async function identifyPageOrder() {
    if (!pagesRef.current.length) return;
    setBusy(true);
    setError("");
    setCacheNotice("Checking for a saved analysis of these exact pages…");
    try {
      setCacheKeyRef.current = await worksheetSetKey(pagesRef.current);
      try {
        const cached = await cacheRequest<WorksheetSetCache>("lookup", "set", setCacheKeyRef.current);
        if (cached.found && cached.payload && await restoreSetCache(cached.payload, pagesRef.current)) return;
      } catch (problem) {
        console.error("Worksheet set cache lookup failed", problem);
      }
      setCacheNotice("");
      const onePdfDocument = pagesRef.current.length > 0
        && pagesRef.current.every((page) => page.sourceKind === "pdf" && page.sourceDocumentId === pagesRef.current[0].sourceDocumentId);
      if (pagesRef.current.length === 1 || onePdfDocument) {
        setOrderConfidence(onePdfDocument
          ? `${pagesRef.current.length}-page PDF supplied; its internal page order is preserved.`
          : "One worksheet page supplied.");
        setStage("order");
        window.setTimeout(() => void startBatchAnalysis(pagesRef.current), 0);
        return;
      }
      const previewFiles = await Promise.all(pagesRef.current.map((page) => imageCopyForUpload(page.file, 900, 0.66)));
      const form = new FormData();
      previewFiles.forEach((file, index) => form.append("previews", file, `candidate-${index}-${pagesRef.current[index].file.name}`));
      form.append("adultConfirmed", String(adultConfirmed));
      form.append("language", language);
      form.append("level", level);
      const response = await fetch("/api/worksheets/order", { method: "POST", body: form });
      const result = await responseJson<PageOrderResult>(response);
      if (!response.ok) throw new Error(result.error || "The page sequence could not be identified.");
      const seen = new Set<number>();
      const ordered: UploadedPage[] = (result.pages ?? []).flatMap((item) => {
        const page = pagesRef.current[item.original_index];
        if (!page || seen.has(item.original_index)) return [];
        seen.add(item.original_index);
        return [{ ...page, orderNote: item.page_marker || item.continuity_note }];
      });
      pagesRef.current.forEach((page, index) => {
        if (!seen.has(index)) ordered.push(page);
      });
      commitPages(ordered);
      const nextConfidence = result.confidence_note || "Storylight inferred the sequence from page numbers and sentence continuity. Please check it.";
      setOrderConfidence(nextConfidence);
      setStage("order");
      void persistSetCache([], null, ordered, nextConfidence);
      window.setTimeout(() => void startBatchAnalysis(ordered), 0);
    } catch (problem) {
      setCacheNotice("");
      setError(problem instanceof Error ? problem.message : "The page sequence could not be identified.");
    } finally {
      setBusy(false);
    }
  }

  async function extractBatch(
    batchIndex: number,
    runId: number,
    options: {
      bypassCache?: boolean;
      recaptureNote?: string;
      forcePageNumber?: number;
      targeted?: boolean;
      previousTranscript?: string;
    } = {},
  ) {
    if (pipelineRun.current !== runId) throw new Error("This worksheet run was replaced.");
    const batch = batchesRef.current[batchIndex];
    if (!batch) throw new Error("This page batch is unavailable.");
    const selected = pagesRef.current.slice(batch.pageStart - 1, batch.pageEnd);
    const batchCacheKey = await worksheetBatchKey(selected);
    if (!options.bypassCache) {
      try {
        const cached = await cacheRequest<WorksheetBatchCache>("lookup", "batch", batchCacheKey);
        if (cached.found && cached.payload?.extracted) {
          const result = cached.payload.extracted;
          if(needsConfidenceRefresh(result.reviewRegions)&&!cached.payload.sourceChecked&&selected.length===1){let ocr=null;try{ocr=result.ocrEvidence||await readArchiveOCR(selected[0].previewUrl,selected[0].file.type,language==='ta'?'Tamil':'Chinese');}catch{}result.ocrFailure=ocr?.failureReason||(!ocr?'The page reader was unavailable. Read the saved original again.':'');result.ocrReaderVersion=ocr?.readerVersion;result.ocrEvidence=ocr||undefined;result.reviewRegions=acceptHigh(preserveTextReviews(reviewTranscript(cached.payload.confirmedText??result.passage_text,ocr),result.reviewRegions),autoAcceptHigh);}

          updateBatch(batchIndex, {
            status: cached.payload.sourceChecked ? "build_queued" : "review",
            extracted: result,
            confirmedText: cached.payload.confirmedText ?? result.passage_text,
            confirmedOtherText: cached.payload.confirmedOtherText ?? result.other_text,
            sourceChecked: cached.payload.sourceChecked || false,
            error: "",
            diagnostic: "",
            attempt: undefined,
            maxAttempts: undefined,
            readStartedAt: undefined,
          });
          setCacheNotice(`Reusing the saved text analysis for pages ${batch.pageStart}–${batch.pageEnd}.`);
          void persistSetCache();
          if(cached.payload.sourceChecked)window.setTimeout(()=>void drainActivityBuildQueue(),0);
          return result;
        }
      } catch (problem) {
        console.error("Worksheet batch cache lookup failed", problem);
      }
    }
    const readStartedAt = Date.now();
    updateBatch(batchIndex, {
      status: "reading",
      error: "",
      diagnostic: "",
      readStartedAt,
      regionCount: undefined,
      regionsCompleted: 0,
      retryingRegion: undefined,
    });
    const results: ExtractedWorksheet[] = [];

    const readIsolatedPage = async (page: UploadedPage, pageNumber: number): Promise<void> => {
      if (pipelineRun.current !== runId) throw new Error("This worksheet run was replaced.");
      const pageCacheKey = await worksheetPageKey(page);
      const bypassPageCache = !!options.bypassCache
        && (options.forcePageNumber === undefined || options.forcePageNumber === pageNumber);
      if (!bypassPageCache) {
        try {
          const cached = await cacheRequest<WorksheetBatchCache>("lookup", "batch", pageCacheKey);
          if (cached.found && cached.payload?.extracted) {
            const saved=cached.payload.extracted;
            if(needsConfidenceRefresh(saved.reviewRegions)&&!cached.payload.sourceChecked){let ocr=null;try{ocr=saved.ocrEvidence||await readArchiveOCR(page.previewUrl,page.file.type,language==='ta'?'Tamil':'Chinese');}catch{}saved.ocrFailure=ocr?.failureReason||(!ocr?'The page reader was unavailable. Read the saved original again.':'');saved.ocrReaderVersion=ocr?.readerVersion;saved.ocrEvidence=ocr||undefined;saved.reviewRegions=acceptHigh(preserveTextReviews(reviewTranscript(cached.payload.confirmedText??saved.passage_text,ocr),saved.reviewRegions),autoAcceptHigh);saved.unreadable_regions=[...saved.unreadable_regions,...coverageWarnings(saved.passage_text,ocr)];}
            if(cached.payload.sourceChecked){saved.reviewRegions=(saved.reviewRegions||reviewTranscript(cached.payload.confirmedText??saved.passage_text,null)).map(r=>({...r,acceptedBy:r.acceptedBy||'human',acceptedAt:r.acceptedAt||new Date().toISOString()}));saved.structureAccepted=true;}
            results.push(saved);
            return;
          }
        } catch (problem) {
          console.error("Worksheet page cache lookup failed", problem);
        }
      }
      const correctiveNote = options.recaptureNote?.trim() ?? "";
      const targetedRead = Boolean(options.targeted && correctiveNote);
      updateBatch(batchIndex, {
        status: "reading",
        regionCount: undefined,
        regionsCompleted: 0,
        retryingRegion: undefined,
        diagnostic: targetedRead
          ? "Checking the full page again using the parent’s note…"
          : "Doing one simple full-page read…",
      });
      const preparedPage = await fullPageJpegWithinBytes(page.file, WORKSHEET_PAGE_TRANSPORT_BYTES);
        const form = new FormData();
      form.append("files", preparedPage);
        form.append("adultConfirmed", String(adultConfirmed));
        form.append("language", language);
        form.append("level", level);
        form.append("pageStart", String(pageNumber));
        form.append("pageEnd", String(pageNumber));
      form.append("mode", targetedRead ? "targeted" : "fast");
      form.append("sourcePreparation", "one complete uncropped page");
      if (correctiveNote) form.append("recaptureNote", correctiveNote.slice(0, 500));
      if (targetedRead && options.previousTranscript?.trim()) {
        form.append("previousTranscript", options.previousTranscript.trim().slice(0, 14_000));
      }
      const controller = new AbortController();
      const timeout = window.setTimeout(
        () => controller.abort(),
        targetedRead ? WORKSHEET_TARGETED_READ_TIMEOUT_MS : WORKSHEET_FAST_READ_TIMEOUT_MS,
      );
      let response: Response;
      try {
        response = await fetch("/api/worksheets/extract", { method: "POST", body: form, signal: controller.signal });
      } catch (problem) {
        if (problem instanceof Error && problem.name === "AbortError") {
        throw new WorksheetPageCaptureError(
            `${page.file.name} did not finish its ${targetedRead ? "targeted" : "simple"} read.`,
          pageNumber,
          page.file.name,
            ["timeout"],
          [],
            `The ${targetedRead ? "targeted reread" : "simple whole-page read"} exceeded its time limit.`,
        );
        }
        throw problem;
      } finally {
        window.clearTimeout(timeout);
      }
      const pageResult = await responseJson<ExtractedWorksheet>(response);
      if (!response.ok) {
        throw new WorksheetPageCaptureError(
          `${page.file.name} could not be read.`,
          pageNumber,
          page.file.name,
          ["unclear_source"],
          [],
          pageResult.error || `HTTP ${response.status}: The page could not be transcribed.`,
        );
      }
      if (!pageResult.passage_text.trim()) {
        throw new WorksheetPageCaptureError(
          `No readable learning text was found on ${page.file.name}.`,
          pageNumber,
          page.file.name,
          ["unclear_source"],
          [],
          "The full-page read returned empty text.",
        );
      }
      let ocr=null;
      try{ocr=await readArchiveOCR(page.previewUrl,page.file.type,language==='ta'?'Tamil':'Chinese');}catch{ /* Unknown confidence stays in the review queue. */ }
      pageResult.ocrFailure=ocr?.failureReason||(!ocr?'The page reader was unavailable. Read the saved original again.':'');pageResult.ocrReaderVersion=ocr?.readerVersion;
      pageResult.initialText=pageResult.passage_text;pageResult.ocrEvidence=ocr||undefined;pageResult.reviewRegions=acceptHigh(reviewTranscript(pageResult.passage_text,ocr),autoAcceptHigh);
      pageResult.unreadable_regions=[...pageResult.unreadable_regions,...coverageWarnings(pageResult.passage_text,ocr)];
      results.push(pageResult);
      void cacheRequest<WorksheetBatchCache>("save", "batch", pageCacheKey, { extracted: pageResult }).catch((problem) => {
        console.error("Worksheet page cache save failed", problem);
      });
    };

    for (let index = 0; index < selected.length; index += 1) {
      await readIsolatedPage(selected[index], batch.pageStart + index);
    }
    const result = mergeWorksheetExtractions(results);
    if (pipelineRun.current !== runId) throw new Error("This worksheet run was replaced.");
    updateBatch(batchIndex, {
      status: "review",
      extracted: result,
      confirmedText: result.passage_text,
      confirmedOtherText: result.other_text,
      sourceChecked: false,
      error: "",
      diagnostic: "",
      attempt: undefined,
      maxAttempts: undefined,
      readStartedAt: undefined,
      regionCount: undefined,
      regionsCompleted: undefined,
      retryingRegion: undefined,
    });
    void cacheRequest<WorksheetBatchCache>("save", "batch", batchCacheKey, { extracted: result }).catch((problem) => {
      console.error("Worksheet batch cache save failed", problem);
    });
    void persistSetCache();
    return result;
  }

  async function startBatchAnalysis(sourcePages = pagesRef.current) {
    if (!sourcePages.length) return;
    if (pagesRef.current !== sourcePages) commitPages(sourcePages);
    const nextBatches: WorksheetBatch[] = [];
    for (let index = 0; index < sourcePages.length; index += 1) {
      nextBatches.push({
        id: `batch-${index + 1}`,
        pageStart: index + 1,
        pageEnd: index + 1,
        status: "queued",
      });
    }
    commitBatches(nextBatches);
    void persistSetCache(nextBatches, readerRef.current, sourcePages);
    const runId = pipelineRun.current + 1;
    pipelineRun.current = runId;
    setBusy(true);
    setAnalysisStartedAt(Date.now());
    setError("");
    setCaptureIssue(null);
    try {
      const result = await extractBatch(0, runId);
      if (pipelineRun.current !== runId) return;
      setActiveBatchIndex(0);
      setExtracted(result);
      setConfirmedText(result.passage_text);
      setConfirmedOtherText(result.other_text);
      setSourceChecked(false);
      if (result.detected_language === "ta" || result.detected_language === "zh") setLanguage(result.detected_language);
      setStage("review");
      void processRemainingBatches(runId);
    } catch (problem) {
      if (pipelineRun.current !== runId) return;
      if (problem instanceof WorksheetPageCaptureError) {
        showCaptureIssue(problem, 0);
      } else {
        updateBatch(0, { status: "failed", error: problem instanceof Error ? problem.message : "The first pages could not be read." });
        setError(problem instanceof Error ? problem.message : "The first pages could not be read.");
      }
      setStage('review');
      void processRemainingBatches(runId);
    } finally {
      if (pipelineRun.current === runId) {
        setBusy(false);
        setAnalysisStartedAt(null);
      }
    }
  }

  async function processRemainingBatches(runId: number) {
    let cursor = 1;
    const worker = async () => {
      while (cursor < batchesRef.current.length) {
        const index = cursor;
        cursor += 1;
        if (pipelineRun.current !== runId) return;
        if (["reading", "review", "build_queued", "building", "ready"].includes(batchesRef.current[index]?.status ?? "")) continue;
        try {
          await extractBatch(index, runId);
        } catch (problem) {
          if (problem instanceof WorksheetPageCaptureError) showCaptureIssue(problem, index, false);
          else {
            const message = problem instanceof Error ? problem.message : "This page could not be read.";
            updateBatch(index, { status: "failed", error: message, diagnostic: message, readStartedAt: undefined });
          }
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  function openBatchReview(index: number) {
    const current = batchesRef.current[activeBatchIndex];
    if (current?.extracted && current.status === "review") {
      updateBatch(activeBatchIndex, { confirmedText, confirmedOtherText, sourceChecked });
    }
    const batch = batchesRef.current[index];
    if (!batch?.extracted) return;
    setActiveBatchIndex(index);
    setExtracted(batch.extracted);
    setConfirmedText(batch.confirmedText ?? batch.extracted.passage_text);
    setConfirmedOtherText(batch.confirmedOtherText ?? batch.extracted.other_text);
    setSourceChecked(Boolean(batch.sourceChecked));
    setRecaptureNote("");
    setError("");
    setStage("review");
  }

  function openReadyBatch(index: number) {
    const currentReader = readerRef.current;
    if (!currentReader) return;
    const firstSectionForBatch = currentReader.sections.findIndex((item) => item.id.startsWith(`batch-${index + 1}-`));
    if (firstSectionForBatch >= 0) openStorySection(firstSectionForBatch);
    setError("");
    setStage("reader");
  }

  async function retryBatch(index: number) {
    if (busy) return;
    const retryInBackground = Boolean(readerRef.current);
    if (!retryInBackground) setBusy(true);
    setError("");
    if (retryInBackground) {
      setCacheNotice(`Reading only Page ${batchesRef.current[index]?.pageStart ?? index + 1} again in the background. Your ready activity remains available.`);
      setStage("reader");
    }
    try {
      const result = await extractBatch(index, pipelineRun.current, {
        bypassCache: true,
      });
      setCaptureIssue(null);
      if (retryInBackground) {
        setCacheNotice(`Page ${batchesRef.current[index]?.pageStart ?? index + 1} was read successfully and is ready for your check under Parent work.`);
      } else {
        setActiveBatchIndex(index);
        setExtracted(result);
        setConfirmedText(result.passage_text);
        setConfirmedOtherText(result.other_text);
        setSourceChecked(false);
        setStage("review");
      }
    } catch (problem) {
      if (problem instanceof WorksheetPageCaptureError) showCaptureIssue(problem, index);
      else {
        const message = problem instanceof Error ? problem.message : "This batch could not be read.";
        updateBatch(index, { status: "failed", error: message, diagnostic: message, readStartedAt: undefined });
        if (retryInBackground) setCacheNotice(`Page ${batchesRef.current[index]?.pageStart ?? index + 1} still needs another read. Your ready activity remains available.`);
      }
    } finally {
      if (!retryInBackground) setBusy(false);
    }
  }

  async function retryCaptureIssue() {
    const issue = captureIssue;
    if (!issue || busy) return;
    const retryInBackground = Boolean(readerRef.current);
    if (!retryInBackground) setBusy(true);
    setError("");
    const parentNote = recaptureNote.trim();
    setCacheNotice(parentNote
      ? `Checking ${issue.pageName} again using your note…`
      : `Trying one simple whole-page read of ${issue.pageName} again…`);
    if (retryInBackground) setStage("reader");
    try {
      const result = await extractBatch(issue.batchIndex, pipelineRun.current, {
        bypassCache: true,
        forcePageNumber: issue.pageNumber,
        recaptureNote: parentNote,
        targeted: Boolean(parentNote),
        previousTranscript: batchesRef.current[issue.batchIndex]?.extracted?.passage_text,
      });
      setCaptureIssue(null);
      setRecaptureNote("");
      if (retryInBackground) {
        setCacheNotice(`${issue.pageName} was read successfully and is ready for your check under Parent work.`);
      } else {
        setActiveBatchIndex(issue.batchIndex);
        setExtracted(result);
        setConfirmedText(result.passage_text);
        setConfirmedOtherText(result.other_text);
        setSourceChecked(false);
        if (result.detected_language === "ta" || result.detected_language === "zh") setLanguage(result.detected_language);
        setCacheNotice(parentNote
          ? `Careful reread completed for ${issue.pageName}. Please compare the corrected draft.`
          : `Simple whole-page read completed for ${issue.pageName}.`);
        setStage("review");
      }
    } catch (problem) {
      if (problem instanceof WorksheetPageCaptureError) showCaptureIssue(problem, issue.batchIndex);
      else if (retryInBackground) {
        updateBatch(issue.batchIndex, { status: "failed", error: problem instanceof Error ? problem.message : "This page could not be read safely." });
        setCacheNotice(`${issue.pageName} still needs another read. Your ready activity remains available.`);
      } else setError(problem instanceof Error ? problem.message : "This page could not be read safely.");
    } finally {
      if (!retryInBackground) setBusy(false);
    }
  }

  async function recaptureActiveBatch() {
    const batch = batchesRef.current[activeBatchIndex];
    if (!batch || busy) return;
    const parentNote = recaptureNote.trim();
    if (!parentNote) {
      setError("Tell Storylight what is missing or incorrect so the careful reread knows exactly where to focus.");
      return;
    }
    const previousExtraction = batch.extracted;
    setBusy(true);
    setError("");
    setSourceChecked(false);
    setCacheNotice(`Checking the original page again using your note: “${parentNote.slice(0, 120)}${parentNote.length > 120 ? "…" : ""}”`);
    try {
      const result = await extractBatch(activeBatchIndex, pipelineRun.current, {
        bypassCache: true,
        recaptureNote: parentNote,
        targeted: true,
        previousTranscript: confirmedText,
      });
      setExtracted(result);
      setConfirmedText(result.passage_text);
      setConfirmedOtherText(result.other_text);
      setRecaptureNote("");
      setCacheNotice("Careful reread complete. The revised text is ready for your comparison.");
    } catch (problem) {
      const message = problem instanceof WorksheetPageCaptureError
        ? problem.diagnosticNote || problem.message
        : problem instanceof Error
          ? problem.message
          : "The careful reread could not be completed.";
      updateBatch(activeBatchIndex, {
        status: "review",
        extracted: previousExtraction,
        confirmedText,
        confirmedOtherText,
        error: message,
        diagnostic: message,
        readStartedAt: undefined,
      });
      setError(`The careful reread did not finish. Your first draft is still here and has not been erased. ${message}`);
      setCacheNotice("");
    } finally {
      setBusy(false);
    }
  }

  function resetWorksheet() {
    pipelineRun.current += 1;
    if (orderAnalysisTimer.current) clearTimeout(orderAnalysisTimer.current);
    stopWorksheetNarration();
    pagesRef.current.forEach((page) => URL.revokeObjectURL(page.previewUrl));
    commitPages([]);
    commitBatches([]);
    commitReader(null);
    setCacheKeyRef.current = "";
    setExtracted(null);
    setCaptureIssue(null);
    setConfirmedText("");
    setConfirmedOtherText("");
    setSourceChecked(false);
    setRecaptureNote("");
    setAnsweredSections([]);
    setAttemptedSections([]);
    setCheckingSections([]);
    setHandwritingResults({});
    setWrittenSections([]);
    setFirstAttemptScores({});
    setSuccessMessages({});
    setIncompleteSections([]);
    setReadingPath("choose");
    setWholeStoryStage("reading");
    setSkippedPreparationGoals(0);
    setRewardAvailable(false);
    setOrderConfidence("");
    setCacheNotice("");
    setAnalysisStartedAt(null);
    setError("");
    if (fileInput.current) fileInput.current.value = "";
    setStage("upload");
  }

  async function generateSceneImages(nextReader: WorksheetReader, targetSections = nextReader.sections) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < targetSections.length) {
        const index = cursor;
        cursor += 1;
        const item = targetSections[index];
        const creating = readerRef.current ? {
          ...readerRef.current,
          sections: readerRef.current.sections.map((candidate) => candidate.id === item.id ? { ...candidate, imageStatus: "creating" as const } : candidate),
        } : null;
        if (creating) commitReader(creating);
        try {
          const response = await fetch("/api/worksheets/illustrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              adultConfirmed,
              familyId,
              worksheetId: nextReader.worksheetId,
              sectionId: item.id,
              title: nextReader.title,
              sectionTitle: item.title,
              sectionText: item.text,
              visualBible: nextReader.visual_bible,
              illustrationPrompt: item.illustration_prompt,
            }),
          });
          const result = await response.json() as { imageUrl?: string; error?: string };
          if (!response.ok || !result.imageUrl) throw new Error(result.error || "Illustration failed");
          const ready = readerRef.current ? {
            ...readerRef.current,
            sections: readerRef.current.sections.map((candidate) => candidate.id === item.id ? { ...candidate, imageUrl: result.imageUrl, imageStatus: "ready" as const } : candidate),
          } : null;
          if (ready) {
            commitReader(ready);
            void persistSetCache(batchesRef.current, ready);
          }
        } catch {
          const failed = readerRef.current ? {
            ...readerRef.current,
            sections: readerRef.current.sections.map((candidate) => candidate.id === item.id ? { ...candidate, imageStatus: "failed" as const } : candidate),
          } : null;
          if (failed) {
            commitReader(failed);
            void persistSetCache(batchesRef.current, failed);
          }
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  function reviewNotes(item: ExtractedWorksheet){return [...(duplicateQuestionWarning(item.passage_text)?[duplicateQuestionWarning(item.passage_text)]:[]),...(item.unreadable_regions||[]),...(!item.content_complete?['The reader reported incomplete content. Check questions, choices and passage order.']:[])];}
  async function saveRegionReview(batchIndex:number,regions:TextReviewRegion[],pageReviewed=false){
    const batch=batchesRef.current[batchIndex];if(!batch?.extracted)return;
    narration.stop();wordCache.current.clear();
    const nextExtraction={...batch.extracted,...(pageReviewed?{structureAccepted:true}:{}),ocrFailure:allTextAccepted(regions)?'':batch.extracted.ocrFailure,reviewRegions:regions,passage_text:regions.map(r=>r.text).join('\n\n')};
    const changed=regions.some(r=>r.text!==batch.extracted!.reviewRegions?.find(old=>old.id===r.id)?.text);
    const selected=pagesRef.current.slice(batch.pageStart-1,batch.pageEnd);
    await cacheRequest('save','batch',await worksheetBatchKey(selected),{extracted:nextExtraction,confirmedText:nextExtraction.passage_text,confirmedOtherText:batch.confirmedOtherText||'',sourceChecked:changed?false:batch.sourceChecked});
    if(selected.length===1)await cacheRequest('save','batch',await worksheetPageKey(selected[0]),{extracted:nextExtraction,confirmedText:nextExtraction.passage_text,confirmedOtherText:batch.confirmedOtherText||'',sourceChecked:changed?false:batch.sourceChecked});
    if(changed&&readerRef.current){
      const previous=readerRef.current,keep=previous.sections.map((section,index)=>({section,index})).filter(({section})=>!section.id.startsWith(`batch-${batchIndex+1}-`));
      const remap=(indices:number[])=>keep.flatMap(({index},next)=>indices.includes(index)?[next]:[]);
      const remapMap=<T,>(values:Record<number,T>)=>Object.fromEntries(keep.flatMap(({index},next)=>values[index]===undefined?[]:[[next,values[index]]]));
      setAnsweredSections(remap);setAttemptedSections(remap);setCheckingSections([]);setWrittenSections(remap);setIncompleteSections(remap);
      setHandwritingResults(remapMap);setFirstAttemptScores(remapMap);setSuccessMessages(remapMap);setSectionIndex(0);
      commitReader(keep.length?{...previous,sections:keep.map(x=>x.section)}:null);
    }
    updateBatch(batchIndex,{extracted:nextExtraction,confirmedText:nextExtraction.passage_text,...(changed?{status:'review',sourceChecked:false}:{})});
    if(changed){setSourceChecked(false);setCacheNotice('Correction saved. Only this page’s activity will be rebuilt from the corrected text.');}
    if(batchIndex===activeBatchIndex){setExtracted(nextExtraction);setConfirmedText(nextExtraction.passage_text);}
    await persistSetCache();
  }
  async function rereadSavedText(batchIndex:number,readerLanguage:string){
    const batch=batchesRef.current[batchIndex];if(!batch?.extracted)return;
    const selected=pagesRef.current.slice(batch.pageStart-1,batch.pageEnd);if(!selected.length)throw Error('Open this saved document before reading it again.');
    const evidence=[];for(const page of selected){const ocr=await readArchiveOCR(page.previewUrl,page.file.type,'auto',()=>{},readerLanguage);if(!ocr||ocr.failureReason)throw Error(ocr?.failureReason||'The saved page could not be read.');evidence.push(ocr);}
    const ocr={...evidence[0],regions:evidence.flatMap((o,i)=>o.regions.map(r=>({...r,id:`${i}-${r.id}`})))};
    const text=batch.confirmedText??batch.extracted.passage_text;
    const regions=acceptHigh(preserveTextReviews(reviewTranscript(text,ocr),batch.extracted.reviewRegions),autoAcceptHigh);
    if(batchesRef.current[batchIndex]!==batch)throw Error('This page changed while checking confidence. Your saved work is unchanged.');
    const next={...batch.extracted,ocrFailure:'',ocrReaderVersion:2,ocrEvidence:ocr,reviewRegions:regions};
    updateBatch(batchIndex,{extracted:next});if(batchIndex===activeBatchIndex)setExtracted(next);
    await cacheRequest('save','batch',await worksheetBatchKey(selected),{extracted:next,confirmedText:text,confirmedOtherText:batch.confirmedOtherText||'',sourceChecked:batch.sourceChecked});
    if(selected.length===1)await cacheRequest('save','batch',await worksheetPageKey(selected[0]),{extracted:next,confirmedText:text,confirmedOtherText:batch.confirmedOtherText||'',sourceChecked:batch.sourceChecked});
    await persistSetCache();
  }
  const confidenceRefreshAttempts=useRef(new Set<string>()),confidenceRefreshRunning=useRef(false);
  useEffect(()=>{
    if(confidenceRefreshRunning.current)return;
    const index=batches.findIndex(b=>b.status==='review'&&!b.sourceChecked&&b.extracted&&needsConfidenceRefresh(b.extracted.reviewRegions)&&!confidenceRefreshAttempts.current.has(`${b.pageStart}:${pages[b.pageStart-1]?.id||''}`));
    if(index<0)return;
    const batch=batches[index];confidenceRefreshAttempts.current.add(`${batch.pageStart}:${pages[batch.pageStart-1]?.id||''}`);confidenceRefreshRunning.current=true;
    void rereadSavedText(index,language==='ta'?'Tamil':'Chinese').catch(e=>setError((e as Error).message)).finally(()=>{confidenceRefreshRunning.current=false;setBatches(v=>[...v]);});
  },[batches,language]);
  function changeReviewPolicy(value:boolean){localStorage.setItem(`storylight:review-policy:${familyId}`,String(value));setAutoAcceptHigh(value);}
  useEffect(()=>{
    for(const [index,batch] of batches.entries()){
      if(batch.status!=='review'||batch.sourceChecked||!batch.extracted?.reviewRegions?.length||extractionFailure(batch.extracted))continue;
      const regions=acceptHigh(batch.extracted.reviewRegions,autoAcceptHigh);
      if(regions.some((r,i)=>r.acceptedBy!==batch.extracted!.reviewRegions![i].acceptedBy)){void saveRegionReview(index,regions).catch(e=>setError((e as Error).message));continue;}
      if(allTextAccepted(regions)&&(!reviewNotes(batch.extracted).length||batch.extracted.structureAccepted)){
        queueActivityPreparation(index,batch.confirmedText??regions.map(r=>r.text).join('\n\n'),batch.confirmedOtherText||'');
        if(index===activeBatchIndex)setSourceChecked(true);
      }
    }
  },[batches,autoAcceptHigh]);

  function queueActivityPreparation(
    batchIndex: number,
    checkedText: string,
    checkedOtherText: string,
  ) {
    const batch = batchesRef.current[batchIndex];
    if (!batch || !checkedText.trim() || !familyId || (batch.extracted&&extractionFailure(batch.extracted))) return;
    if (["build_queued", "building", "ready"].includes(batch.status)) return;
    updateBatch(batchIndex, {
      status: "build_queued",
      confirmedText: checkedText,
      confirmedOtherText: checkedOtherText,
      sourceChecked: true,
      error: "",
    });
    if(batch.extracted){const selected=pagesRef.current.slice(batch.pageStart-1,batch.pageEnd);const checked={extracted:{...batch.extracted,passage_text:checkedText,other_text:checkedOtherText},confirmedText:checkedText,confirmedOtherText:checkedOtherText,sourceChecked:true};void worksheetBatchKey(selected).then(key=>cacheRequest('save','batch',key,checked));if(selected.length===1)void worksheetPageKey(selected[0]).then(key=>cacheRequest('save','batch',key,checked));}
    setCacheNotice(`Page ${batch.pageStart} text accepted; its activity is queued for preparation.`);
    void persistSetCache();
    window.setTimeout(() => void drainActivityBuildQueue(), 0);
  }

  async function drainActivityBuildQueue() {
    if (activityQueueRunning.current) return;
    activityQueueRunning.current = true;
    try {
      while (true) {
        const batchIndex = batchesRef.current.findIndex((batch) => batch.status === "build_queued");
        if (batchIndex < 0) break;
        await prepareBatchActivity(batchIndex);
      }
    } finally {
      activityQueueRunning.current = false;
      if (batchesRef.current.some((batch) => batch.status === "build_queued")) {
        window.setTimeout(() => void drainActivityBuildQueue(), 0);
      }
    }
  }

  async function prepareBatchActivity(batchIndex: number) {
    const batch = batchesRef.current[batchIndex];
    const checkedText = batch?.confirmedText?.trim() ?? "";
    const checkedOtherText = batch?.confirmedOtherText ?? "";
    if (!batch || !checkedText || !batch.sourceChecked || !familyId) return;
    const batchExtraction = batch.extracted;
    const targetLanguage = batchExtraction?.detected_language === "ta" || batchExtraction?.detected_language === "zh"
      ? batchExtraction.detected_language
      : language;
    setError("");
    updateBatch(batchIndex, { status: "building", error: "" });
    setCacheNotice(`Page ${batch.pageStart} is preparing in the background. You can keep checking other pages.`);
    try {
      const pageAudits = batchExtraction?.page_audits ?? [];
      const visibleItemLabels = [...new Set(pageAudits.flatMap((audit) => audit.visible_item_labels))];
      const response = await fetch("/api/worksheets/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          title: batchExtraction?.title,
          language: targetLanguage,
          level,
          text: checkedText,
          worksheetQuestions: checkedOtherText,
          activityMode: "auto",
          visibleItemLabels,
          assessmentProfile,
          previousContext: batchesRef.current[batchIndex - 1]?.confirmedText?.slice(-1200) ?? "",
          batchLabel: `Pages ${batch.pageStart}–${batch.pageEnd}`,
        }),
      });
      const result = await responseJson<WorksheetReader>(response);
      if (!response.ok) throw new Error(result.error || "The reader could not be built.");
      if(batchesRef.current[batchIndex]?.confirmedText?.trim()!==checkedText||!batchesRef.current[batchIndex]?.sourceChecked)return;
      const newSections = result.sections.map((item) => ({
        ...item,
        id: `batch-${batchIndex + 1}-${item.id}`,
        imageStatus: result.learning_mode === "read_along" ? "waiting" as const : undefined,
      }));
      const batchNumberForSection = (item: WorksheetSection) => Number(item.id.match(/^batch-(\d+)-/)?.[1] ?? Number.MAX_SAFE_INTEGER);
      const nextReader: WorksheetReader = readerRef.current ? {
        ...readerRef.current,
        sections: [
          ...readerRef.current.sections.filter((item) => !item.id.startsWith(`batch-${batchIndex + 1}-`)),
          ...newSections,
        ].sort((left, right) => batchNumberForSection(left) - batchNumberForSection(right)),
      } : {
        ...result,
        sections: newSections,
      };
      commitReader(nextReader);
      updateBatch(batchIndex, { status: "ready", confirmedText: checkedText, confirmedOtherText: checkedOtherText, error: "" });
      void persistSetCache(batchesRef.current, nextReader);
      if (batchIndex === 0) {
        setSectionIndex(0);
        setAnsweredSections([]);
        setAttemptedSections([]);
        setCheckingSections([]);
        setHandwritingResults({});
        setWrittenSections([]);
        setFirstAttemptScores({});
        setSuccessMessages({});
        setIncompleteSections([]);
        setReadingPath("choose");
        setWholeStoryStage("reading");
        setSkippedPreparationGoals(0);
        setRewardAvailable(false);
        setRewardOpen(false);
      }
      setCacheNotice(`Page ${batch.pageStart} activity is ready. You can open it now or continue checking pages.`);
      if (result.learning_mode === "read_along") void generateSceneImages(nextReader, newSections);
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : "The reader could not be built.";
      updateBatch(batchIndex, {
        status: "review",
        confirmedText: checkedText,
        confirmedOtherText: checkedOtherText,
        sourceChecked: true,
        error: message,
      });
      setCacheNotice(`Page ${batch.pageStart} could not be prepared. Its parent check is saved; open that page to retry activity preparation.`);
    }
  }

  function markSectionComplete(index: number) {
    setIncompleteSections((current) => current.filter((item) => item !== index));
    setAnsweredSections((current) => {
      if (current.includes(index)) return current;
      return [...current, index];
    });
  }

  function markSectionAttempted(index: number) {
    setIncompleteSections((current) => current.filter((item) => item !== index));
    setAttemptedSections((current) => current.includes(index) ? current : [...current, index]);
  }

  function showWorksheetBackpackNotice(word: string) {
    setBackpackNotice(word);
    if (backpackNoticeTimer.current) window.clearTimeout(backpackNoticeTimer.current);
    backpackNoticeTimer.current = window.setTimeout(() => setBackpackNotice(""), 2200);
  }

  function openWorksheetTextWord(word: string, context: string) {
    if (narration.status === "loading" && narration.activeSpeech?.text === word) return;
    const cacheKey = `${language}:${word}:${context}`;
    const cached = wordCache.current.get(cacheKey);
    if (language === "ta") {
      onDiscover(satchelItemFromHelp(word, language, cached));
      showWorksheetBackpackNotice(word);
    }
    const cachedItem = cached ? satchelItemFromHelp(word, language, cached) : null;
    const shownWord = cachedItem?.word ?? word;
    setWordPanel({ word: shownWord, context, rung: 0, loading: !cached, help: cached });
    if (language === "ta" || cached) speakWorksheetWord(shownWord);
    if (cached) {
      if (language === "zh" && !contextualHelpNeedsClarification(cached) && cachedItem) {
        onDiscover(cachedItem);
        showWorksheetBackpackNotice(cachedItem.word);
      }
      return;
    }
    if (!familyId) return;
    void fetch("/api/worksheets/word-help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adultConfirmed, familyId, language, level, word, context }),
    }).then(async (response) => {
      const result = await response.json() as GlossaryEntry & { error?: string };
      if (!response.ok) throw new Error(result.error || "The clue could not be prepared.");
      wordCache.current.set(cacheKey, result);
      const resolvedItem = satchelItemFromHelp(word, language, result);
      const shouldSave = language === "ta" || !contextualHelpNeedsClarification(result);
      if (shouldSave) {
        onDiscover(resolvedItem);
        if (language === "zh") showWorksheetBackpackNotice(resolvedItem.word);
      }
      if (language === "zh") speakWorksheetWord(resolvedItem.word);
      setWordPanel((current) => current?.context === context && (current.word === word || current.word === shownWord) ? { ...current, word: resolvedItem.word, loading: false, help: result, error: "" } : current);
    }).catch((problem) => {
      setWordPanel((current) => current?.context === context && (current.word === word || current.word === shownWord) ? { ...current, loading: false, error: problem instanceof Error ? problem.message : "The clue could not be prepared." } : current);
    });
  }

  function raiseWorksheetHand(context: "passage" | "question") {
    const focusWord = context === "passage"
      ? tokens[activeToken]?.value ?? ""
      : questionTokens[activeQuestionToken]?.value ?? "";
    narration.pause();
    setTeacherRequest({ kind: "doubt", context, focusWord, signal: Date.now() });
    window.setTimeout(() => teacherHelpAnchorRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }), 0);
  }

  function openWorksheetWord(token: WorksheetToken) {
    if (!section) return;
    openWorksheetTextWord(token.value, worksheetSentenceAt(section.text, token.start, token.end));
  }

  async function revealWordHelp() {
    if (!wordPanel) return;
    if (wordPanel.rung > 0 || wordPanel.help) {
      setWordPanel({ ...wordPanel, rung: Math.min(3, wordPanel.rung + 1), error: "" });
      return;
    }
    const cacheKey = `${language}:${wordPanel.word}:${wordPanel.context}`;
    setWordPanel({ ...wordPanel, loading: true, error: "" });
    try {
      const response = await fetch("/api/worksheets/word-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          language,
          level,
          word: wordPanel.word,
          context: wordPanel.context,
        }),
      });
      const result = await response.json() as GlossaryEntry & { error?: string };
      if (!response.ok) throw new Error(result.error || "The clue could not be prepared.");
      wordCache.current.set(cacheKey, result);
      setWordPanel((current) => current ? { ...current, loading: false, rung: 1, help: result } : current);
    } catch (problem) {
      setWordPanel((current) => current ? {
        ...current,
        loading: false,
        error: problem instanceof Error ? problem.message : "The clue could not be prepared.",
      } : current);
    }
  }

  const stageNumber = stage === "upload" ? 1 : stage === "order" || stage === "capture" ? 2 : stage === "review" ? 3 : 4;
  const wordPanelItem = wordPanel ? satchelItemFromHelp(wordPanel.word, language, wordPanel.help) : null;
  const wordPanelSaved = Boolean(wordPanelItem && satchelItems.some((item) => sameSatchelItem(item, wordPanelItem)));
  const capturePage = captureIssue ? pages[captureIssue.pageNumber - 1] : null;
  const captureTimedOut = Boolean(captureIssue?.issueKinds.includes("timeout"));
  const availableReviewIndex = batches.findIndex((batch, index) => index !== captureIssue?.batchIndex && batch.status === "review" && Boolean(batch.extracted));
  const captureMessages = captureIssue ? [
    captureIssue.issueKinds.includes("foreign_text")
      ? "The source check detected wording that is not printed on this page."
      : "",
    captureIssue.issueKinds.includes("missing_items") || captureIssue.issueKinds.includes("missing_text")
      ? captureIssue.visibleLabels.length
        ? `Some visible items may be missing. The page appears to contain: ${captureIssue.visibleLabels.join(", ")}.`
        : "Some printed questions or lines may be missing."
      : "",
    captureIssue.issueKinds.includes("unclear_source")
      ? "One or more areas may need a clearer reading copy."
      : "",
    captureIssue.issueKinds.includes("timeout")
      ? "The whole-page read exceeded its time limit. You can try the same simple read again, or add a note to guide a more careful reread."
      : "",
  ].filter(Boolean) : [];

  return (
    <main className={`worksheet-shell lang-${language}`}>
      <nav className="story-nav worksheet-nav">
        <button className="wordmark compact" onClick={onClose}><span className="wordmark-star">✦</span><span>Storylight</span></button>
        <div className="worksheet-stage-line" aria-label={`Worksheet step ${stageNumber} of 4`}><span style={{ width: `${stageNumber * 25}%` }} /></div>
        <div className="nav-tools">
          <span className="adult-mode-pill compact">18+ QA</span>
          {worksheetInterestActivitiesEnabled && <button className="interest-profile-pill compact" onClick={onOpenInterestProfile}><span>⌁</span><span className="satchel-label">Learner lens</span></button>}
          <button className={`satchel-pill ${satchelPulse ? "receiving" : ""}`} onClick={onOpenSatchel}><span>🎒</span><span className="satchel-label">Magic Backpack</span><b>{satchelItems.filter((item) => item.language === language).length}</b></button>
        </div>
      </nav>
      <BackpackAddedNotice word={backpackNotice} />

      {narration.status === "loading" && <AudioPreparingNotice voice={narratorVoice} />}

      {cacheNotice && stage !== "reader" && <div className="worksheet-cache-note" role="status"><span>↺</span><p>{cacheNotice}</p></div>}

      {stage === "upload" && <section className="extraction-inbox"><p className="overline">FROM YOUR TEACHER</p><h2>Open a LessonCraft resource</h2><p>Import the approved resource file. Its questions, criteria and curriculum information arrive without scanning or copying.</p><input ref={packageInput} type="file" accept=".json,application/json" className="visually-hidden" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>1500000)throw Error('This resource file is too large.');setImportedPackage(parseLessoncraftPackage(JSON.parse(await f.text())));setError('');}catch(e){setError((e as Error).message);}}}/><button className="back-button" onClick={()=>packageInput.current?.click()}>Choose LessonCraft resource</button>{importedPackage&&<div><h3>{importedPackage.title}</h3><p>{importedPackage.sections.length} questions · {importedPackage.level} · {importedPackage.language==='ta'?'Tamil':'Mandarin'}. Teacher approval is recorded in the supplied file.</p><details><summary>Inspect questions and source details</summary>{importedPackage.sections.map((s:WorksheetSection)=><p key={s.id}>{s.question.prompt}</p>)}<p>Resource: {importedPackage.provenance.lessonId}</p></details><button className="primary-button" onClick={async()=>{const imported={...importedPackage,worksheetId:crypto.randomUUID()};stopWorksheetNarration();wordCache.current.clear();commitReader(imported);setLanguage(imported.language);setLevel(imported.level);setSectionIndex(0);setReadingPath('paragraphs');setStage('reader');const response=await fetch('/api/worksheets/cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed,familyId,action:'save',cacheKind:'batch',cacheKey:'teacher:last',language:imported.language,level:imported.level,payload:imported})});if(!response.ok){setError('The resource opened but could not be saved. Keep the supplied file to retry.');return;}localStorage.setItem(`storylight:teacher-resource:${familyId}`,JSON.stringify({language:imported.language,level:imported.level}));setCacheNotice('Teacher-reviewed questions opened directly. No OCR was run.');}}>Use this teacher-reviewed resource</button></div>}<button className="text-button" onClick={async()=>{try{const v=localStorage.getItem(`storylight:teacher-resource:${familyId}`);if(!v)throw Error('No imported resource saved in this workspace yet.');const pointer=JSON.parse(v);const response=await fetch('/api/worksheets/cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed,familyId,action:'lookup',cacheKind:'batch',cacheKey:'teacher:last',language:pointer.language,level:pointer.level})});const data=await response.json() as any;if(!response.ok||!data.found)throw Error('The saved teacher resource is unavailable.');const r=data.payload;stopWorksheetNarration();wordCache.current.clear();commitReader(r);setLanguage(r.language);setLevel(r.level);setSectionIndex(0);setReadingPath('paragraphs');setStage('reader');}catch(e){setError((e as Error).message);}}}>Reopen last imported resource</button></section>}
      {stage === "upload" && savedSources.length>0 && <section className="extraction-inbox"><p className="overline">SAVED MATERIALS</p><h2>Pick up where you left off</h2><p>Original pages, accepted text and prepared activities are reused.</p><div className="saved-source-list">{savedSources.map(item=><button key={item.cacheKey} className="back-button" disabled={busy} onClick={()=>void openSavedSource(item)}>{item.title} · {item.language==='ta'?'Tamil':'Mandarin'} · {item.level}</button>)}</div></section>}
      {stage === "upload" && (
        <section className="worksheet-workbench">
          <header className="worksheet-heading">
            <p className="overline">{launchMode === "storybook" ? "Storytime · Upload your book · Step 1 of 4" : "Help with homework · Step 1 of 4"}</p>
            <h1>{launchMode === "storybook" ? "Bring a storybook into Storytime." : "Turn difficult homework into guided learning."}</h1>
            <p>{launchMode === "storybook" ? "Upload photographs or a PDF of storybook pages. After you confirm the text, the learner can listen, tap words and talk about the story with the Voice Teacher." : "Upload photographs or a PDF of a school worksheet. After you confirm the text, the Voice Teacher helps the learner understand and complete the printed work."}</p>
          </header>

          <div className="worksheet-config-grid">
            <section className="worksheet-config-card">
              <span className="config-kicker">Reading target</span>
              <h2>Tell us what to expect</h2>
              <div className="worksheet-language-toggle" role="group" aria-label="Worksheet language">
                <button className={language === "ta" ? "selected" : ""} onClick={() => setLanguage("ta")}><b>தமிழ்</b><span>Tamil</span></button>
                <button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}><b>中文</b><span>Mandarin</span></button>
              </div>
              <div className="worksheet-level-toggle" role="group" aria-label="Worksheet school level">
                {(["P3", "P5"] as Level[]).map((item) => <button key={item} className={level === item ? "selected" : ""} onClick={() => setLevel(item)}>{item}</button>)}
              </div>
            </section>

            <section className="worksheet-upload-card">
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
              />
              <button
                className="worksheet-dropzone"
                onClick={() => fileInput.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}
              >
                <span className="upload-orbit">＋</span>
                <b>{pages.length ? `${pages.length} ${pages.length === 1 ? "page" : "pages"} ready` : launchMode === "storybook" ? "Choose storybook pages" : "Choose worksheet pages"}</b>
                <small>PDF, JPG, PNG or WEBP · up to 8 source files / 24 pages · safe batches chosen automatically</small>
              </button>
              {!!pages.length && <ul className="worksheet-file-list">{pages.map((page) => <li key={page.id}><span>▧</span><b>{page.file.name}</b><small>{Math.max(1, Math.round(page.file.size / 1024))} KB</small></li>)}</ul>}
            </section>
          </div>

          <div className="worksheet-privacy-note"><span>Parent check</span><p>Use only an adult test copy. Cover names, class, school identifiers and handwritten pupil answers before uploading. Review uncertain text beside its matching original. Clear text can be accepted automatically if you enable that preference. Original pages and your corrections are saved for reopening in this workspace.</p></div>
          {error && <p className="worksheet-error">{error}</p>}
          <div className="worksheet-footer-actions"><button className="back-button" onClick={onClose}>← Back to home</button><button className="primary-button" disabled={!pages.length || busy} onClick={identifyPageOrder}>{busy ? "Finding the page order…" : "Identify page sequence"}<span>→</span></button></div>
        </section>
      )}

      {stage === "order" && (
        <section className="worksheet-review-shell">
          <header className="worksheet-heading compact-heading">
            <p className="overline">Page sequence · Step 2 of 4</p>
            <h1>Do these pages flow in this order?</h1>
            <p>Storylight used printed numbers, headings and sentence continuity. Analysis has already started in the background. If you move a page, Storylight restarts automatically with the new order.</p>
          </header>
          <p className="order-confidence"><span>✦</span>{orderConfidence}</p>
          <ol className="page-order-grid">
            {pages.map((page, index) => (
              <li key={page.id}>
                <div className="page-order-preview">
                  {page.file.type.startsWith("image/") ? <img src={page.previewUrl} alt={`Uploaded page candidate ${index + 1}`} /> : <span>PDF</span>}
                  <b>{index + 1}</b>
                </div>
                <div className="page-order-copy"><strong>{page.file.name}</strong><small>{page.orderNote || "Check where this page begins and ends."}</small></div>
                <div className="page-order-actions"><button disabled={index === 0} onClick={() => movePage(index, -1)} aria-label={`Move ${page.file.name} earlier`}>↑</button><button disabled={index === pages.length - 1} onClick={() => movePage(index, 1)} aria-label={`Move ${page.file.name} later`}>↓</button></div>
              </li>
            ))}
          </ol>
          {error && <p className="worksheet-error">{error}</p>}
          <div className="worksheet-footer-actions"><button className="back-button" onClick={() => { pipelineRun.current += 1; setAnalysisStartedAt(null); setStage("upload"); setError(""); setBusy(false); }}>← Replace pages</button><div className={`auto-analysis-status ${error ? "failed" : ""}`} aria-live="polite"><span>{error ? "!" : "◌"}</span><p><b>{error ? "This page set needs attention" : `Reading page 1 of ${pages.length}…`}</b><small>{error || (analysisSeconds < 8 ? "Making one simple draft from the complete page." : `${analysisSeconds}s elapsed · ${batches[0]?.diagnostic || "the whole page is being transcribed once."}`)}</small></p></div></div>
        </section>
      )}

      {stage === "capture" && captureIssue && (
        <section className="worksheet-review-shell capture-recovery-shell">
          <header className="worksheet-heading compact-heading">
            <p className="overline">Source protection · Step 2 of 4</p>
            <h1>{captureTimedOut ? "The simple page read took too long." : "This page could not be read."}</h1>
            <p>No automatic retry is running. Try the simple whole-page read once more, or add a specific note so Storylight can make a careful reread.</p>
          </header>
          <div className="capture-recovery-card">
            <figure>
              {capturePage?.file.type.startsWith("image/") && <img src={capturePage.previewUrl} alt={`Original page that needs another read: ${captureIssue.pageName}`} />}
              <figcaption>Original page · {captureIssue.pageName}</figcaption>
            </figure>
            <div className="capture-recovery-copy">
              <span className="config-kicker">Needs another read</span>
              <h2>{captureIssue.pageName}</h2>
              <p>Only this page will be retried. Pages that already worked remain available.</p>
              <ul>
                {(captureMessages.length ? captureMessages : ["The page did not return a usable transcription."]).map((message) => <li key={message}>{message}</li>)}
              </ul>
              {!!captureIssue.diagnosticNote && <p className="worksheet-error compact-error">QA error: {captureIssue.diagnosticNote}</p>}
              <label htmlFor="capture-retry-note">What should Storylight look at especially? <small>Optional—adding a note switches to careful reread</small></label>
              <textarea id="capture-retry-note" value={recaptureNote} onChange={(event) => setRecaptureNote(event.target.value)} placeholder="For example: This page contains Q1–Q5. Do not use the butterfly story from the next page." />
              {error && <p className="worksheet-error compact-error">{error}</p>}
              <div className="capture-recovery-actions">
                <button className="primary-button" disabled={busy} onClick={() => void retryCaptureIssue()}>{busy ? "Reading this page again…" : "↺ Read this page again"}<span>✦</span></button>
                {(readerRef.current || availableReviewIndex >= 0) && <button className="back-button" onClick={() => {
                  if (readerRef.current) {
                    setStage("reader");
                    setError("");
                  } else if (availableReviewIndex >= 0) {
                    openBatchReview(availableReviewIndex);
                  }
                }}>← Return to available {readerRef.current ? "activity" : "page"}</button>}
                <button className="back-button" onClick={() => { pipelineRun.current += 1; setCaptureIssue(null); setStage("upload"); setError(""); setBusy(false); }}>Replace pages</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {(stage === "review" || stage === "capture") && batches.length>0 && <ExtractionReviewInbox context={{adultConfirmed,familyId,language,level,sessionKey:`review-${setCacheKeyRef.current||'current'}`}} onPause={onClose} entries={batches.map((batch,index)=>({batchIndex:index,page:batch.pageStart,name:pages[batch.pageStart-1]?.sourceDocumentName||pages[batch.pageStart-1]?.file.name||'Saved page',documentId:pages[batch.pageStart-1]?.sourceDocumentId||pages[batch.pageStart-1]?.id,sourcePage:pages[batch.pageStart-1]?.sourcePageNumber,sourceTotal:pages.filter(p=>p.sourceDocumentId===pages[batch.pageStart-1]?.sourceDocumentId).length,previewUrl:pages[batch.pageStart-1]?.previewUrl||'',regions:batch.extracted?(batch.extracted.reviewRegions?.length?batch.extracted.reviewRegions:reviewTranscript(batch.confirmedText??batch.extracted.passage_text,null)):[],failure:batch.error||(batch.extracted?extractionFailure(batch.extracted):''),status:batch.status==='reading'?'Reading this page…':batch.status==='queued'?'Waiting to read':batch.status==='failed'?'This page needs another attempt':'Ready to review',structureNotes:batch.extracted?reviewNotes(batch.extracted):[],structureAccepted:!!batch.extracted?.structureAccepted,accepted:!!batch.sourceChecked}))} autoAccept={autoAcceptHigh} busy={false} onAuto={changeReviewPolicy} onRegions={saveRegionReview} onOpen={openBatchReview} onRetry={async(index,lang)=>{if(!batchesRef.current[index]?.extracted){await extractBatch(index,pipelineRun.current,{bypassCache:true});}else await rereadSavedText(index,lang);}} onStructure={async index=>{const b=batchesRef.current[index];if(b?.extracted){updateBatch(index,{extracted:{...b.extracted,structureAccepted:true}});await persistSetCache();}}}/>}

      {stage === "review" && <section className="extraction-inbox"><h2>Learning activities</h2><p>Activities are prepared from accepted text. Page content and question order are checked separately when the reader flags a problem.</p><div className="review-filters">{batches.filter(b=>b.status==='ready').map(batch=><button className="primary-button" key={batch.id} onClick={()=>openReadyBatch(batches.indexOf(batch))}>Open activity · page {batch.pageStart}</button>)}</div>{batches.some(b=>['build_queued','building'].includes(b.status))&&<p role="status">Preparing activities from checked pages… You can continue reviewing.</p>}{error&&<p role="alert">{error}</p>}</section>}

      {stage === "reader" && reader && section && (
        readAlong && readingPath === "choose" ? <ReadingPathChooser title={reader.title} hasHomework={readerHasExercise} onChoose={(path) => { setReadingPath(path); setWholeStoryStage("reading"); setSectionIndex(0); }} />
        : readAlong && readingPath === "whole_story" && wholeStoryStage === "reading" ? <WholeStoryReader
          reader={reader}
          language={language}
          listening={wholeStorySpeaking}
          loading={wholeStoryNarrationStatus === "loading"}
          paused={wholeStoryNarrationStatus === "paused"}
          tokens={wholeStoryTokens}
          activeToken={activeWholeStoryToken}
          onListen={speakWholeStory}
          onWord={(token) => openWorksheetTextWord(token.value, worksheetSentenceAt(wholeStoryText, token.start, token.end))}
          onRaiseHand={() => {
            const focusWord = wholeStoryTokens[activeWholeStoryToken]?.value ?? "";
            narration.pause();
            setTeacherRequest({ kind: "doubt", context: "passage", focusWord, signal: Date.now(), sectionIndex: wholeStoryActiveIndex });
          }}
          teacherHelp={teacherRequest && wholeStoryTeacherSection ? <TeacherVoiceHelp
            key={`whole-story-doubt-${teacherRequest.signal}`}
            adultConfirmed={adultConfirmed}
            language={language}
            level={level}
            narratorVoice={narratorVoice}
            worksheetTitle={reader.title}
            sourceText={wholeStoryTeacherSection.text}
            question={teacherRequest.kind === "doubt" ? `The learner raised a hand while listening to this story part. ${teacherRequest.focusWord ? `The highlighted word was “${teacherRequest.focusWord}”. ` : ""}Ask which exact word or sentence is unclear, then explain only that doubt. Do not reveal a homework answer.` : wholeStoryTeacherSection.question.prompt}
            learnerAttempt=""
            clue={teacherRequest.focusWord}
            keyPoints={teacherRequest.kind === "doubt" ? ["Identify the exact doubt", "Understand the word or sentence in context"] : wholeStoryTeacherSection.question.key_points}
            preparationTargets={currentPreparationTargets}
            purpose={wholeStoryTeacherSection.question.preparation_for?.length ? "homework_warmup" : "standalone_story"}
            progressStyle={teacherRequest.kind === "doubt" ? "review" : "football"}
            supportOnly={teacherRequest.kind === "doubt"}
            classroomMode
            classroomCheckpoint={teacherRequest.kind === "checkpoint"}
            startSignal={teacherRequest.signal}
            onDiscover={onDiscover}
            onAttempted={() => { if (teacherRequest.kind === "checkpoint") markSectionAttempted(wholeStoryTeacherSectionIndex); }}
            onGoal={() => {
              if (teacherRequest.kind === "doubt") return;
              markSectionComplete(wholeStoryTeacherSectionIndex);
              const nextPosition = wholeStoryReadingPosition + 1;
              if (nextPosition < wholeStoryReadingIndices.length) window.setTimeout(() => playWholeStorySection(nextPosition), 700);
            }}
          /> : undefined}
          preparationQuestionCount={preparationGoalCount}
          homeworkQuestionCount={homeworkQuestionCount}
          preparationStatus={preparationStatus}
          onStartPreparation={() => { stopWorksheetNarration(); setWholeStoryStage("questions"); setSectionIndex(0); setWholeStoryReadingPosition(0); }}
          onStartHomework={() => {
            stopWorksheetNarration();
            const preparationIndices = reader.sections.map((item, index) => item.section_kind === "reading" ? index : -1).filter((index) => index >= 0);
            const newlySkipped = preparationStatus === "error" ? [] : preparationIndices.filter((index) => !firstAttemptScores[index]);
            setFirstAttemptScores((current) => ({ ...current, ...Object.fromEntries(newlySkipped.map((index) => [index, "opponent" as FootballAttemptResult])) }));
            setIncompleteSections((current) => [...new Set([...current, ...newlySkipped])]);
            setSkippedPreparationGoals(newlySkipped.length);
            setWholeStoryStage("questions");
            setSectionIndex(Math.max(0, firstHomeworkSectionIndex));
          }}
          onChangePath={() => { stopWorksheetNarration(); setReadingPath("choose"); setWholeStoryStage("reading"); setWholeStoryReadingPosition(0); }}
        />
        : compositionGuide ? <CompositionPlanner adultConfirmed={adultConfirmed} familyId={familyId} reader={reader} language={language} narratorVoice={narratorVoice} onDiscover={onDiscover} />
        : <section className="worksheet-reader-layout">
          <div className="worksheet-scene">
            {guidedExercise ? (
              worksheetInterestActivitiesEnabled ? <WorksheetInterestIllustration activity={wordActivity} status={wordActivityStatus} today={activitySpark} position={sectionIndex + 1} total={reader.sections.length} /> : <WorksheetQuestionGuide
                section={section}
                pageNumber={currentPageNumber}
                localPosition={pageQuestionPosition}
                pageItems={pageItems}
                completed={answeredSections.includes(sectionIndex)}
                streak={answeredSections.length}
                totalCompleted={answeredSections.length}
                totalQuestions={reader.sections.length}
                successMessage={successMessages[sectionIndex]}
                language={language}
                activity={wordActivity}
                activityStatus={wordActivityStatus}
                learnerScore={pageLearnerScore}
                opponentScore={pageOpponentScore}
                currentResult={firstAttemptScores[sectionIndex]}
                onSelectQuestion={openStorySection}
                questionBlock={<section className="worksheet-question-focus worksheet-question-left">
                  <p className="overline">Worksheet instruction</p>
                  <h2 lang={language === "ta" ? "ta" : "zh-Hans"}>{questionTokens.map((token, index) => token.clickable ? (
                    <button ref={(node) => { questionTokenRefs.current[index] = node; }} key={`question-${section.id}-${index}`} className={`worksheet-question-token ${activeQuestionToken === index ? "active" : ""} ${narration.status === "loading" && narration.activeSpeech?.text === token.value ? "voice-loading" : ""}`} onClick={() => openWorksheetTextWord(token.value, section.question.prompt)} disabled={narration.status === "loading" && narration.activeSpeech?.text === token.value}>{token.value}</button>
                  ) : <span key={`question-${section.id}-${index}`}>{token.value}</span>)}</h2>
                  <div className="question-focus-actions"><p className="classroom-question-note"><span aria-hidden="true">◉</span> Tap Listen beside the worksheet sentence. The Voice Teacher will read, then ask this instruction.</p><p>Tap any word for pronunciation, context and English meaning.</p></div>
                </section>}
              />
            ) : section.imageUrl ? (
              <img src={section.imageUrl} alt={section.alt} />
            ) : (
              <div className={`scene-making ${section.imageStatus ?? "waiting"}`}><span>✦</span><h2>{section.imageStatus === "failed" ? "This scene needs another try" : "Painting this story moment…"}</h2><p>{section.imageStatus === "failed" ? "The text reader still works while this picture is unavailable." : "The illustration appears here as soon as it is ready."}</p></div>
            )}
            {!guidedExercise && <div className="worksheet-scene-label"><span>{sectionIndex + 1}</span><p>{section.title}</p></div>}
          </div>

          <article className={`worksheet-reader-panel ${guidedExercise ? "exercise-reader-panel" : ""}`}>
            <header ref={storyStartRef} className={`worksheet-story-title ${guidedExercise ? "exercise-compact-title" : ""}`}>
              {guidedExercise ? <><p>{reader.title}</p><div className="exercise-page-heading"><span>Page {currentPageNumber}</span><b>{section.item_label || `Question ${pageQuestionPosition}`} of {pageQuestionCount}</b><small>{attemptedSections.length} of {reader.sections.length} tried overall</small></div></> : <><p>{reader.title} · Part {sectionIndex + 1} of {reader.sections.length}</p><h1>{section.title}</h1></>}
            </header>
            {guidedExercise && skippedPreparationGoals > 0 && <section className="skipped-preparation-score" role="status">
              <div className="opponent-goal-balls" aria-hidden="true">{Array.from({ length: Math.min(skippedPreparationGoals, 8) }, (_, index) => <span key={index}>⚽</span>)}</div>
              <div><small>Warm-ups skipped</small><b>Opponent scored {skippedPreparationGoals} goals</b><p>You can still score by answering the homework questions.</p></div>
              <strong aria-label={`Overall score: learner ${overallLearnerGoals}, opponent ${overallOpponentGoals}`}>{overallLearnerGoals}–{overallOpponentGoals}</strong>
            </section>}
            <div className="worksheet-linear-progress" aria-label={guidedExercise ? `Page ${currentPageNumber}, ${section.item_label || `question ${pageQuestionPosition}`} of ${pageQuestionCount}` : `Part ${sectionIndex + 1} of ${reader.sections.length}`}>
              <div>
                <span>{guidedExercise ? `Page ${currentPageNumber} · ${section.item_label || `Question ${pageQuestionPosition}`} of ${pageQuestionCount}` : `Part ${sectionIndex + 1} of ${reader.sections.length}`}</span>
                <b>{guidedExercise ? `${pageAttemptedCount} of ${pageQuestionCount} tried · ${pageCompletedCount} correct` : `⚽ ${answeredSections.length} goals earned`}</b>
              </div>
              <div className="worksheet-progress-track" aria-hidden="true"><span style={{ width: `${Math.round(((guidedExercise ? pageAttemptedCount : answeredSections.length) / (guidedExercise ? pageQuestionCount : reader.sections.length)) * 100)}%` }} /></div>
              {!guidedExercise && <p>{answeredSections.includes(sectionIndex) ? "Goal earned. You may continue or return later." : section.question.preparation_for?.length ? "This optional warm-up prepares the printed homework. Answer it for a bonus goal, or continue." : `Listen to the ${readingPath === "whole_story" ? "question" : "paragraph and question"}. You may answer now or continue; unanswered work is saved as Incomplete.`}</p>}
            </div>
            {!guidedExercise && <nav className="reading-question-map" aria-label="Story preparation and homework questions">
              {reader.sections.map((item, index) => {
                const isHomework = item.section_kind === "exercise_item";
                const readingPosition = reader.sections.slice(0, index + 1).filter((candidate) => candidate.section_kind === "reading").length;
                return <button type="button" key={item.id} className={`${index === sectionIndex ? "current" : ""} ${answeredSections.includes(index) ? "complete" : ""} ${incompleteSections.includes(index) ? "incomplete" : ""} ${attemptedSections.includes(index) && !answeredSections.includes(index) ? "attempted" : ""}`} onClick={() => openStorySection(index)}><span>{answeredSections.includes(index) ? "⚽" : isHomework ? item.item_label || "Q" : readingPosition}</span><b>{isHomework ? `Homework ${item.item_label || "question"}` : item.question.preparation_for?.length ? `Warm-up ${readingPosition}` : readingPath === "whole_story" ? `Story question ${readingPosition}` : `Paragraph ${readingPosition}`}</b><small>{answeredSections.includes(index) ? "Goal" : incompleteSections.includes(index) ? "Incomplete" : attemptedSections.includes(index) ? "Tried" : index === sectionIndex ? "Here" : "Open"}</small></button>;
              })}
            </nav>}
            <section className={guidedExercise ? "worksheet-source-block" : undefined}>
            {guidedExercise && <p className="worksheet-source-label">Source sentence from the worksheet</p>}
            <div className="narration-controls worksheet-narration worksheet-narration-top">
              <button className={`listen-button ${sectionNarrationStatus === "playing" ? "speaking" : sectionNarrationStatus === "paused" ? "paused" : ""}`} onClick={speakSection} disabled={sectionNarrationStatus === "loading"} aria-busy={sectionNarrationStatus === "loading"}>
                <span className="listen-icon">{sectionNarrationStatus === "loading" ? "…" : sectionNarrationStatus === "playing" ? "Ⅱ" : "▶"}</span>
                <span><b>{sectionNarrationStatus === "loading" ? "Preparing the Voice Teacher…" : sectionNarrationStatus === "playing" ? "Pause" : sectionNarrationStatus === "paused" ? "Continue" : "Listen"}</b><small>{sectionNarrationStatus === "loading" ? "The lesson will begin in a moment." : sectionNarrationStatus === "playing" ? "The Voice Teacher is reading · words highlight as you listen" : sectionNarrationStatus === "paused" ? "Continue from the same place" : "The Voice Teacher will read, check understanding and ask the question"}</small></span>
              </button>
              {(sectionNarrationStatus === "playing" || sectionNarrationStatus === "paused") && !teacherRequest && <RaiseHandButton onClick={() => raiseWorksheetHand("passage")} />}
              <p><span className="tiny-spark">✦</span> Every word can be tapped.</p>
            </div>
            <div className="worksheet-text" lang={language === "ta" ? "ta" : "zh-Hans"}>
              {tokens.map((token, index) => token.clickable ? (
                <button ref={(node) => { tokenRefs.current[index] = node; }} key={`${section.id}-${index}`} className={`worksheet-token ${activeToken === index ? "active" : ""} ${narration.status === "loading" && narration.activeSpeech?.text === token.value ? "voice-loading" : ""}`} onClick={() => openWorksheetWord(token)} disabled={narration.status === "loading" && narration.activeSpeech?.text === token.value}>{token.value}</button>
              ) : <span key={`${section.id}-${index}`}>{token.value}</span>)}
            </div>
            {narration.error && <p className="narration-error" role="alert">{narration.error} Please try the other AI voice.</p>}
            </section>

            {worksheetInterestActivitiesEnabled && guidedExercise && <WorksheetSubstitutionActivity key={`${reader.worksheetId}-${section.id}-substitution`} activity={wordActivity} status={wordActivityStatus} today={activitySpark} language={language} onSentenceReady={setActivityAnswer} onSpeak={(sentence) => speakWorksheetWord(sentence, false)} />}

            {worksheetInterestActivitiesEnabled && <RealtimeInterestCompanion adultConfirmed={adultConfirmed} language={language} level={level} reader={reader} section={section} narratorVoice={narratorVoice} onOpenWord={openWorksheetTextWord} />}

            <section className={`section-thinking-card ${guidedExercise ? "exercise-answer-card" : ""} ${answeredSections.includes(sectionIndex) ? "complete" : ""}`}>
              {!guidedExercise && <div className="thinking-card-heading">
                <span>{answeredSections.includes(sectionIndex) ? "✓" : "?"}</span>
                <div><small>{section.question.preparation_for?.length ? `Homework warm-up · bonus goal · prepares for ${section.question.preparation_for.join(", ")}` : "Story conversation"}</small><h2 lang={language === "ta" ? "ta" : "zh-Hans"}>{questionTokens.map((token, index) => token.clickable ? (
                  <button ref={(node) => { questionTokenRefs.current[index] = node; }} key={`story-question-${section.id}-${index}`} className={`worksheet-question-token ${activeQuestionToken === index ? "active" : ""} ${narration.status === "loading" && narration.activeSpeech?.text === token.value ? "voice-loading" : ""}`} onClick={() => openWorksheetTextWord(token.value, section.question.prompt)} disabled={narration.status === "loading" && narration.activeSpeech?.text === token.value}>{token.value}</button>
                ) : <span key={`story-question-${section.id}-${index}`}>{token.value}</span>)}</h2></div>
              </div>}
              {!guidedExercise && <div className="story-question-actions"><p className="classroom-question-note"><span aria-hidden="true">◉</span>{teacherRequest?.kind === "checkpoint" ? "The Voice Teacher is asking this now. Speak naturally when it is your turn." : "Tap Listen above. The Voice Teacher will read first, then ask this question."}</p><p>Tap any question word for pronunciation or meaning.</p></div>}
              <div ref={(node) => { teacherHelpAnchorRef.current = node; }}>
              {teacherRequest && <TeacherVoiceHelp
                key={`voice-teacher-${reader.worksheetId}-${section.id}-${teacherRequest?.signal ?? "answer"}`}
                adultConfirmed={adultConfirmed}
                language={language}
                level={level}
                narratorVoice={narratorVoice}
                worksheetTitle={reader.title}
                sourceText={guidedExercise ? `${wholeStoryText}\n\n${section.text}`.trim() : section.text}
                question={teacherRequest.kind === "doubt" ? `The learner raised a hand while listening to the ${teacherRequest.context}. ${teacherRequest.focusWord ? `The highlighted word was “${teacherRequest.focusWord}”. ` : ""}Ask what is unclear, then explain only that doubt simply. Do not answer the worksheet question or award a football goal.` : section.question.prompt}
                learnerAttempt={handwritingResults[sectionIndex]?.transcription || activityAnswer}
                clue={teacherRequest?.focusWord || handwritingResults[sectionIndex]?.feedback || ""}
                keyPoints={teacherRequest.kind === "doubt" ? ["Identify the exact doubt", "Understand the word or line in context"] : section.question.key_points}
                preparationTargets={currentPreparationTargets}
                vocabularyTargets={worksheetSatchelItems}
                purpose={guidedExercise ? "homework_question" : currentPreparationTargets.length ? "homework_warmup" : "standalone_story"}
                progressStyle={teacherRequest.kind === "doubt" ? "review" : "football"}
                supportOnly={teacherRequest.kind === "doubt"}
                classroomMode
                classroomCheckpoint={teacherRequest.kind === "checkpoint"}
                onDiscover={onDiscover}
                writtenGoalRequired={writtenGoalRequired}
                onWordsUsed={(words) => onWordsUsed(words, language)}
                startSignal={teacherRequest?.signal ?? 0}
                onAttempted={() => { if (teacherRequest.kind === "checkpoint") markSectionAttempted(sectionIndex); }}
                onGoal={() => {
                  if (teacherRequest.kind === "doubt") return;
                  markSectionAttempted(sectionIndex);
                  setAnsweredSections((current) => current.includes(sectionIndex) ? current : [...current, sectionIndex]);
                  setIncompleteSections((current) => current.filter((index) => index !== sectionIndex));
                  setFirstAttemptScores((current) => current[sectionIndex] ? current : { ...current, [sectionIndex]: "learner" });
                  setSuccessMessages((current) => ({ ...current, [sectionIndex]: "GOOOAL! You built the answer with the voice teacher." }));
                }}
              />}
              </div>
              {guidedExercise && <HandwrittenAnswerUpload
                key={`written-answer-${reader.worksheetId}-${section.id}`}
                adultConfirmed={adultConfirmed}
                familyId={familyId}
                language={language}
                level={level}
                worksheetTitle={reader.title}
                sourceText={`${wholeStoryText}\n\n${section.text}`.trim()}
                question={section.question.prompt}
                keyPoints={section.question.key_points}
                writtenGoalRequired={writtenGoalRequired}
                onChecking={(checking) => {
                  if (checking) {
                    markSectionAttempted(sectionIndex);
                    setCheckingSections((current) => current.includes(sectionIndex) ? current : [...current, sectionIndex]);
                  } else {
                    setCheckingSections((current) => current.filter((index) => index !== sectionIndex));
                  }
                }}
                onResult={(result) => {
                  setHandwritingResults((current) => ({ ...current, [sectionIndex]: result }));
                  markSectionAttempted(sectionIndex);
                  if (result.verdict === "unreadable" || result.readability !== "readable") return;
                  const correct = result.verdict === "correct" && result.accepted_for_progress;
                  setFirstAttemptScores((current) => {
                    if (current[sectionIndex]) return current;
                    if (correct) return { ...current, [sectionIndex]: "learner" };
                    if (result.verdict === "incorrect") return { ...current, [sectionIndex]: "opponent" };
                    return current;
                  });
                  if (correct) {
                    setWrittenSections((current) => current.includes(sectionIndex) ? current : [...current, sectionIndex]);
                    setSuccessMessages((current) => ({ ...current, [sectionIndex]: writtenGoalRequired ? "GOOOAL! Your written answer is complete." : "Your spoken answer and written homework are complete." }));
                    markSectionComplete(sectionIndex);
                  }
                }}
              />}
            </section>

            {rewardAvailable && (
              <div className="adventure-unlock-banner">
                <span>✦</span>
                <div><small>{readerHasExercise ? "All activities complete" : "Whole story complete"}</small><b>Your final reward is ready</b><p>{reader.content_kind === "informational" || readerHasExercise ? "Take a one-minute game break." : "Invent an alternate ending and turn it into art—or play a quick game."}</p></div>
                <button onClick={() => setRewardOpen(true)}>Choose my reward →</button>
              </div>
            )}

            <div className="reader-actions worksheet-reader-actions">
              <button className="back-button" disabled={sectionIndex === 0} onClick={() => openStorySection(Math.max(0, sectionIndex - 1))}>← Previous {guidedExercise ? "question" : "story part"}</button>
              {hasNextSection ? (
                <button className="primary-button" disabled={!canMoveToNextSection} onClick={() => openStorySection(sectionIndex + 1)}>{nextSectionLabel} <span>{canMoveToNextSection ? "→" : "◇"}</span></button>
              ) : guidedExercise && !currentQuestionAttempted ? (
                <button className="primary-button" disabled>Try this question to finish <span>◇</span></button>
              ) : !guidedExercise ? (
                <button className="primary-button" onClick={() => {
                  if (!answeredSections.includes(sectionIndex) && !attemptedSections.includes(sectionIndex)) setIncompleteSections((current) => current.includes(sectionIndex) ? current : [...current, sectionIndex]);
                  stopWorksheetNarration();
                  setReadingPath("choose");
                  setWholeStoryStage("reading");
                }}>Finish for now <span>✓</span></button>
              ) : hasPendingBatches ? (
                <button className="primary-button" disabled>More pages are being prepared <span>◌</span></button>
              ) : rewardAvailable ? (
                <button className="primary-button" onClick={() => setRewardOpen(true)}>Choose the final reward <span>✦</span></button>
              ) : (
                <button className="primary-button" onClick={resetWorksheet}>Try another worksheet <span>↺</span></button>
              )}
            </div>
            {guidedExercise ? (
              <p className={`question-waiting-note ${currentQuestionAttempted ? "attempt-saved" : ""}`}>{checkingSections.includes(sectionIndex) ? "Reading the written answer now. You may open another question." : currentQuestionAttempted && !answeredSections.includes(sectionIndex) ? "Attempt saved. Keep talking, or photograph the written answer below." : !currentQuestionAttempted ? writtenGoalRequired ? "Talk it through first. The written photo takes the final shot." : "Talk it through with the voice teacher, then add the written homework if needed." : firstAttemptScores[sectionIndex] === "learner" ? writtenSections.includes(sectionIndex) ? "Goal—and the written homework is checked." : "Goal earned through a complete spoken answer." : "Correction complete. The match score stays unchanged."}</p>
            ) : !answeredSections.includes(sectionIndex) && <p className={`question-waiting-note ${incompleteSections.includes(sectionIndex) ? "attempt-saved" : ""}`}>{incompleteSections.includes(sectionIndex) ? "Marked Incomplete. You can return from the paragraph/question strip at any time." : "Answer now, or continue. Moving on will mark this question Incomplete—never locked."}</p>}
            <p className="worksheet-reader-note">Adult QA only. Original pages, checked text, reader plans and generated pictures are saved in this workspace for reuse without another upload.</p>

            {batches.some((_, index) => index !== currentReaderBatchIndex) && <details className="parent-page-status"><summary>Parent page status</summary><section className="batch-pipeline parent-pipeline" aria-label="Other worksheet pages and background processing">
              <div className="batch-pipeline-heading"><span>Parent work · page review</span><p>Background processing stays out of the learner’s reading path.</p></div>
              <div className="batch-pipeline-items">
                {batches.map((batch, index) => index === currentReaderBatchIndex ? null : (
                  <div key={batch.id} className={`batch-pipeline-item ${batch.status}`}>
                    <span>{batch.status === "ready" ? "✓" : batch.status === "reading" || batch.status === "building" ? "◌" : index + 1}</span>
                    <p>
                      <b>{batch.pageStart === batch.pageEnd ? `Page ${batch.pageStart}` : `Pages ${batch.pageStart}–${batch.pageEnd}`}</b>
                      <small>{batch.status === "queued"
                        ? "Queued"
                        : batch.status === "reading"
                          ? `${batch.diagnostic || "Doing one simple whole-page read…"} · ${Math.max(0, Math.floor((pipelineClock - (batch.readStartedAt ?? pipelineClock)) / 1000))}s`
                          : batch.status === "review"
                            ? batch.sourceChecked ? "Parent checked · activity preparation needs retry" : "Needs your review"
                            : batch.status === "build_queued"
                              ? "Parent checked · activity queued"
                              : batch.status === "building"
                              ? "Preparing activity in background"
                              : batch.status === "ready"
                                ? "Activity ready"
                                : "Needs another read · no automatic retry"}</small>
                      {(batch.diagnostic || (batch.status === "failed" && batch.error)) && (
                        <small className="batch-qa-error" aria-live="polite">QA error: {batch.diagnostic || batch.error}</small>
                      )}
                    </p>
                    {batch.status === "review" && <button onClick={() => openBatchReview(index)}>Review page</button>}
                    {batch.status === "ready" && <button onClick={() => openReadyBatch(index)}>Open activity</button>}
                    {batch.status === "failed" && <button onClick={() => void retryBatch(index)}>Retry</button>}
                  </div>
                ))}
              </div>
            </section></details>}
          </article>
        </section>
      )}

      {wordPanel && (
        <div className="word-overlay worksheet-word-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setWordPanel(null); }}>
          <section className="word-sheet worksheet-word-sheet" role="dialog" aria-modal="true" aria-labelledby="worksheet-word-title">
            <button className="close-word" onClick={() => setWordPanel(null)} aria-label="Close word help">×</button>
            <p className="overline">Clue {wordPanel.rung + 1} of 4</p>
            <button id="worksheet-word-title" className={`worksheet-big-word ${narration.status === "loading" && narration.activeSpeech?.text === wordPanel.word ? "voice-loading" : ""}`} onClick={() => speakWorksheetWord(wordPanel.word)} disabled={narration.status === "loading" && narration.activeSpeech?.text === wordPanel.word}>{wordPanel.word}<span>{narration.status === "loading" && narration.activeSpeech?.text === wordPanel.word ? "Preparing voice…" : narration.status === "playing" && narration.activeSpeech?.text === wordPanel.word ? "Ⅱ playing" : "▶ slow"}</span></button>
            {wordPanel.rung === 0 && <div className="worksheet-clue-card"><small>First: hear it</small><p aria-live="polite">{narration.status === "loading" && narration.activeSpeech?.text === wordPanel.word ? "Word selected—preparing the OpenAI voice. The first play can take a moment; repeats are cached." : "Listen slowly. Then put the word back into the worksheet sentence."}</p><blockquote>{wordPanel.context}</blockquote></div>}
            {wordPanel.rung === 1 && <div className="worksheet-clue-card"><small>Try a simple sentence</small><p lang={language === "ta" ? "ta" : "zh-Hans"}>{wordPanel.help?.sentence}</p><button onClick={() => wordPanel.help && speakWorksheetWord(wordPanel.help.sentence, false)}>▶ Read the sentence</button></div>}
            {wordPanel.rung === 2 && <div className="worksheet-clue-card"><small>A simpler way to say it</small><p lang={language === "ta" ? "ta" : "zh-Hans"}>{wordPanel.help?.simple}</p></div>}
            {wordPanel.rung === 3 && <div className="worksheet-clue-card english"><small>English—only after the clues</small><p>{wordPanel.help?.english}</p></div>}
            {language === "zh" && wordPanel.help?.contextual && <div className="worksheet-clue-card context-sense"><small>Here it means · {wordPanel.help.contextual.pronunciation}</small><p>{wordPanel.help.contextual.meaning_here}</p><blockquote lang="zh-Hans">{wordPanel.help.contextual.source_sentence}</blockquote>{contextualHelpNeedsClarification(wordPanel.help) && <em>This can mean different things here—let’s ask the Voice Teacher before saving it.</em>}</div>}
            <WordConstructionCard construction={wordPanel.help?.construction} language={language} />
            {wordPanel.error && <p className="worksheet-error compact-error">{wordPanel.error}</p>}
            <div className="word-actions">
              {contextualHelpNeedsClarification(wordPanel.help)
                ? <button className="satchel-save-button needs-clarification" onClick={() => { setWordPanel(null); narration.pause(); setTeacherRequest({ kind: "doubt", context: "passage", focusWord: wordPanel.word, signal: Date.now() }); }}>Ask Voice Teacher before saving</button>
                : <button className={`satchel-save-button ${wordPanelSaved ? "saved" : ""}`} disabled={wordPanelSaved || wordPanel.loading || !wordPanel.help} onClick={() => wordPanel.help && onDiscover(satchelItemFromHelp(wordPanel.word, language, wordPanel.help))}>{wordPanelSaved ? "Saved in my Magic Backpack ✓" : wordPanel.loading ? language === "zh" ? "Checking the meaning here…" : "Preparing word card…" : language === "zh" ? "Saved after context check ✓" : "Save it in my Magic Backpack"}</button>}
              <button className="primary-button" disabled={wordPanel.loading || wordPanel.rung === 3} onClick={revealWordHelp}>{wordPanel.loading ? "Making a clue…" : wordPanel.rung === 0 ? "Use it in a simple sentence" : wordPanel.rung === 1 ? "Give me a simpler synonym" : wordPanel.rung === 2 ? "Show the English meaning" : "All clues revealed"}<span>→</span></button>
            </div>
          </section>
        </div>
      )}

      {rewardOpen && reader && section && (
        <AdventureBreak
          adultConfirmed={adultConfirmed}
          familyId={familyId}
          reader={reader}
          section={section}
          language={language}
          level={level}
          onClose={() => setRewardOpen(false)}
          onComplete={() => { setRewardOpen(false); setRewardAvailable(false); }}
        />
      )}
    </main>
  );
}

const assessmentRoleLabels: Record<AssessmentPageRole, string> = {
  printed_prompt: "Printed question or prompt",
  student_answer: "Learner's answer",
  teacher_annotations: "Teacher's corrections",
  rubric_feedback: "Marks, rubric or feedback",
  model_answer: "Teacher's model answer",
  other: "Other page",
};

function AssessmentReviewReader({
  text,
  language,
  level,
  adultConfirmed,
  familyId,
  narratorVoice,
  onDiscover,
  teacherTitle = "Marked assessment review",
  contextLabel = "review",
  teacherQuestion,
  teacherSourceText,
  compact = false,
}: {
  text: string;
  language: Language;
  level: Level;
  adultConfirmed: boolean;
  familyId: string;
  narratorVoice: NarratorVoice;
  onDiscover: (item: SatchelItem) => void;
  teacherTitle?: string;
  contextLabel?: string;
  teacherQuestion?: string;
  teacherSourceText?: string;
  compact?: boolean;
}) {
  const narration = useOpenAINarration(adultConfirmed);
  const tokens = useMemo(() => makeWorksheetTokens(text, language), [text, language]);
  const tokenRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const noticeTimer = useRef<number | null>(null);
  const [activeToken, setActiveToken] = useState(-1);
  const [notice, setNotice] = useState("");
  const [wordHelp, setWordHelp] = useState<{ word: string; loading: boolean; saved?: boolean; help?: GlossaryEntry; error?: string } | null>(null);
  const [teacherRequest, setTeacherRequest] = useState<ClassroomTeacherRequest | null>(null);

  useEffect(() => () => { narration.stop(); if (noticeTimer.current) window.clearTimeout(noticeTimer.current); }, []);

  function stop() {
    narration.stop();
    setActiveToken(-1);
  }

  function speakReview() {
    if (narration.status === "playing") { narration.pause(); return; }
    if (narration.status === "paused") { setTeacherRequest(null); void narration.resume(); return; }
    if (narration.status === "loading") return;
    stop();
    setTeacherRequest(null);
    const first = tokens.findIndex((token) => token.clickable);
    if (first >= 0) setActiveToken(first);
    void narration.play({
      text,
      language,
      voice: narratorVoice,
      mode: "story",
      onWord: (index, words) => {
        const target = narrationTokenIndex(index, words, tokens);
        if (target >= 0) setActiveToken(target);
      },
      onProgress: (progress) => {
        if (progress >= 1) return;
        const charIndex = Math.floor(text.length * progress);
        const target = tokens.findIndex((token) => token.clickable && charIndex >= token.start && charIndex < token.end);
        if (target >= 0) setActiveToken(target);
      },
      onEnded: () => {
        setActiveToken(-1);
        setTeacherRequest({ kind: "checkpoint", context: "question", focusWord: "", signal: Date.now() });
      },
    });
  }

  function openWord(word: string, tokenIndex: number) {
    stop();
    setTeacherRequest(null);
    const token = tokens[tokenIndex];
    const context = token ? worksheetSentenceAt(text, token.start, token.end) : text.slice(0, 5000);
    const autoSave = language === "ta";
    setWordHelp({ word, loading: true, saved: autoSave });
    if (autoSave) {
      onDiscover(satchelItemFromHelp(word, language));
      setNotice(word);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(""), 2200);
    }
    if (language === "ta") void narration.play({ text: word, language, voice: narratorVoice, mode: "word" });
    fetch("/api/worksheets/word-help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adultConfirmed, familyId, language, level, word, context }),
    }).then(async (response) => {
      const help = await responseJson<GlossaryEntry & { error?: string }>(response);
      if (!response.ok || !help.english) throw new Error(help.error || "Word help is unavailable right now.");
      return help;
    }).then((help) => {
      const resolvedItem = satchelItemFromHelp(word, language, help);
      const saved = autoSave || !contextualHelpNeedsClarification(help);
      if (saved) {
        onDiscover(resolvedItem);
        setNotice(resolvedItem.word);
        if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(""), 2200);
      }
      if (language === "zh") void narration.play({ text: resolvedItem.word, language, voice: narratorVoice, mode: "word" });
      setWordHelp((current) => current?.word === word ? { word: resolvedItem.word, loading: false, saved, help } : current);
    }).catch(() => setWordHelp((current) => current?.word === word ? { word, loading: false, error: "Word help is unavailable right now." } : current));
  }

  function raiseHand() {
    const focusWord = tokens[activeToken]?.value ?? "";
    if (narration.status === "loading") stop();
    else narration.pause();
    setTeacherRequest({ kind: "doubt", context: "passage", focusWord, signal: Date.now() });
  }

  const readingText = <div className="assessment-review-text" lang={language === "ta" ? "ta" : "zh-Hans"}>{tokens.map((token, index) => token.clickable ? <button ref={(node) => { tokenRefs.current[index] = node; }} key={`${token.start}-${index}`} className={activeToken === index ? "active" : ""} onClick={() => openWord(token.value, index)}>{token.value}</button> : <span key={`${token.start}-${index}`}>{token.value}</span>)}</div>;

  return <section className={`assessment-learning-reader${compact ? " compact-review-reader" : ""}`}>
    <BackpackAddedNotice word={notice} />
    {compact && readingText}
    <div className="narration-controls assessment-review-controls">
      <button className={`listen-button ${narration.status === "playing" ? "speaking" : narration.status === "paused" ? "paused" : ""}`} onClick={speakReview} disabled={narration.status === "loading"}><span className="listen-icon">{narration.status === "loading" ? "…" : narration.status === "playing" ? "Ⅱ" : "▶"}</span><span><b>{narration.status === "loading" ? "Preparing the Voice Teacher…" : narration.status === "playing" ? "Pause" : narration.status === "paused" ? "Continue" : "Listen"}</b><small>{narration.status === "playing" ? "The Voice Teacher is reading · words highlight as you listen" : narration.status === "paused" ? "Continue from the same place" : `The Voice Teacher will read this ${contextLabel} and check understanding`}</small></span></button>
      {(compact || narration.status === "playing" || narration.status === "paused") && !teacherRequest && <RaiseHandButton onClick={raiseHand} />}
      <p><span className="tiny-spark">✦</span> {compact ? "Tap any word for help." : "Tap a word—Storylight checks what it means here before saving."}</p>
    </div>
    {!compact && readingText}
    {narration.error && <p className="narration-error" role="alert">{narration.error} Please try Listen again.</p>}
    {wordHelp && <div className="assessment-word-help"><b lang={language === "ta" ? "ta" : "zh-Hans"}>{wordHelp.word}</b>{wordHelp.loading ? <span>{language === "zh" ? "Checking this expression in context…" : "Preparing word help…"}</span> : wordHelp.help ? <><p lang={language === "ta" ? "ta" : "zh-Hans"}>{wordHelp.help.simple}</p><small>{wordHelp.help.contextual?.pronunciation ? `${wordHelp.help.contextual.pronunciation} · ` : ""}{wordHelp.help.english}</small>{contextualHelpNeedsClarification(wordHelp.help) ? <><em>This can mean different things here—let’s ask the Voice Teacher before saving it.</em><button className="satchel-save-button needs-clarification" onClick={() => { setWordHelp(null); setTeacherRequest({ kind: "doubt", context: "passage", focusWord: wordHelp.word, signal: Date.now() }); }}>Ask Voice Teacher before saving</button></> : <em>{wordHelp.saved ? "Saved in my Magic Backpack ✓" : "Ready to save"}</em>}</> : <span>{wordHelp.error}</span>}<button onClick={() => setWordHelp(null)}>Close</button></div>}
    {teacherRequest && <TeacherVoiceHelp key={teacherRequest.signal} adultConfirmed={adultConfirmed} familyId={familyId} language={language} level={level} narratorVoice={narratorVoice} worksheetTitle={teacherTitle} sourceText={teacherSourceText ? `Current card: ${text}\n\nReference from the confirmed assessment (use only to explain this card):\n${teacherSourceText}` : text} question={teacherRequest.kind === "doubt" ? `The learner raised a hand while listening to this ${contextLabel}. ${teacherRequest.focusWord ? `The highlighted word was “${teacherRequest.focusWord}”. ` : ""}Ask which exact word or line is unclear, then explain only that doubt simply.` : teacherQuestion ?? `Ask the learner to explain one useful thing they understood from this ${contextLabel}.`} learnerAttempt="" clue={teacherRequest.focusWord} keyPoints={teacherRequest.kind === "doubt" ? ["Identify the unclear text", "Explain it simply"] : ["Understand the single idea on this card"]} purpose="assessment_review" progressStyle="review" supportOnly={teacherRequest.kind === "doubt"} classroomMode classroomCheckpoint={teacherRequest.kind === "checkpoint"} startSignal={teacherRequest.signal} onDiscover={onDiscover} />}
  </section>;
}

function AssessmentReviewJourney({ review, scenes, sourceImageUrl, sourceContext, onRetryScene, onSceneImageFailed, language, level, adultConfirmed, familyId, narratorVoice, onDiscover, onFinish }: {
  review: AssessmentReview;
  scenes: Partial<Record<ReviewSceneKey, ReviewScene>>;
  sourceImageUrl?: string;
  sourceContext: string;
  onRetryScene: (key: ReviewSceneKey) => void;
  onSceneImageFailed: (key: ReviewSceneKey) => void;
  language: Language;
  level: Level;
  adultConfirmed: boolean;
  familyId: string;
  narratorVoice: NarratorVoice;
  onDiscover: (item: SatchelItem) => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [sourcePictureFailed, setSourcePictureFailed] = useState(false);
  const [part, setPart] = useState(0);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);
  const steps = [
    { scene: "strength" as const, title: "A good start", icon: "✦", text: review.strengths[0], next: "One small improvement", question: "Briefly celebrate the specific strength on this card. Ask one easy question about it. Do not introduce corrections or other feedback." },
    { scene: "focus" as const, title: "One small improvement", icon: "↗", text: review.focus_areas[0], next: "Let’s try it", question: "Help the learner understand only the improvement on this card. Ask one short question and wait. Do not list other mistakes or give a model answer." },
    { scene: "practice" as const, title: "Try it", icon: "✎", text: review.next_practice.instruction, next: "Finish for now", question: review.voice_teacher_prompt },
  ];
  const current = steps[step];
  const scene = scenes[current.scene];
  const picture = scene?.status === "ready" ? scene.url : sourcePictureFailed ? undefined : sourceImageUrl;
  const parts = useMemo(() => reviewReadingParts(current.text, language), [current.text, language]);
  const text = parts[part] || current.text;
  const lastPart = part >= parts.length - 1;

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [step, part]);

  function openStep(index: number) { setStep(index); setPart(0); }

  return <div className="assessment-guided-review">
    <nav className="review-step-nav" aria-label="Review steps">
      {steps.map((item, index) => <button key={item.title} aria-current={step === index ? "step" : undefined} onClick={() => openStep(index)}><span>{index + 1}</span><b>{item.title}</b></button>)}
    </nav>
    <article className={`review-focus-card review-step-${step}`} aria-labelledby="review-card-title">
      <div className="review-card-heading"><span className="review-card-icon" aria-hidden="true">{current.icon}</span><div><p>Step {step + 1} of 3{parts.length > 1 ? ` · Part ${part + 1} of ${parts.length}` : ""}</p><h2 ref={heading} tabIndex={-1} id="review-card-title">{current.title}</h2></div></div>
      <div className={`review-card-body${picture || scene ? " has-picture" : ""}`}>
        {(picture || scene) && <figure className={`review-context-picture${scene?.status === "ready" ? " generated" : " source"}`}>
          {picture ? <img key={picture} src={picture} onError={() => scene?.status === "ready" ? onSceneImageFailed(current.scene) : setSourcePictureFailed(true)} alt={scene?.status === "ready" ? review.illustrations?.[current.scene].alt || "A picture to support this review point" : "The printed question from your uploaded assessment"} /> : <div className="review-picture-status" role="status"><span aria-hidden="true">✦</span><p>{scene?.status === "failed" ? "The picture isn’t ready yet." : "Drawing a picture from your work…"}</p></div>}
          <figcaption>{scene?.status === "ready" ? "A picture for this point" : picture ? "Your question page" : "You can listen while you wait."}{scene?.status === "loading" && picture && <span role="status">A new picture is on its way.</span>}{scene?.status === "failed" && <button type="button" className="text-button" onClick={() => onRetryScene(current.scene)}>Try picture again</button>}</figcaption>
        </figure>}
        <div className="review-card-copy">
      <AssessmentReviewReader key={`${step}-${part}`} compact text={text} teacherSourceText={sourceContext} language={language} level={level} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} onDiscover={onDiscover} teacherTitle={current.title} contextLabel="card" teacherQuestion={lastPart ? current.question : "Check understanding of only this short part. Ask one simple question and wait; do not introduce the next part yet."} />
        </div>
      </div>
      <div className="review-card-actions">
        <button className="back-button" disabled={step === 0 && part === 0} onClick={() => part > 0 ? setPart(part - 1) : openStep(step - 1)}>← Back</button>
        <button className="primary-button" onClick={() => !lastPart ? setPart(part + 1) : step < 2 ? openStep(step + 1) : onFinish()}>{lastPart ? current.next : "Continue this thought"}<span aria-hidden="true">→</span></button>
      </div>
    </article>
    <p className="review-pace-note">One small step is enough. You can take your time.</p>
  </div>;
}

function AssessmentReviewStudio({
  adultConfirmed,
  familyId,
  initialLanguage,
  initialLevel,
  narratorVoice,
  onClose,
  onDiscover,
  onOpenSatchel,
  satchelItems,
}: {
  adultConfirmed: boolean;
  familyId: string;
  initialLanguage: Language;
  initialLevel: Level;
  narratorVoice: NarratorVoice;
  onClose: () => void;
  onDiscover: (item: SatchelItem) => void;
  onOpenSatchel: () => void;
  satchelItems: SatchelItem[];
}) {
  const [stage, setStage] = useState<"upload" | "verify" | "review">("upload");
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [level, setLevel] = useState<Level>(initialLevel);
  const [files, setFiles] = useState<Array<{ file: File; previewUrl: string; storedId?:string }>>([]);
  const [pages, setPages] = useState<AssessmentReadPage[]>([]);
  const markedPagesRef=useRef(pages);markedPagesRef.current=pages;
  const [autoAcceptHigh,setAutoAcceptHigh]=useState(false);
  const [showAllLabels,setShowAllLabels]=useState(false);
  useEffect(()=>{setAutoAcceptHigh(localStorage.getItem(`storylight:review-policy:${familyId}`)==='true');},[familyId]);
  const markedKey=useRef('');
  const markedSaveChain=useRef(Promise.resolve());
  const [savedMarked,setSavedMarked]=useState<Array<{cacheKey:string;title:string;language:Language;level:Level}>>([]);
  async function markedLibrary(action:string,extra:Record<string,unknown>={}){const response=await fetch('/api/worksheets/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed,familyId,action,kind:'marked',...extra})});const data=await response.json() as any;if(!response.ok)throw Error(data.error);return data;}
  useEffect(()=>{if(familyId&&adultConfirmed)void markedLibrary('list').then(d=>setSavedMarked(d.items)).catch(()=>{});},[familyId,adultConfirmed]);
  async function persistMarked(value:AssessmentReadPage[],key=markedKey.current){if(!key)return;const response=await fetch('/api/worksheets/cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed,familyId,action:'save',cacheKind:'set',cacheKey:key,language,level,payload:{pages:value}})});if(!response.ok)throw Error('The review could not be saved. Keep this page open and retry.');}
  function saveMarkedPages(value:AssessmentReadPage[]){markedPagesRef.current=value;setPages(value);setReview(null);setSaved(false);const task=markedSaveChain.current.catch(()=>{}).then(()=>persistMarked(value));markedSaveChain.current=task.catch(e=>setError(e.message));return task;}
  async function openMarked(item:{cacheKey:string;language:Language;level:Level}){setBusy(true);setError('');try{const manifest=await markedLibrary('open',{cacheKey:item.cacheKey}),restored=[];for(const p of manifest.pages){const response=await fetch(`/api/worksheets/library?familyId=${encodeURIComponent(familyId)}&id=${p.storedId}`);if(!response.ok)throw Error('A saved original is unavailable.');const blob=await response.blob(),file=new File([blob],p.name,{type:p.mime});restored.push({file,previewUrl:URL.createObjectURL(file),storedId:p.storedId});}const response=await fetch('/api/worksheets/cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adultConfirmed,familyId,action:'lookup',cacheKind:'set',cacheKey:item.cacheKey,language:item.language,level:item.level})});const cached=await response.json() as any;if(!response.ok)throw Error('The saved review is unavailable.');setFiles(restored);setLanguage(item.language);setLevel(item.level);markedKey.current=item.cacheKey;setPages(cached.payload?.pages||[]);setStage(cached.payload?.pages?.length?'verify':'upload');setReview(null);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}


  const [review, setReview] = useState<AssessmentReview | null>(null);
  const [reviewScenes, setReviewScenes] = useState<Partial<Record<ReviewSceneKey, ReviewScene>>>({});
  const reviewImageRun = useRef("");
  const pendingReviewImages = useRef(new Map<string, AbortController>());
  const sourceContext = pages.filter((page) => page.role === "printed_prompt" || page.role === "student_answer" || page.role === "teacher_annotations").map((page) => `${assessmentRoleLabels[page.role]}: ${page.transcript}\n${page.visible_teacher_feedback.join("\n")}`).join("\n\n").slice(0, 14000);
  const printedPage = pages.find((page) => page.role === "printed_prompt" && files[page.source_index]?.file.type.startsWith("image/"));
  const sourceImageUrl = printedPage ? files[printedPage.source_index]?.previewUrl : undefined;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  const markedFilesRef=useRef(files);markedFilesRef.current=files;
  const markedConfidenceAttempts=useRef(new Set<string>()),markedConfidenceRunning=useRef(false);
  useEffect(()=>{
    if(busy||markedConfidenceRunning.current||stage!=='verify')return;
    const index=pages.findIndex((p,i)=>!p.textAccepted&&needsConfidenceRefresh(p.reviewRegions)&&files[p.source_index]&&!markedConfidenceAttempts.current.has(`${markedKey.current}:${i}`));
    if(index<0)return;
    const page=pages[index],source=files[page.source_index],key=markedKey.current;markedConfidenceAttempts.current.add(`${key}:${index}`);markedConfidenceRunning.current=true;
    void(async()=>{try{
      const ocr=page.ocrEvidence||await readArchiveOCR(source.previewUrl,source.file.type,'auto',()=>{},language==='ta'?'Tamil':'Chinese');
      if(markedKey.current!==key||markedPagesRef.current[index]!==page)return;
      const regions=acceptHigh(preserveTextReviews(reviewTranscript(page.transcript,ocr),page.reviewRegions),autoAcceptHigh);
      await saveMarkedPages(markedPagesRef.current.map((p,i)=>i===index?{...p,ocrEvidence:ocr||undefined,ocrFailure:ocr?.failureReason||'',reviewRegions:regions,textAccepted:allTextAccepted(regions)}:p));
    }catch(e){setError((e as Error).message);}finally{markedConfidenceRunning.current=false;setPages(v=>[...v]);}})();
  },[pages,files,busy,stage,language,autoAcceptHigh]);

  useEffect(()=>()=>markedFilesRef.current.forEach(item=>URL.revokeObjectURL(item.previewUrl)),[]);
  useEffect(() => () => { reviewImageRun.current = ""; pendingReviewImages.current.forEach((controller) => controller.abort()); }, []);

  async function generateReviewScene(result: AssessmentReview, key: ReviewSceneKey, runId: string) {
    const illustration = result.illustrations?.[key];
    const requestKey = `${runId}:${key}`;
    if (!illustration || pendingReviewImages.current.has(requestKey)) return;
    const controller = new AbortController();
    pendingReviewImages.current.set(requestKey, controller);
    setReviewScenes((current) => ({ ...current, [key]: { status: "loading" } }));
    const timer = window.setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch("/api/worksheets/illustrate", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({
          adultConfirmed, familyId, worksheetId: runId, sectionId: key,
          title: result.title, sectionTitle: `${key} review picture`,
          sectionText: illustration.prompt,
          visualBible: result.illustrations?.visual_bible,
          illustrationPrompt: `${illustration.prompt} This is a visual clue for one review point. Do not add a completed written answer, additional events, names, scores or teacher markings.`,
        }),
      });
      const image = await response.json() as { imageUrl?: string };
      if (!response.ok || !image.imageUrl) throw new Error("Picture unavailable");
      if (reviewImageRun.current === runId) setReviewScenes((current) => ({ ...current, [key]: { status: "ready", url: image.imageUrl } }));
    } catch {
      if (reviewImageRun.current === runId) setReviewScenes((current) => ({ ...current, [key]: { status: "failed" } }));
    } finally {
      window.clearTimeout(timer);
      pendingReviewImages.current.delete(requestKey);
    }
  }

  function prepareReviewScenes(result: AssessmentReview) {
    pendingReviewImages.current.forEach((controller) => controller.abort());
    const runId = `review-${crypto.randomUUID()}`;
    reviewImageRun.current = runId;
    setReviewScenes({});
    // Start the visible card immediately and prepare one ahead; reading never waits.
    void generateReviewScene(result, "strength", runId);
    void generateReviewScene(result, "focus", runId).then(() => {
      if (reviewImageRun.current === runId) void generateReviewScene(result, "practice", runId);
    });
  }

  async function chooseFiles(next: File[]) {
    if(busy)return;setBusy(true);setError('');
    try{
    const accepted:File[]=[];for(const file of next){if(!["application/pdf","image/jpeg","image/png","image/webp"].includes(file.type))throw Error('Choose clear JPG, PNG, WEBP or PDF copies.');accepted.push(...(file.type==='application/pdf'?await splitPdfIntoFullPageImages(file):[file]));if(accepted.length>8)throw Error('Choose up to 8 marked-work pages per review. Your other saved sets remain available.');}
    markedKey.current='';
    files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    setFiles(accepted.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })));
    setPages([]);
    setReview(null);
    reviewImageRun.current = "";
    pendingReviewImages.current.forEach((controller) => controller.abort());
    setReviewScenes({});
    setSaved(false);
    setError(accepted.length ? "" : "Choose clear JPG, PNG, WEBP or PDF copies.");
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  async function readMarkedWork(onlySource?:number) {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const stored=[];for(const item of files){let storedId=item.storedId;if(!storedId){const upload=new FormData();upload.set('adultConfirmed',String(adultConfirmed));upload.set('familyId',familyId);upload.set('file',item.file);const response=await fetch('/api/worksheets/library',{method:'POST',body:upload});const data=await response.json() as any;if(!response.ok)throw Error(data.error);storedId=data.id;}stored.push({...item,storedId});}
      setFiles(stored);const key='marked:'+bytesToHex(sha256(new TextEncoder().encode(stored.map(p=>p.storedId).join(':')+language+level)));markedKey.current=key;
      await markedLibrary('save',{cacheKey:key,title:stored[0].file.name,language,level,pages:stored.map(p=>({storedId:p.storedId,name:p.file.name,mime:p.file.type}))});setSavedMarked((await markedLibrary('list')).items);
      setStage('verify');
      const failures:string[]=[];
      for(let index=0;index<stored.length;index++){
        if(onlySource!==undefined&&index!==onlySource)continue;
        if(markedPagesRef.current.some(p=>p.source_index===index))continue;
        const item=stored[index];
        try{
          const form=new FormData();form.set('adultConfirmed',String(adultConfirmed));form.set('familyId',familyId);form.set('language',language);form.set('level',level);form.append('files',await imageCopyForUpload(item.file,1800,.82),item.file.name);
          const response=await fetch('/api/assessments/read',{method:'POST',body:form}),result=await response.json() as {pages?:AssessmentReadPage[];error?:string};
          if(!response.ok||!result.pages?.length)throw Error(result.error||'No readable content returned.');
          let ocr=null;try{ocr=await readArchiveOCR(item.previewUrl,item.file.type,language==='ta'?'Tamil':'Chinese');}catch{}
          const next=result.pages.map(page=>{const regions=acceptHigh(reviewTranscript(page.transcript,ocr),autoAcceptHigh);return {...page,initialText:page.transcript,ocrEvidence:ocr||undefined,source_index:index,ocrFailure:ocr?.failureReason||'',ocrReaderVersion:ocr?.readerVersion,reviewRegions:regions,textAccepted:allTextAccepted(regions),roleAccepted:false};});
          await saveMarkedPages([...markedPagesRef.current,...next]);
        }catch(e){failures.push(`Page ${index+1}: ${(e as Error).message}`);}
      }
      if(failures.length)setError(failures.join(' ')+' Successful pages are saved. Retry only the unread pages below.');

    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The marked work could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function updatePage(index: number, change: Partial<AssessmentReadPage>) {
    saveMarkedPages(pages.map((page,pageIndex)=>pageIndex===index?{...page,...change,...(change.role!==undefined?{roleAccepted:false}:{}),...(change.transcript!==undefined?{textAccepted:false,reviewRegions:reviewTranscript(change.transcript,null)}:{})}:page));
  }

  async function analyseConfirmedWork() {
    if (busy) return;
    if (!pages.some((page) => page.role === "student_answer") || !pages.some((page) => page.role === "printed_prompt")) {
      setError("Please identify at least one printed prompt and one learner answer before continuing.");
      return;
    }
    if(pages.some(p=>!p.textAccepted||!p.roleAccepted||extractionFailure(p))){setError('Finish the text issues and confirm the page roles before reviewing the learner’s work.');return;}
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assessments/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adultConfirmed, familyId, language, level, pages }),
      });
      const result = await response.json() as AssessmentReview & { error?: string };
      if (!response.ok || !result.strengths?.length || !result.focus_areas?.length) throw new Error(result.error || "The assessment review could not be prepared.");
      setReview(result);
      prepareReviewScenes(result);
      setSaved(false);
      setStage("review");
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The assessment review could not be prepared.");
    } finally {
      setBusy(false);
    }
  }

  async function saveLearningProfile() {
    if (!review || saved || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/assessments/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adultConfirmed, familyId, language, level, title: review.title, strengths: review.strengths, focusAreas: review.focus_areas, rubric: review.rubric }),
      });
      const result = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || !result.saved) throw new Error(result.error || "The learning profile could not be saved.");
      setSaved(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The learning profile could not be saved.");
    } finally {
      setBusy(false);
    }
  }


  return <main className={`assessment-shell lang-${language}`}>
    <nav className="story-nav worksheet-nav">
      <button className="wordmark compact" onClick={onClose}><span className="wordmark-star">✦</span><span>Storylight</span></button>
      <div className="assessment-stage-pills" aria-label="Assessment review progress"><span className={stage === "upload" ? "current" : "complete"}>1 Upload</span><span className={stage === "verify" ? "current" : stage === "review" ? "complete" : ""}>2 Separate</span><span className={stage === "review" ? "current" : ""}>3 Review</span></div>
      <div className="nav-tools"><span className="adult-mode-pill compact">18+ QA</span><button className="satchel-pill" onClick={onOpenSatchel}><span>🎒</span><span className="satchel-label">Magic Backpack</span><b>{satchelItems.filter((item) => item.language === language).length}</b></button></div>
    </nav>

    {stage === "upload" && <section className="assessment-workbench">
      <header className="worksheet-heading"><p className="overline">Review your assessments</p><h1>Find what is strong—and what to practise next.</h1><p>Upload the marked test, learner answer, question page, rubric and any model answer. Storylight separates them before reviewing the work.</p></header>
      {!!savedMarked.length&&<section className="extraction-inbox"><h2>Saved marked work</h2><p>Continue a saved review with its original pages and corrections.</p>{savedMarked.map(item=><button className="text-button" key={item.cacheKey} disabled={busy} onClick={()=>void openMarked(item)}>{item.title} · {item.level}</button>)}</section>}
      <div className="assessment-upload-grid">
        <section className="worksheet-config-card"><span className="config-kicker">Assessment language</span><h2>Tell us what to expect</h2><div className="worksheet-language-toggle" role="group" aria-label="Assessment language"><button className={language === "ta" ? "selected" : ""} onClick={() => setLanguage("ta")}><b>தமிழ்</b><span>Tamil</span></button><button className={language === "zh" ? "selected" : ""} onClick={() => setLanguage("zh")}><b>中文</b><span>Mandarin</span></button></div><div className="worksheet-level-toggle" role="group" aria-label="School level">{(["P3", "P5"] as Level[]).map((item) => <button key={item} className={level === item ? "selected" : ""} onClick={() => setLevel(item)}>{item}</button>)}</div></section>
        <section className="worksheet-upload-card"><input ref={fileInput} className="visually-hidden" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => chooseFiles(Array.from(event.target.files ?? []))} /><button className="worksheet-dropzone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFiles(Array.from(event.dataTransfer.files)); }}><span className="upload-orbit">＋</span><b>{files.length ? `${files.length} assessment ${files.length === 1 ? "page" : "pages"} ready` : "Choose marked assessment pages"}</b><small>Include the printed prompt, learner answer, corrections, rubric and model answer when available.</small></button></section>
      </div>
      {!!files.length && <div className="assessment-file-strip">{files.map((item, index) => <article key={`${item.file.name}-${index}`}>{item.file.type.startsWith("image/") ? <img src={item.previewUrl} alt={`Assessment upload ${index + 1}`} /> : <span>PDF</span>}<small>{item.file.name}</small></article>)}</div>}
      <div className="worksheet-privacy-note"><span>Redact first</span><p>Cover the learner’s name, class, school and other identifiers. Original pages and text corrections are saved in this browser workspace so you can reopen them without uploading again. Pictures created for the review are saved separately. Strengths and focus areas are added to the learning profile only when you choose to save them.</p></div>
      {error && <p className="worksheet-error">{error}</p>}
      <div className="worksheet-footer-actions"><button className="back-button" onClick={onClose}>← Back to home</button><button className="primary-button" disabled={!files.length || busy} onClick={() => void readMarkedWork()}>{busy ? "Separating the pages…" : "Separate question from answers"}<span>→</span></button></div>
    </section>}

    {stage === "verify" && <section className="assessment-workbench wide">
      <header className="worksheet-heading compact-heading"><p className="overline">Adult check · before feedback</p><h1>Did Storylight label each page correctly?</h1><p>Check this carefully. A teacher’s model answer must never be reviewed as though the learner wrote it.</p></header>
      <ExtractionReviewInbox context={{adultConfirmed,familyId,language,level,sessionKey:`review-${markedKey.current||'marked'}`}} onPause={onClose} entries={[...pages.map((p,index)=>({batchIndex:index,page:index+1,name:p.source_page_label||`Source ${p.source_index+1}`,previewUrl:files[p.source_index]?.previewUrl||'',regions:p.reviewRegions?.length?p.reviewRegions:reviewTranscript(p.transcript,null),failure:extractionFailure(p),structureNotes:[],structureAccepted:true,accepted:!!p.textAccepted})),...files.flatMap((f,i)=>pages.some(p=>p.source_index===i)?[]:[{batchIndex:100000+i,page:i+1,name:f.file.name,previewUrl:f.previewUrl,regions:[],structureNotes:[],structureAccepted:true,accepted:false,status:busy?'Reading…':'This page needs another attempt'}])]} autoAccept={autoAcceptHigh} busy={busy} onAuto={value=>{localStorage.setItem(`storylight:review-policy:${familyId}`,String(value));setAutoAcceptHigh(value);saveMarkedPages(pages.map(p=>{const regions=acceptHigh(p.reviewRegions||reviewTranscript(p.transcript,null),value);return{...p,reviewRegions:regions,textAccepted:allTextAccepted(regions)};}));}} onRegions={async(index,regions)=>{await saveMarkedPages(pages.map((p,i)=>i===index?{...p,reviewRegions:regions,transcript:regions.map(r=>r.text).join('\n\n'),textAccepted:allTextAccepted(regions)}:p));}} onStructure={()=>{}} onOpen={()=>setShowAllLabels(true)} onRetry={async(index,readerLanguage)=>{if(index>=100000){await readMarkedWork(index-100000);return;}const page=pages[index],source=files[page.source_index];if(!source)throw Error('Open the saved document first.');const ocr=await readArchiveOCR(source.previewUrl,source.file.type,'auto',()=>{},readerLanguage);if(!ocr||ocr.failureReason)throw Error(ocr?.failureReason||'The saved page could not be read.');const regions=acceptHigh(preserveTextReviews(reviewTranscript(page.transcript,ocr),page.reviewRegions),autoAcceptHigh);saveMarkedPages(pages.map((p,i)=>i===index?{...p,ocrFailure:'',ocrReaderVersion:2,reviewRegions:regions,textAccepted:allTextAccepted(regions)}:p));}}/>
      <div className="extraction-inbox"><h3>Confirm the document roles once</h3><p>{pages.map((p,i)=>`Page ${i+1}: ${assessmentRoleLabels[p.role]}`).join(' · ')}</p><button className="text-button" onClick={()=>setShowAllLabels(!showAllLabels)}>{showAllLabels?'Show only uncertain labels':'Inspect all pages and labels'}</button><button className="primary-button" onClick={()=>saveMarkedPages(pages.map(p=>({...p,roleAccepted:true})))}>These page roles are correct</button></div>
      <div className="assessment-verify-grid">{pages.map((page, index) => (showAllLabels||(!page.roleAccepted&&page.role_confidence!=='high'))&&<article className="assessment-page-card" key={`${page.source_index}-${index}`}><div className="assessment-page-preview">{files[page.source_index]?.file.type.startsWith("image/") ? <img src={files[page.source_index].previewUrl} alt={`Uploaded assessment source ${page.source_index + 1}`} /> : <span>PDF page</span>}</div><div><label><span>What is this?</span><select value={page.role} onChange={(event) => updatePage(index, { role: event.target.value as AssessmentPageRole })}>{Object.entries(assessmentRoleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><small>Role suggestion: {page.role_confidence} confidence · separate from text accuracy</small><label><span>Visible text</span><textarea value={page.transcript} onChange={(event) => updatePage(index, { transcript: event.target.value })} /></label><button className="text-button" onClick={()=>saveMarkedPages(pages.map((p,i)=>i===index?{...p,textAccepted:true,reviewRegions:(p.reviewRegions||reviewTranscript(p.transcript,null)).map(r=>({...r,acceptedBy:'human',acceptedAt:new Date().toISOString()}))}:p))}>I checked this page’s text</button></div></article>)}</div>
      {error && <p className="worksheet-error">{error}</p>}
      <div className="worksheet-footer-actions"><button className="back-button" onClick={() => setStage("upload")}>← Change uploads</button><button className="primary-button" disabled={busy} onClick={() => void analyseConfirmedWork()}>{busy ? "Reviewing the marked work…" : "Labels are correct · Review the work"}<span>→</span></button></div>
    </section>}

    {stage === "review" && review && <section className="assessment-workbench assessment-review-workbench">
      <header className="assessment-review-heading"><div><p className="overline">Marked work review</p><h1>Let’s take it one step at a time.</h1></div></header>
      <AssessmentReviewJourney review={review} scenes={reviewScenes} sourceImageUrl={sourceImageUrl} sourceContext={sourceContext} onRetryScene={(key) => void generateReviewScene(review, key, reviewImageRun.current)} onSceneImageFailed={(key) => setReviewScenes((current) => ({ ...current, [key]: { status: "failed" } }))} language={language} level={level} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} onDiscover={onDiscover} onFinish={onClose} />
      <details className="assessment-adult-details">
        <summary>For parents & teachers <span>Full feedback & learning profile</span></summary>
        <div className="assessment-adult-content">
          <h2 lang={language === "ta" ? "ta" : "zh-Hans"}>{review.title}</h2>
          <p lang={language === "ta" ? "ta" : "zh-Hans"}>{review.overall_summary}</p>
          <div className="assessment-insight-grid"><article className="assessment-strengths"><h3>Strengths</h3><ul lang={language === "ta" ? "ta" : "zh-Hans"}>{review.strengths.map((item) => <li key={item}>{item}</li>)}</ul></article><article className="assessment-focus"><h3>Focus areas</h3><ul lang={language === "ta" ? "ta" : "zh-Hans"}>{review.focus_areas.map((item) => <li key={item}>{item}</li>)}</ul></article></div>
          <section className="assessment-rubric"><h3>Teacher feedback, made clearer</h3>{review.rubric.map((item) => <details key={item.category}><summary lang={language === "ta" ? "ta" : "zh-Hans"}>{item.category}</summary><div lang={language === "ta" ? "ta" : "zh-Hans"}><p>{item.observed}</p><p><b>{item.next_step}</b></p></div></details>)}</section>
          <section className="review-adult-practice"><h3 lang={language === "ta" ? "ta" : "zh-Hans"}>{review.next_practice.title}</h3><p lang={language === "ta" ? "ta" : "zh-Hans"}>{review.next_practice.instruction}</p></section>
          <div className="review-profile-actions"><button className={`primary-button ${saved ? "saved" : ""}`} disabled={busy || saved} onClick={() => void saveLearningProfile()}>{saved ? "✓ Saved to learning profile" : busy ? "Saving…" : "Save strengths & focus areas"}</button><button className="text-button" onClick={() => setStage("verify")}>Review page labels</button></div>
        </div>
      </details>
      {error && <p className="worksheet-error">{error}</p>}
      <div className="review-home-action"><button className="back-button" onClick={onClose}>← Back to home</button></div>
    </section>}
  </main>;
}

function AdultQaGate({ onConfirm }: { onConfirm: () => void }) {
  const [isAdult, setIsAdult] = useState(false);
  const [dummyData, setDummyData] = useState(false);

  return (
    <main className="adult-gate-shell">
      <section className="adult-gate-card" aria-labelledby="adult-gate-title">
        <div className="adult-gate-mark">✦</div>
        <p className="overline">Working prototype · Adult QA only</p>
        <h1 id="adult-gate-title">Test the real AI loop yourself.</h1>
        <p className="adult-gate-lede">
          Test speech feedback, illustrated stories, and guided worksheet exercises using only your own adult voice and redacted test pages.
        </p>
        <div className="adult-gate-flow" aria-label="Prototype flow">
          <span>Record</span><b>→</b><span>Transcribe</span><b>→</b><span>Evaluate</span><b>→</b><span>Save</span><b>→</b><span>Illustrate</span>
        </div>
        <div className="adult-checks">
          <label>
            <input type="checkbox" checked={isAdult} onChange={(event) => setIsAdult(event.target.checked)} />
            <span><b>I am 18 or older.</b><small>I am testing this prototype myself, not handing it to a child.</small></span>
          </label>
          <label>
            <input type="checkbox" checked={dummyData} onChange={(event) => setDummyData(event.target.checked)} />
            <span><b>I will use dummy or redacted test material.</b><small>I will not enter a child’s voice, name, school, class, handwritten answer, or personal information.</small></span>
          </label>
        </div>
        <button className="primary-button adult-enter" disabled={!isAdult || !dummyData} onClick={onConfirm}>
          Enter adult QA prototype <span>→</span>
        </button>
        <p className="adult-gate-note">Microphone audio and worksheet pages are sent to OpenAI for processing. Storylight does not retain raw audio. Original pages, text corrections, reader plans and generated pictures are saved in this workspace so you can reopen them without another upload.</p>
      </section>
    </main>
  );
}

export default function Home() {
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [screen, setScreen] = useState<"welcome" | "setup" | "story" | "worksheet" | "assessment">("welcome");
  const [worksheetLaunchMode, setWorksheetLaunchMode] = useState<WorksheetLaunchMode>("homework");
  const [language, setLanguage] = useState<Language>("ta");
  const [level, setLevel] = useState<Level>("P3");
  const [comfort, setComfort] = useState<Comfort>("growing");
  const [beatIndex, setBeatIndex] = useState(0);
  const [activeToken, setActiveToken] = useState(-1);
  const [activeQuestionToken, setActiveQuestionToken] = useState(-1);
  const narration = useOpenAINarration(adultConfirmed);
  const [narratorVoice] = useNarratorVoice();
  const [showStems, setShowStems] = useState(false);
  const [wordHelp, setWordHelp] = useState<ActiveWordHelp | null>(null);
  const [storySupport, setStorySupport] = useState<StorySupport | null>(null);
  const [storySupportLoading, setStorySupportLoading] = useState(false);
  const [storySupportError, setStorySupportError] = useState("");
  const [satchel, setSatchel] = useState<SatchelItem[]>([]);
  const [satchelOpen, setSatchelOpen] = useState(false);
  const [satchelPulse, setSatchelPulse] = useState(false);
  const [backpackNotice, setBackpackNotice] = useState("");
  const [teacherRequest, setTeacherRequest] = useState<ClassroomTeacherRequest | null>(null);
  const [worksheetBackpackContext, setWorksheetBackpackContext] = useState<BackpackStoryContext | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [interestProfileOpen, setInterestProfileOpen] = useState(false);
  const [interestProfile, setInterestProfile] = useState<SavedInterestProfile>(defaultInterestProfile);
  const [sparkOpen, setSparkOpen] = useState(false);
  const [sparkConfirmed, setSparkConfirmed] = useState(false);
  const [journalRefresh, setJournalRefresh] = useState(0);
  const [familyId, setFamilyId] = useState("");
  const [completedBeats, setCompletedBeats] = useState<string[]>([]);
  const storyWordCache = useRef(new Map<string, GlossaryEntry>());
  const satchelPulseTimer = useRef<number | null>(null);
  const backpackNoticeTimer = useRef<number | null>(null);

  const story = stories[language][level];
  const beat = story.beats[beatIndex];
  const beatNarrationStatus = narration.activeSpeech?.text === beat?.text ? narration.status : "idle";
  const builtInBackpackContext = useMemo<BackpackStoryContext>(() => ({
    language,
    level,
    title: story.title,
    text: story.beats.map((item) => item.text).join("\n\n"),
  }), [language, level, story]);
  const activeBackpackContext = screen === "worksheet" && worksheetBackpackContext ? worksheetBackpackContext : builtInBackpackContext;
  const glossary = language === "ta" ? tamilGlossary : mandarinGlossary;
  const tokens = useMemo(
    () => (beat ? makeTokens(beat.text, language, glossary) : []),
    [beat, language, glossary],
  );
  const questionTokens = useMemo(
    () => beat?.question ? makeTokens(beat.question.prompt, language, glossary) : [],
    [beat, language, glossary],
  );
  const focusWords = useMemo(
    () => Object.keys(glossary).filter((word) => beat?.text.includes(word)).slice(0, 4),
    [beat, glossary],
  );
  const savedFocusItems = useMemo(
    () => satchel.filter((item) => item.language === language && focusWords.includes(item.word)),
    [satchel, language, focusWords],
  );
  const savedFocusWords = savedFocusItems.map((item) => item.word);

  useEffect(() => {
    let confirmed = false;
    try {
      confirmed = sessionStorage.getItem("storylight-adult-qa") === "confirmed";
    } catch {
      // The tester can still confirm for the current session.
    }
    const timer = window.setTimeout(() => setAdultConfirmed(confirmed), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let timer = 0;
    let raw: string | null = null;
    let nextFamilyId = createFamilyId();
    try {
      raw = localStorage.getItem("storylight-satchel");
      const savedFamilyId = localStorage.getItem("storylight-family-id");
      nextFamilyId = savedFamilyId || nextFamilyId;
      if (!savedFamilyId) localStorage.setItem("storylight-family-id", nextFamilyId);
    } catch {
      // The satchel still works for this session when storage is unavailable.
    }
    timer = window.setTimeout(() => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as SatchelItem[];
          const migrationBase = Date.now() - parsed.length * 1000;
          setSatchel(parsed.map((item, index) => ({ ...item, savedAt: item.savedAt ?? migrationBase + index * 1000 })));
        } catch {
          setSatchel([]);
        }
      }
      setFamilyId(nextFamilyId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const profile = loadInterestProfile();
    const timer = window.setTimeout(() => {
      setInterestProfile(profile);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!adultConfirmed || screen !== "welcome") return;
    let checked = false;
    try { checked = sessionStorage.getItem("storylight-spark-checked") === "yes"; } catch { /* session check remains optional */ }
    const confirmTimer = window.setTimeout(() => setSparkConfirmed(checked), 0);
    if (checked) return () => window.clearTimeout(confirmTimer);
    const openTimer = window.setTimeout(() => setSparkOpen(true), 650);
    return () => {
      window.clearTimeout(confirmTimer);
      window.clearTimeout(openTimer);
    };
  }, [adultConfirmed, screen]);

  useEffect(() => {
    return () => {
      stopNarration();
      if (satchelPulseTimer.current) window.clearTimeout(satchelPulseTimer.current);
      if (backpackNoticeTimer.current) window.clearTimeout(backpackNoticeTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    stopNarration();
    const timer = window.setTimeout(() => {
      setShowStems(false);
      setWordHelp(null);
      setStorySupport(null);
      setStorySupportLoading(false);
      setStorySupportError("");
      setTeacherRequest(null);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatIndex, language, level, screen]);

  function stopNarration() {
    narration.stop();
    setActiveToken(-1);
    setActiveQuestionToken(-1);
    setActiveQuestionToken(-1);
  }

  function tokenIndexAt(charIndex: number) {
    let cursor = 0;
    let previousWord = -1;
    for (let i = 0; i < tokens.length; i += 1) {
      const next = cursor + tokens[i].value.length;
      if (charIndex < next) {
        if (tokens[i].clickable) return i;
        if (!/^\s+$/u.test(tokens[i].value)) return previousWord;
        for (let candidate = i + 1; candidate < tokens.length; candidate += 1) {
          if (tokens[candidate].clickable) return candidate;
        }
        return previousWord;
      }
      if (tokens[i].clickable) previousWord = i;
      cursor = next;
    }
    return previousWord;
  }

  function speakBeat() {
    if (beatNarrationStatus === "playing") {
      narration.pause();
      return;
    }
    if (beatNarrationStatus === "paused") {
      setTeacherRequest(null);
      void narration.resume();
      return;
    }
    if (beatNarrationStatus === "loading") return;
    stopNarration();
    setTeacherRequest(null);
    const firstToken = tokenIndexAt(0);
    if (firstToken >= 0) setActiveToken(firstToken);
    void narration.play({
      text: beat.text,
      language,
      voice: narratorVoice,
      mode: "story",
      onWord: (wordIndex, spokenWords) => {
        const nextToken = narrationTokenIndex(wordIndex, spokenWords, tokens);
        if (nextToken >= 0) setActiveToken(nextToken);
      },
      onProgress: (progress) => {
        if (progress >= 1) return;
        const nextToken = tokenIndexAt(Math.floor(beat.text.length * progress));
        if (nextToken >= 0) setActiveToken(nextToken);
      },
      onEnded: () => {
        setActiveToken(-1);
        if (beat.question && !beat.cliffhanger) setTeacherRequest({ kind: "checkpoint", context: "question", focusWord: "", signal: Date.now() });
      },
    });
  }

  function speakWord(text: string, mode: "slow" | "normal" = "slow", spokenLanguage: Language = language) {
    if (narration.status === "loading" && narration.activeSpeech?.text === text) return;
    stopNarration();
    void narration.play({
      text,
      language: spokenLanguage,
      voice: narratorVoice,
      mode: mode === "slow" ? "word" : "sentence",
    });
  }

  function discoverWord(item: SatchelItem) {
    setSatchelPulse(true);
    if (satchelPulseTimer.current) window.clearTimeout(satchelPulseTimer.current);
    satchelPulseTimer.current = window.setTimeout(() => setSatchelPulse(false), 1500);
    setSatchel((current) => {
      const index = current.findIndex((candidate) => sameSatchelItem(candidate, item));
      const next = current.map((candidate) => ({ ...candidate }));
      if (index >= 0) {
        next[index] = {
          ...next[index],
          ...item,
          uses: Math.max(next[index].uses ?? 0, item.uses ?? 0),
          gloss: item.gloss ?? next[index].gloss,
          savedAt: next[index].savedAt ?? item.savedAt ?? Date.now(),
        };
      } else {
        next.push({ ...item, savedAt: item.savedAt ?? Date.now() });
      }
      try {
        localStorage.setItem("storylight-satchel", JSON.stringify(next));
      } catch {
        // Session state remains available.
      }
      return next;
    });
  }

  function showBackpackNotice(word: string) {
    setBackpackNotice(word);
    if (backpackNoticeTimer.current) window.clearTimeout(backpackNoticeTimer.current);
    backpackNoticeTimer.current = window.setTimeout(() => setBackpackNotice(""), 2200);
  }

  function raiseHand(context: "passage" | "question") {
    const focusWord = context === "passage"
      ? tokens[activeToken]?.value ?? ""
      : questionTokens[activeQuestionToken]?.value ?? "";
    narration.pause();
    setTeacherRequest({ kind: "doubt", context, focusWord, signal: Date.now() });
  }

  function openWord(word: string, context = beat.text, fromQuestion = false) {
    if (narration.status === "loading" && narration.activeSpeech?.text === word) return;
    const cacheKey = `${language}:${word}:${context}`;
    const knownHelp = glossary[word] ?? storyWordCache.current.get(cacheKey);
    const needsWordConstruction = !knownHelp?.construction || (language === "zh" && !knownHelp.contextual);
    if (language === "ta") {
      discoverWord(satchelItemFromHelp(word, language, knownHelp));
      showBackpackNotice(word);
    }
    const knownItem = knownHelp ? satchelItemFromHelp(word, language, knownHelp) : null;
    const shownWord = knownItem?.word ?? word;
    setWordHelp({ word: shownWord, context, rung: 0, fromQuestion, loading: needsWordConstruction, help: knownHelp });
    if (language === "ta" || !needsWordConstruction) speakWord(shownWord, "slow");
    if (language === "zh" && knownHelp?.contextual && !contextualHelpNeedsClarification(knownHelp) && knownItem) {
      discoverWord(knownItem);
      showBackpackNotice(knownItem.word);
    }
    if (!needsWordConstruction || !familyId) return;
    void fetch("/api/worksheets/word-help", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adultConfirmed, familyId, language, level, word, context }),
    }).then(async (response) => {
      const result = await responseJson<GlossaryEntry & { error?: string }>(response);
      if (!response.ok || !result.english) throw new Error(result.error || "This word meaning could not be prepared.");
      storyWordCache.current.set(cacheKey, result);
      const resolvedItem = satchelItemFromHelp(word, language, result);
      const shouldSave = language === "ta" || !contextualHelpNeedsClarification(result);
      if (shouldSave) {
        discoverWord(resolvedItem);
        if (language === "zh") showBackpackNotice(resolvedItem.word);
      }
      if (language === "zh") speakWord(resolvedItem.word, "slow");
      setWordHelp((current) => current?.context === context && (current.word === word || current.word === shownWord) ? { ...current, word: resolvedItem.word, loading: false, help: result, error: "" } : current);
    }).catch((problem) => {
      setWordHelp((current) => current?.context === context && (current.word === word || current.word === shownWord) ? { ...current, loading: false, error: problem instanceof Error ? problem.message : "This word meaning is unavailable." } : current);
    });
  }

  function fallbackStoryHelp(): StorySupport {
    if (beat.id === "ta5-1") {
      return {
        question_meaning: "What question does the Vetala ask?",
        key_phrase: "முன்வைக்கிறது",
        key_phrase_meaning: "asks / poses / puts forward",
        story_clue: "“அரசே, உணர்திறன் என்பது ஒருவர் சொல்வதா, அல்லது அவர் காட்டும் ஆதாரமா?”",
        clue_connection: "This quoted line is the exact question the Vetala asks Vikram.",
        answer_frame: "வேதாளம், “_____?” என்று கேட்கிறது.",
      };
    }
    const quotedClue = beat.text.match(/[“"][^”"]+[”"]/g)?.at(-1);
    const lastSentence = beat.text.split(/(?<=[。！？.!?])/).filter(Boolean).at(-1)?.trim() || beat.text;
    const lastQuestionWord = questionTokens.filter((token) => token.clickable).at(-1)?.value ?? "";
    return {
      question_meaning: "Tap any unfamiliar word in the Wonder pause above. Storylight will explain it in this question.",
      key_phrase: lastQuestionWord,
      key_phrase_meaning: "Tap this phrase above for its meaning in context.",
      story_clue: quotedClue ?? lastSentence,
      clue_connection: "This is the shortest nearby story line connected to the Wonder pause.",
      answer_frame: beat.question?.stems?.[0] ?? (language === "ta" ? "என் பதில்: _____" : "我的答案是：_____"),
    };
  }

  async function toggleStoryHelp() {
    if (showStems) {
      setShowStems(false);
      return;
    }
    setShowStems(true);
    if (storySupport || storySupportLoading || !beat.question) return;
    setStorySupportLoading(true);
    setStorySupportError("");
    try {
      const response = await fetch("/api/story/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adultConfirmed,
          familyId,
          language,
          level,
          question: beat.question.prompt,
          storyContext: beat.text,
          existingStems: beat.question.stems ?? [],
        }),
      });
      const result = await responseJson<StorySupport & { error?: string }>(response);
      if (!response.ok || !result.question_meaning) throw new Error(result.error || "Story help could not be prepared.");
      setStorySupport(result);
    } catch (problem) {
      setStorySupport(fallbackStoryHelp());
      setStorySupportError(problem instanceof Error ? `${problem.message} Showing the built-in help instead.` : "Showing the built-in help instead.");
    } finally {
      setStorySupportLoading(false);
    }
  }

  function markWordsUsed(words: string[], wordLanguage: Language = language) {
    if (!words.length) return;
    setSatchel((current) => {
      const next = current.map((item) => ({ ...item }));
      for (const word of words) {
        const existing = next.find((item) => item.word === word && item.language === wordLanguage);
        if (existing) existing.uses = (existing.uses ?? 0) + 1;
      }
      try {
        localStorage.setItem("storylight-satchel", JSON.stringify(next));
      } catch {
        // The word spark still appears for this session.
      }
      return next;
    });
  }

  function markWordMastered(masteredItem: SatchelItem) {
    setSatchel((current) => {
      const next = current.map((item) => ({ ...item }));
      const existing = next.find((item) => sameSatchelItem(item, masteredItem));
      if (existing) existing.uses = (existing.uses ?? 0) + 1;
      try { localStorage.setItem("storylight-satchel", JSON.stringify(next)); } catch { /* Session state remains available. */ }
      return next;
    });
  }

  function responseSaved(beatId: string) {
    setCompletedBeats((current) => current.includes(beatId) ? current : [...current, beatId]);
    setJournalRefresh((value) => value + 1);
  }

  function beginStory() {
    setBeatIndex(0);
    setScreen("story");
  }

  function goHome() {
    stopNarration();
    setScreen("welcome");
    setBeatIndex(0);
  }

  function openUploadedLearning(mode: WorksheetLaunchMode) {
    setWorksheetLaunchMode(mode);
    setScreen("worksheet");
  }

  function markSparkChecked() {
    setSparkConfirmed(true);
    setSparkOpen(false);
    try { sessionStorage.setItem("storylight-spark-checked", "yes"); } catch { /* applies to this rendered session */ }
  }

  function chooseTodaySpark(interest: string) {
    const current = loadInterestProfile();
    const next = { ...current, today: interest, updatedAt: new Date().toISOString() };
    localStorage.setItem("storylight-interests-v1", JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("storylight-interest-profile", { detail: next }));
    setInterestProfile(next);
    markSparkChecked();
  }

  function handleInterestProfileSaved(profile: SavedInterestProfile) {
    setInterestProfile(profile);
    markSparkChecked();
  }

  function openLearnerLens() {
    setSparkOpen(false);
    setInterestProfileOpen(true);
  }

  function confirmAdultQa() {
    setAdultConfirmed(true);
    try {
      sessionStorage.setItem("storylight-adult-qa", "confirmed");
    } catch {
      // Confirmation remains active for this page session.
    }
  }

  if (!adultConfirmed) return <AdultQaGate onConfirm={confirmAdultQa} />;

  if (screen === "welcome") {
    return (
      <>
      <main className="site-shell welcome-shell">
        <nav className="topbar" aria-label="Main navigation">
          <button className="wordmark" onClick={goHome} aria-label="Storylight Together home">
            <span className="wordmark-star">✦</span>
            <span>Storylight</span>
          </button>
          <div className="nav-tools">
            <span className="adult-mode-pill">18+ QA</span>
            <button className="interest-profile-pill" onClick={openLearnerLens}><span>⌁</span> Learner lens</button>
            <button className="journal-pill" onClick={() => setJournalOpen(true)}><span>▤</span> QA journal</button>
            <button className={`satchel-pill ${satchelPulse ? "receiving" : ""}`} aria-label={`${satchel.length} words in the Magic Backpack`} onClick={() => setSatchelOpen(true)}>
              <span>🎒</span> Magic Backpack <b>{satchel.length}</b>
            </button>
          </div>
        </nav>

        <section className="hero welcome-choice-hero">
          <div className="hero-copy welcome-choice-copy">
            <p className="overline">Adult-only working prototype</p>
            <h1>What would you like to do?</h1>
            <p className="hero-lede">
              Choose one clear learning path. Storylight supports Tamil and Mandarin with narration, word help and a patient Voice Teacher.
            </p>
            <div className="learning-path-grid">
              <article className="learning-path-card storytime-card">
                <span className="learning-path-icon">◐</span>
                <p className="overline">Read and talk</p>
                <h2>Storytime</h2>
                <p>Listen to a built-in story, or upload pages from a storybook to explore with the Voice Teacher.</p>
                <div><button className="primary-button" onClick={() => setScreen("setup")}>Choose a built-in story <span>→</span></button><button className="path-secondary-button" onClick={() => openUploadedLearning("storybook")}>Upload storybook pages</button></div>
              </article>
              <article className="learning-path-card homework-card">
                <span className="learning-path-icon">▧</span>
                <p className="overline">Learn and complete</p>
                <h2>Help with homework</h2>
                <p>Upload school worksheet pages and learn how to answer them with the Voice Teacher.</p>
                <button className="primary-button" onClick={() => openUploadedLearning("homework")}>Upload a worksheet <span>→</span></button>
              </article>
              <article className="learning-path-card assessment-card">
                <span className="learning-path-icon">✓</span>
                <p className="overline">Understand and improve</p>
                <h2>Review your assessments</h2>
                <p>Review marked work, see your strengths and focus areas, and save them for future learning paths.</p>
                <button className="primary-button" onClick={() => setScreen("assessment")}>Review marked work <span>→</span></button>
              </article>
            </div>
            <p className="welcome-redaction-note"><span className="pulse-dot" /> Adult QA with dummy or redacted material only</p>
          </div>
        </section>

        <section className="how-it-works" aria-labelledby="how-heading">
          <div>
            <p className="overline">What to test</p>
            <h2 id="how-heading">One Voice Teacher. Three learning paths.</h2>
          </div>
          <div className="ritual-grid">
            <article><span>01</span><h3>Storytime</h3><p>Listen, tap unfamiliar words and talk naturally about a story.</p></article>
            <article><span>02</span><h3>Homework</h3><p>Understand the printed question, prepare with the Voice Teacher and complete the work.</p></article>
            <article><span>03</span><h3>Assessment review</h3><p>Separate the prompt, learner answer and teacher feedback before finding strengths and next steps.</p></article>
            <article><span>04</span><h3>Learning profile</h3><p>Save only confirmed strengths and focus areas to shape later practice.</p></article>
          </div>
        </section>

        <footer className="welcome-footer">
          <span>Storylight Together</span>
          <p>Adult QA only. No audio storage. Original transcripts are never replaced.</p>
        </footer>
      </main>
      {satchelOpen && <MagicSatchelPanel items={satchel} onClose={() => setSatchelOpen(false)} onSpeak={(text, spokenLanguage) => speakWord(text, "slow", spokenLanguage)} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} voiceStatus={narration.status} activeSpeechText={narration.activeSpeech?.text} onMastered={markWordMastered} onSave={discoverWord} demoContext={activeBackpackContext} />}
      {journalOpen && familyId && <JournalPanel familyId={familyId} refreshToken={journalRefresh} onClose={() => setJournalOpen(false)} />}
      <TodaySparkBeacon profile={interestProfile} open={sparkOpen} confirmed={sparkConfirmed} onToggle={() => setSparkOpen((current) => !current)} onChoose={chooseTodaySpark} onNotNow={markSparkChecked} onEditProfile={openLearnerLens} />
      {interestProfileOpen && <InterestProfilePanel onClose={() => setInterestProfileOpen(false)} onSaved={handleInterestProfileSaved} />}
      </>
    );
  }

  if (screen === "worksheet") {
    return (
      <>
        <WorksheetStudio
          adultConfirmed={adultConfirmed}
          familyId={familyId}
          initialLanguage={language}
          initialLevel={level}
          comfort={comfort}
          onClose={goHome}
          onOpenSatchel={() => setSatchelOpen(true)}
          onOpenInterestProfile={openLearnerLens}
          onDiscover={discoverWord}
          satchelItems={satchel}
          satchelPulse={satchelPulse}
          onWordsUsed={markWordsUsed}
          onBackpackContextChange={setWorksheetBackpackContext}
          launchMode={worksheetLaunchMode}
        />
        {satchelOpen && <MagicSatchelPanel items={satchel} onClose={() => setSatchelOpen(false)} onSpeak={(text, spokenLanguage) => speakWord(text, "slow", spokenLanguage)} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} voiceStatus={narration.status} activeSpeechText={narration.activeSpeech?.text} onMastered={markWordMastered} onSave={discoverWord} demoContext={activeBackpackContext} />}
        {worksheetInterestActivitiesEnabled && <TodaySparkBeacon profile={interestProfile} open={sparkOpen} confirmed={sparkConfirmed} onToggle={() => setSparkOpen((current) => !current)} onChoose={chooseTodaySpark} onNotNow={markSparkChecked} onEditProfile={openLearnerLens} />}
        {worksheetInterestActivitiesEnabled && interestProfileOpen && <InterestProfilePanel onClose={() => setInterestProfileOpen(false)} onSaved={handleInterestProfileSaved} />}
      </>
    );
  }

  if (screen === "assessment") {
    return <>
      <AssessmentReviewStudio adultConfirmed={adultConfirmed} familyId={familyId} initialLanguage={language} initialLevel={level} narratorVoice={narratorVoice} onClose={goHome} onDiscover={discoverWord} onOpenSatchel={() => setSatchelOpen(true)} satchelItems={satchel} />
      {satchelOpen && <MagicSatchelPanel items={satchel} onClose={() => setSatchelOpen(false)} onSpeak={(text, spokenLanguage) => speakWord(text, "slow", spokenLanguage)} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} voiceStatus={narration.status} activeSpeechText={narration.activeSpeech?.text} onMastered={markWordMastered} onSave={discoverWord} demoContext={activeBackpackContext} />}
    </>;
  }

  if (screen === "setup") {
    return (
      <main className="site-shell setup-shell">
        <nav className="topbar">
          <button className="wordmark" onClick={goHome}><span className="wordmark-star">✦</span><span>Storylight</span></button>
          <button className="text-button" onClick={goHome}>Close</button>
        </nav>
        <section className="setup-intro">
          <p className="overline">Configure the QA run</p>
          <h1>Which learner journey will you simulate?</h1>
          <p>Choose the target language, school level and support setting, then test the flow using your own adult voice.</p>
        </section>

        <section className="setup-grid">
          <div className="setup-card">
            <div className="setup-number">1</div>
            <div className="setup-content">
              <h2>Choose the target language</h2>
              <div className="language-options">
                <button className={`language-card tamil ${language === "ta" ? "selected" : ""}`} onClick={() => setLanguage("ta")}>
                  <span className="language-script">தமிழ்</span>
                  <span>Paati’s Tamil tale</span>
                  <small>Vikram &amp; Vetala mystery</small>
                </button>
                <button className={`language-card mandarin ${language === "zh" ? "selected" : ""}`} onClick={() => setLanguage("zh")}>
                  <span className="language-script">中文</span>
                  <span>Nainai’s Mandarin tale</span>
                  <small>Monkey King adventure</small>
                </button>
              </div>
            </div>
          </div>

          <div className="setup-card">
            <div className="setup-number">2</div>
            <div className="setup-content">
              <h2>Choose the school level</h2>
              <div className="level-toggle" role="group" aria-label="School level">
                {(["P3", "P5"] as Level[]).map((item) => (
                  <button key={item} className={level === item ? "selected" : ""} onClick={() => setLevel(item)}>
                    <b>{item}</b><span>{item === "P3" ? "Clear plot, supported talk" : "Richer language, deeper inference"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="setup-card">
            <div className="setup-number">3</div>
            <div className="setup-content">
              <h2>Choose a support setting</h2>
              <div className="comfort-options">
                {comfortChoices.map((item) => (
                  <button key={item.id} className={comfort === item.id ? "selected" : ""} onClick={() => setComfort(item.id)}>
                    <span className="comfort-symbol">{item.symbol}</span>
                    <span><b>{item.title}</b><small>{item.description}</small></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="story-ticket">
          <div>
            <p className="overline">QA scenario</p>
            <h2>{story.title}</h2>
            <p>{story.titleEnglish} · {level} · {comfortChoices.find((item) => item.id === comfort)?.title}</p>
          </div>
          <button className="primary-button" onClick={beginStory}>Begin adult test <span>→</span></button>
        </section>
      </main>
    );
  }

  const progress = ((beatIndex + 1) / story.beats.length) * 100;
  const currentEntry = wordHelp?.help ?? (wordHelp ? glossary[wordHelp.word] : undefined);
  const currentWordItem = wordHelp ? satchelItemFromHelp(wordHelp.word, language, currentEntry) : null;
  const currentWordSaved = Boolean(currentWordItem && satchel.some((item) => sameSatchelItem(item, currentWordItem)));
  const activeStoryTeacher = teacherRequest && familyId ? <TeacherVoiceHelp
    key={`classroom-teacher-${language}-${level}-${beat.id}-${teacherRequest.signal}`}
    adultConfirmed={adultConfirmed}
    language={language}
    level={level}
    narratorVoice={narratorVoice}
    worksheetTitle={story.title}
    sourceText={beat.text}
    question={teacherRequest.kind === "doubt"
      ? `The learner raised a hand while listening to the ${teacherRequest.context}. ${teacherRequest.focusWord ? `The highlighted word was “${teacherRequest.focusWord}”. ` : ""}Ask what is unclear and explain only that doubt. Do not answer the story question.`
      : beat.question?.prompt ?? "Ask one short question about the passage."}
    learnerAttempt=""
    clue={teacherRequest.focusWord}
    keyPoints={teacherRequest.kind === "doubt" ? ["Identify the exact doubt", "Understand the word or line in context"] : []}
    vocabularyTargets={savedFocusItems}
    purpose="standalone_story"
    progressStyle={teacherRequest.kind === "doubt" ? "review" : "football"}
    supportOnly={teacherRequest.kind === "doubt"}
    classroomMode
    classroomCheckpoint={teacherRequest.kind === "checkpoint"}
    onDiscover={discoverWord}
    onWordsUsed={markWordsUsed}
    startSignal={teacherRequest.signal}
    onGoal={() => {
      if (teacherRequest.kind === "checkpoint") responseSaved(beat.id);
    }}
  /> : null;

  return (
    <main className={`story-shell lang-${language}`}>
      <nav className="story-nav">
        <button className="wordmark compact" onClick={goHome}><span className="wordmark-star">✦</span><span>Storylight</span></button>
        <div className="story-progress" aria-label={`Part ${beatIndex + 1} of ${story.beats.length}`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="nav-tools">
          <span className="adult-mode-pill compact">18+ QA</span>
          <button className="journal-pill compact-journal" onClick={() => setJournalOpen(true)}><span>▤</span><span>QA journal</span></button>
          <button className={`satchel-pill ${satchelPulse ? "receiving" : ""}`} onClick={() => setSatchelOpen(true)}><span>🎒</span><span className="satchel-label">Magic Backpack</span><b>{satchel.filter((item) => item.language === language).length}</b></button>
        </div>
      </nav>
      <BackpackAddedNotice word={backpackNotice} />

      {narration.status === "loading" && <AudioPreparingNotice voice={narratorVoice} />}

      <section className="reader-layout">
        <div className="story-visual">
          <img src={beat.image} alt={beat.alt} />
          <div className="visual-shade" />
          <div className="visual-caption"><span>{beatIndex + 1}</span><p>{beat.eyebrow}</p></div>
        </div>

        <div className="story-panel">
          <div className="story-heading">
            <div className="narrator-seal" aria-hidden="true">{language === "ta" ? "பா" : "奶"}</div>
            <div><p>{language === "ta" ? `${narratorName(language)} சொல்கிறார்` : `${narratorName(language)}讲故事`} · {narratorName(language)} tells</p><h1>{beat.title}</h1></div>
          </div>

          <div className="narration-controls">
            <button className={`listen-button ${beatNarrationStatus === "playing" ? "speaking" : beatNarrationStatus === "paused" ? "paused" : ""}`} onClick={speakBeat} disabled={beatNarrationStatus === "loading"} aria-busy={beatNarrationStatus === "loading"}>
              <span className="listen-icon">{beatNarrationStatus === "loading" ? "…" : beatNarrationStatus === "playing" ? "Ⅱ" : "▶"}</span>
              <span><b>{beatNarrationStatus === "loading" ? "Preparing the Voice Teacher…" : beatNarrationStatus === "playing" ? "Pause" : beatNarrationStatus === "paused" ? "Continue" : "Listen"}</b><small>{beatNarrationStatus === "loading" ? "The lesson will begin in a moment." : beatNarrationStatus === "playing" ? "The Voice Teacher is reading · words highlight as you listen" : beatNarrationStatus === "paused" ? "Continue from the same place" : "The Voice Teacher will read and pause for questions"}</small></span>
            </button>
            {(beatNarrationStatus === "playing" || beatNarrationStatus === "paused") && !teacherRequest && <RaiseHandButton onClick={() => raiseHand("passage")} />}
            <p><span className="tiny-spark">✦</span> Tap any word to hear it and save its meaning here.</p>
          </div>
          {teacherRequest?.kind === "doubt" && activeStoryTeacher}
          {narration.error && <p className="narration-error" role="alert">{narration.error} Please try Listen again.</p>}

          <div className="story-text" lang={language === "ta" ? "ta" : "zh-Hans"}>
            {tokens.map((token, index) => token.clickable ? (
              <button
                key={`${beat.id}-${index}`}
                className={`story-token ${activeToken === index ? "active" : ""} ${glossary[token.value] ? "has-clue" : ""} ${narration.status === "loading" && narration.activeSpeech?.text === token.value ? "voice-loading" : ""}`}
                onClick={() => openWord(token.value)}
                aria-label={narration.status === "loading" && narration.activeSpeech?.text === token.value ? `Preparing pronunciation for ${token.value}` : `Hear help for ${token.value}`}
              >{token.value}</button>
            ) : <span key={`${beat.id}-${index}`}>{token.value}</span>)}
          </div>

          {beat.question && !beat.cliffhanger && (
            <section className="story-question" aria-labelledby="question-heading">
              <div className="question-label"><span>Wonder pause</span><span>Adult tester speaks</span></div>
              <h2 id="question-heading" className="question-text" lang={language === "ta" ? "ta" : "zh-Hans"}>
                {questionTokens.map((token, index) => token.clickable ? (
                  <button
                    key={`${beat.id}-question-${index}`}
                    className={`question-token ${activeQuestionToken === index ? "active" : ""} ${narration.status === "loading" && narration.activeSpeech?.text === token.value ? "voice-loading" : ""}`}
                    onClick={() => openWord(token.value, beat.question!.prompt, true)}
                    aria-label={`Hear and understand ${token.value} in this question`}
                  >{token.value}</button>
                ) : <span key={`${beat.id}-question-${index}`}>{token.value}</span>)}
              </h2>
              <p className="classroom-question-note"><span aria-hidden="true">◉</span>{teacherRequest?.kind === "checkpoint" ? "The Voice Teacher is asking this now. Speak naturally when it is your turn." : "Tap Listen above. The Voice Teacher will read first, then ask this question."}</p>
              <p className="question-tap-note"><span>☝</span> Tap any word in the question to hear it and see what it means here.</p>
              <details className="qa-inline-note"><summary>Adult QA guidance</summary><p className="parent-cue">{beat.question.parentCue}</p></details>

              {!!focusWords.length && (
                <div className="word-lantern">
                  <div><span>✦</span><p><b>Use-a-word challenge <em>· Word Lantern</em></b><small>Use one of these story words meaningfully in your answer. It lights only after the answer checker confirms the word fits your sentence—even when you use an inflected form.</small></p></div>
                  <div className="lantern-words">
                    {focusWords.map((word) => {
                      const saved = satchel.find((item) => item.word === word && item.language === language);
                      const preparing = narration.status === "loading" && narration.activeSpeech?.text === word;
                      return <button key={word} className={`${saved?.uses ? "sparked" : saved ? "discovered" : "sleeping"} ${preparing ? "voice-loading" : ""}`} onClick={() => openWord(word)} disabled={preparing}><span>{preparing ? "…" : saved?.uses ? "✦" : saved ? "◐" : "◇"}</span>{word}</button>;
                    })}
                  </div>
                  <div className="lantern-key"><span>◇ available</span><span>◐ opened</span><span>✦ used meaningfully</span></div>
                </div>
              )}

              {teacherRequest?.kind === "checkpoint" && activeStoryTeacher}

              <div className="stem-area">
                <button className="stem-toggle" onClick={toggleStoryHelp}>{showStems ? "Hide written hint" : "Show a written hint"}</button>
                {showStems && (
                  <div className="support-tray" aria-live="polite">
                    {storySupportLoading && <div className="support-loading"><span>✦</span><p><b>Making help for this exact question…</b><small>One meaning, one short clue and one answer frame.</small></p></div>}
                    {storySupport && !storySupportLoading && (
                      <>
                        <div className="support-step support-question-meaning">
                          <small>1 · What the question means</small>
                          <p>{storySupport.question_meaning}</p>
                          <button className="support-key-phrase" onClick={() => openWord(storySupport.key_phrase, beat.question!.prompt, true)}>
                            <span lang={language === "ta" ? "ta" : "zh-Hans"}>{storySupport.key_phrase}</span>
                            <b>{storySupport.key_phrase_meaning}</b>
                            <em>Tap to hear and open</em>
                          </button>
                        </div>
                        <div className="support-step support-one-clue">
                          <small>2 · The one story line you need</small>
                          <blockquote lang={language === "ta" ? "ta" : "zh-Hans"}>{storySupport.story_clue}</blockquote>
                          <p>{storySupport.clue_connection}</p>
                          <button className="support-hear" onClick={() => speakWord(storySupport.story_clue, "normal")}>♪ Hear this clue</button>
                        </div>
                        <div className="support-step support-answer-frame">
                          <small>3 · One answer frame</small>
                          <p lang={language === "ta" ? "ta" : "zh-Hans"}>{storySupport.answer_frame}</p>
                          <button className="support-hear" onClick={() => speakWord(storySupport.answer_frame, "normal")}>♪ Hear the frame</button>
                        </div>
                        <p className="support-check-note">Complete the blank in your own words. After you answer, Storylight shows whether it is correct and gives one reference answer to compare.</p>
                        {storySupportError && <p className="support-fallback-note">{storySupportError}</p>}
                      </>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {beat.cliffhanger && (
            <EndingStudio
              key={`${language}-${level}-${beat.id}-ending`}
              adultConfirmed={adultConfirmed}
              familyId={familyId}
              language={language}
              level={level}
              story={story}
              beat={beat}
              targetWords={savedFocusWords}
              onWordsUsed={markWordsUsed}
              onJournalChange={() => responseSaved(beat.id)}
            />
          )}

          <div className="reader-actions">
            <button className="back-button" disabled={beatIndex === 0} onClick={() => { stopNarration(); setBeatIndex(Math.max(0, beatIndex - 1)); }}>← Back</button>
            {beatIndex < story.beats.length - 1 ? (
              <button className="primary-button" disabled={Boolean(beat.question) && !completedBeats.includes(beat.id)} onClick={() => { stopNarration(); setBeatIndex(beatIndex + 1); }}>
                {Boolean(beat.question) && !completedBeats.includes(beat.id) ? "Answer the teacher to continue" : "And then…"} <span>→</span>
              </button>
            ) : (
              <button className="primary-button" onClick={() => { stopNarration(); setBeatIndex(0); }}>Begin the mystery again <span>↺</span></button>
            )}
          </div>

          <div className="source-note">
            <p>{story.source}</p>
            <p>Adult QA only. Use dummy learner responses; do not enter a child’s voice or personal information.</p>
          </div>
        </div>
      </section>

      {wordHelp && (
        <div className="word-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWordHelp(null); }}>
          <section className="word-sheet" role="dialog" aria-modal="true" aria-labelledby="word-title">
            <button className="close-word" onClick={() => setWordHelp(null)} aria-label="Close word help">×</button>
            <p className="overline">{wordHelp.fromQuestion ? "A word from the question" : "A word from the story"}</p>
            <div className="word-title-row">
              <h2 id="word-title">{wordHelp.word}</h2>
              <button className={`round-listen ${narration.status === "loading" && narration.activeSpeech?.text === wordHelp.word ? "voice-loading" : ""}`} onClick={() => speakWord(wordHelp.word, "slow")} disabled={narration.status === "loading" && narration.activeSpeech?.text === wordHelp.word} aria-label="Hear the word slowly">{narration.status === "loading" && narration.activeSpeech?.text === wordHelp.word ? "…" : narration.status === "playing" && narration.activeSpeech?.text === wordHelp.word ? "Ⅱ" : "▶"}</button>
            </div>
            <div className="sound-ruler"><span /><span /><span /><span /><span /><p>slowly</p></div>

            {wordHelp.loading && <div className="word-help-loading" aria-live="polite"><span>✦</span><p><b>Finding what this word means here…</b><small>The pronunciation starts first; the explanation follows.</small></p></div>}
            {wordHelp.error && <p className="word-help-error" role="alert">{wordHelp.error}</p>}
            {wordHelp.fromQuestion && currentEntry && (
              <div className="question-word-meaning">
                <small>Meaning in this question</small>
                <p lang={language === "ta" ? "ta" : "zh-Hans"}>{currentEntry.simple}</p>
                <strong>{currentEntry.english}</strong>
                <div><span>Example</span><p lang={language === "ta" ? "ta" : "zh-Hans"}>{currentEntry.sentence}</p><button onClick={() => speakWord(currentEntry.sentence, "normal")}>♪ Hear the example</button></div>
              </div>
            )}
            {!wordHelp.fromQuestion && wordHelp.rung === 0 && <p className="word-instruction" aria-live="polite">{narration.status === "loading" && narration.activeSpeech?.text === wordHelp.word ? "Word selected—preparing the OpenAI voice now. The first play can take a moment; repeats are cached for instant playback." : "Listen to the word slowly. Say it together before asking for another clue."}</p>}
            {!wordHelp.fromQuestion && wordHelp.rung === 1 && currentEntry && (
              <div className="clue-card"><span>1 · In a simple sentence</span><p lang={language === "ta" ? "ta" : "zh-Hans"}>{currentEntry.sentence}</p><button onClick={() => speakWord(currentEntry.sentence, "normal")}>♪ Hear the sentence</button></div>
            )}
            {!wordHelp.fromQuestion && wordHelp.rung === 2 && currentEntry && (
              <div className="clue-card"><span>2 · A simpler way to say it</span><p lang={language === "ta" ? "ta" : "zh-Hans"}>{currentEntry.simple}</p><button onClick={() => speakWord(currentEntry.simple, "normal")}>♪ Hear the simpler phrase</button></div>
            )}
            {!wordHelp.fromQuestion && wordHelp.rung === 3 && (
              <div className="clue-card english-clue"><span>3 · English meaning</span><p>{currentEntry?.english}</p></div>
            )}

            {language === "zh" && currentEntry?.contextual && <div className="clue-card context-sense"><span>Here it means · {currentEntry.contextual.pronunciation}</span><p>{currentEntry.contextual.meaning_here}</p><blockquote lang="zh-Hans">{currentEntry.contextual.source_sentence}</blockquote>{contextualHelpNeedsClarification(currentEntry) && <em>This can mean different things here—let’s ask the Voice Teacher before saving it.</em>}</div>}
            <WordConstructionCard construction={currentEntry?.construction} language={language} />
            {contextualHelpNeedsClarification(currentEntry)
              ? <button className="satchel-save-button story-save needs-clarification" onClick={() => { setWordHelp(null); narration.pause(); setTeacherRequest({ kind: "doubt", context: wordHelp.fromQuestion ? "question" : "passage", focusWord: wordHelp.word, signal: Date.now() }); }}>Ask Voice Teacher before saving</button>
              : <button className={`satchel-save-button story-save ${currentWordSaved ? "saved" : ""}`} disabled={currentWordSaved || wordHelp.loading || !currentEntry} onClick={() => currentEntry && discoverWord(satchelItemFromHelp(wordHelp.word, language, currentEntry))}>{currentWordSaved ? "Saved in my Magic Backpack ✓" : wordHelp.loading ? language === "zh" ? "Checking the meaning here…" : "Preparing word card…" : language === "zh" ? "Saved after context check ✓" : "Save it in my Magic Backpack"}</button>}
            <div className="word-actions">
              <button className="text-button" onClick={() => setWordHelp(null)}>{wordHelp.fromQuestion ? "Back to the question" : "Back to the story"}</button>
              {wordHelp.fromQuestion ? (
                <button className="primary-button" onClick={() => setWordHelp(null)} disabled={wordHelp.loading}>I understand this word</button>
              ) : (
                <button className="primary-button" onClick={() => setWordHelp({ ...wordHelp, rung: Math.min(3, wordHelp.rung + 1) })} disabled={wordHelp.loading || wordHelp.rung === 3}>
                  {wordHelp.rung === 0 ? "Use it in a sentence" : wordHelp.rung === 1 ? "Make it simpler" : wordHelp.rung === 2 ? "Show English" : "That helped"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {satchelOpen && <MagicSatchelPanel items={satchel} onClose={() => setSatchelOpen(false)} onSpeak={(text, spokenLanguage) => speakWord(text, "slow", spokenLanguage)} adultConfirmed={adultConfirmed} familyId={familyId} narratorVoice={narratorVoice} voiceStatus={narration.status} activeSpeechText={narration.activeSpeech?.text} onMastered={markWordMastered} onSave={discoverWord} demoContext={activeBackpackContext} />}
      {journalOpen && familyId && <JournalPanel familyId={familyId} refreshToken={journalRefresh} onClose={() => setJournalOpen(false)} />}
    </main>
  );
}
