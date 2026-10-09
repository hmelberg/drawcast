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

## Everyday people (style "everyday", asked for by Hans 2026-10-07)

Ordinary, average and a little odd or eccentric people, less than perfect
looks, talking into the camera as if filming themselves; normal faces.
Catalogue lines get `style: "everyday"`, `faces: "front"` (or left/right),
and `quirky` in `looks` for the eccentric ones.

> Candid, unpolished smartphone-style photo, chest-up, of an ordinary
> {AGE}-year-old {WHO}, wearing {EVERYDAY CLOTHES}, talking straight into
> the camera mid-sentence with a {normal, slightly earnest / neutral /
> mildly sceptical / friendly smiling} expression. Looks like a regular
> person recording a video at home, not a model: natural imperfect skin,
> nothing glamorous. Even soft light. Background: completely flat solid
> chroma-key green (#00B140), uniform, no shadow on the background. Head and
> shoulders fully inside the frame with some space above the head; body cut
> off at mid-chest by the bottom edge. No green clothing.

To make (about 12):
- talking: m52 thinning messy grey hair, stubble, a bit overweight, faded fleece · f38 tired mum, hair in a loose bun, cardigan · m24 lanky, patchy beard, beanie, hoodie · f67 short permed hair, big glasses, patterned blouse
- neutral: m40 average office worker, receding hairline, checked shirt · f29 plain ponytail, no make-up, grey t-shirt · m70 weathered face, flat cap, wool jumper
- skeptical: f55 reading glasses on a chain, raised eyebrow · m33 heavy-set, arms folded, polo shirt
- smiling: f45 round face, gap-toothed smile, denim jacket
- quirky: m58 wild white hair and bow tie, eccentric professor · f31 bright dyed hair, mismatched earrings, vintage cardigan

Made 2026-10-08 (gemini-3.1-flash-image, 768×1024): e-m52-talking, e-f38-talking,
e-m24-talking, e-f67-talking, e-m40-neutral, e-f29-neutral, e-m70-neutral,
e-f55-skeptical, e-m33-skeptical, e-f45-smiling. Made 2026-10-09: the two quirky
ones, e-m58-quirky and e-f31-quirky. All twelve everyday people are made.
