# Run 3 assessed: A* vs D*, API vs machine (2026-09-27)

> The `runs/…` files this report names (specs, plans, critiques, frames, every request and reply) are on branch `prompt-lab`, not on main.

Four blind assessors (Opus agents), one per question, each saw the four
versions of that question as W/X/Y/Z. For each version they had the frame
tiles (one frame per spoken line) and the narration. Each version was scored
out of 10 for explanation and for visual. The key is in
`runs/2026-09-27-final-eval/key.json`.

| Question | A* API | A* machine | D* API | D* machine | Ranking |
|---|---|---|---|---|---|
| 1 money | 6 / 6 | 8 / 5 | 5 / 5 | **8 / 7** | D*m > A*m > A*a > D*a |
| 2 fridge | 7 / 5 | **8 / 8** | 8 / 5 | 7 / 6 | A*m > D*a > D*m > A*a |
| 3 tax | **8 / 6** | 7 / 6 | 6 / 6 | 7 / 7 | A*a > D*m > A*m > D*a |
| 4 aneurysm | 7 / 4 | 8 / 5 | 7 / 3 | **7 / 7** | D*m > A*m > A*a > D*a |

Scores are explanation / visual.

Means (explanation / visual):

| | Explanation | Visual |
|---|---|---|
| A* (4 API + 4 machine) | 7.4 | 5.6 |
| D* (4 API + 4 machine) | 6.9 | 5.75 |
| API (both arms) | 6.75 | 5.0 |
| Machine (both arms) | 7.5 | 6.4 |

First places: A* 2, D* 2; machine 3, API 1.

## Reading

1. **With the same improvements in both, the plan step no longer shows an
   advantage.** A* and D* are level on this data. D*'s lead in earlier runs
   came mostly from what both arms now share: the look pass and the one
   main figure rule.
2. **The look pass is what decides the look.** The three D* API figures
   whose look fixes were rejected are the three lowest visual scores (5, 6
   and 3). The diagnostic rerun of tax D* adopted both fixes, so the
   rejections are chance, not a D* fault. Making the fix path robust matters
   more than the choice of arm.
3. **Machine runs score better than API runs:** +0.75 explanation, +1.4
   visual. Part of that is the rejected API fixes. Part is the agents'
   advantages (more deliberation, reading the full prompt). Machine runs
   are a good lab, but an optimistic one.
4. **Visual remains the weak side (~5.7/10) in both arms.** The recurring
   faults are mostly in templates and the engine, not the prompts:
   - decision-tree branch labels land on the neighbouring branch (two
     separate reports);
   - labels sit on strokes, text is small, cards collide with the heading;
   - stray rectangles appear;
   - emphasis circles a whole graph;
   - things are said but not drawn.
5. **Explanation faults are content faults:**
   - "why it matters" is sometimes missing;
   - numbers appear only in a small readout, not in the narration;
   - some quizzes check recall rather than the insight;
   - one tree left out the operation's own risk in a later-repair branch,
     which flips the verdict (a real factual error the assessor caught).
