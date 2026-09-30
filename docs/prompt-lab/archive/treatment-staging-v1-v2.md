# Treatment v1/v2: the code around the prompts (retired 2026-09-30)

`treatment-v1.md` and `treatment-v2.md` beside this file are the prompt texts.
In the app they were wrapped by two pieces of `src/llm/treatment.ts`, kept here
from tag `archive/pipeline-experiments-2026-09-30`.

## The template block appended to the v1/v2 system prompt (`buildTreatmentSystem`)

```ts
  const templates = templateLines.trim()
    ? `## Ready figure templates that may fit this request\n\nUse one when it draws what you need; otherwise plan a freehand figure.\n\n${templateLines.trim()}`
    : "## Ready figure templates\n\nNone fits this request closely: plan a freehand figure.";
  return `${SOURCES[version].trim()}\n\n${templates}\n`;
}
```

## The staging note for a v1/v2 treatment (`stagingNote`)

```ts
  return [
    "## The treatment to stage",
    "",
    "A teacher has already planned this drawcast. STAGE it: build the figure it describes and one command per beat, in its order, with its lines as the `speak` text.",
    "- Keep the lines. You may tighten one to fit the ink, split a long one across two beats, or merge two short ones — never change what it says or add new ideas.",
    "- The treatment's length and opening override the general length and opening guidance in your instructions.",
    "- Choose the exact verbs, ids, colors and layout yourself, following your instructions; where the treatment asks for something the medium cannot do, do the nearest thing it can.",
    "- Open with a `card` heading as usual.",
    "",
    treatment.trim(),
  ].join("\n");
}
```
