# Thumbnail people: how they are made

Generated with Figma's `generate_image` (model `gemini-3.1-flash-image`,
768 × 1024), then cut out with
`node scripts/build-thumb-people.mjs <raw-dir> [id …]`. Each new picture also
needs a line in `PEOPLE` in `netlify/lib/people.mts`, with `faces` set to the
way the person looks as the viewer sees it, and `w`/`h` set to the size the
script prints.

## Prompt template

> Photorealistic chest-up portrait of a {AGE}-year-old {WHO}, wearing a plain
> {CLOTHES}, with {FACE}. {She/He} is turned slightly toward the {left/right}
> of frame, looking toward the {left/right} side. Soft even studio lighting,
> sharp focus, natural skin. Background: completely flat solid chroma-key
> green (#00B140), uniform, no gradient, no shadow on the background. Head
> and shoulders fully inside the frame with some space above the head; the
> body is cut off at mid-chest by the bottom edge. No green clothing. YouTube
> thumbnail reaction photo style.

Faces:
- surprised: a genuinely surprised expression: eyebrows raised high, eyes wide, mouth open in an "oh!" shape
- puzzled: a puzzled, confused expression: one eyebrow raised, head tilted, lips pursed to one side, (a hand gesture)
- annoyed: an annoyed, exasperated expression: eyes rolled slightly upward, brows pulled together, mouth flat in a grimace, arms crossed
- laughing: laughing out loud: wide open-mouthed smile, eyes crinkled, head tipped back slightly

## Made (10)

m45 bald surprised · f19 surprised · m9 surprised · f72 surprised · m28 surprised ·
f35 surprised · m60 surprised · f16 surprised · f19 puzzled · m45 puzzled

## Still to make (stopped at Figma's usage limit, 2026-10-07)

- puzzled: m72 bald white beard · f9 braids · m16 blond · f28 East Asian bob · m35 dark beard · f60 short grey
- annoyed: f45 blonde bob · m19 · m60 beard · f28 · m9 · f72 · m35 bald · f16
- laughing: m28 · f45 · m72 · f9 · f19 · m45 · f60 · m16
