// How the viewer meets a cast's questions — the choice itself, with no DOM
// in it (the store and the exporter read it). The player side is ui/watch.ts.

export type QuestionMode = "interactive" | "watch" | "skip";

export const QUESTION_MODES: { value: QuestionMode; label: string; title: string }[] = [
  { value: "interactive", label: "Interactive", title: "Stop at each question and wait for your answer" },
  { value: "watch", label: "Watch", title: "Watch someone answer each question, then the answer — no stops" },
  { value: "skip", label: "Skip", title: "Leave the questions out" },
];

export const isQuestionMode = (v: unknown): v is QuestionMode => v === "interactive" || v === "watch" || v === "skip";

/** What the render and the exporter take: they know only "on" and "skip". */
export const questionsOption = (m: QuestionMode | undefined): "on" | "skip" => (m === "skip" ? "skip" : "on");
