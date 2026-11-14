# Story grouping: event-identity evidence (Issue #25)

Experimental. Nothing here is used by the app; `groupIntoStories()` is unchanged. This document freezes a hypothesis about **when two news articles describe the same occurrence**, and the protocol for testing it on future RSS snapshots.

## EVH-1: the frozen hypothesis

Code: [`server/lib/eventEvidence.ts`](../server/lib/eventEvidence.ts). It judges one pair of articles at a time and is not a grouping algorithm. Frozen on 2026-11-14 at source sha256 `f282063f65645f1b7f4bc18c9d918026320770a6964d3d6da2f35decb7130cf3`, and [`tests/event-evidence.test.ts`](../tests/event-evidence.test.ts) fails if the file changes.

Freeze record: first frozen at `bcafa214…`. Two code comments there used real people's names as examples; they were replaced with fictional ones (comment-only, no behaviour change) before any snapshot other than the development set was evaluated. The development baseline was re-run under the new hash with identical results.

In words:

1. Two articles **may** describe the same occurrence when they report a **compatible action** and share an **anchor** specific enough for that kind of action.
2. **Action**: what the article reports happening (dismissal, departure, contract, injury, national team, result, preview, candidacy), read from headline and teaser.
3. **Background is not a reported action.** An attributive participle ("den sparkade tränaren", "Klubbens entledigade tränare") or a temporal frame ("efter sparken", "efter förlusten") marks a background mention.
4. **Anchor**, by action:
   - dismissal: the affected person, **or** the same club's head coach (assumption **A1**: a club has one head coach at a time, so "the club's coach change" is one occurrence);
   - departure, contract, injury, national team, candidacy: the affected person;
   - result, preview: the same opponent.

   Names are compared with one-letter tolerance for misspellings (names of 6+ letters). A name that both articles only use as a **speaker** ("X:", "X om …", "X säger …") anchors nothing; the affected person may speak in one of them.
5. **A shared action type alone never establishes identity**, and neither does a shared name alone.
6. **Reactions and explanations** may refer back: an article with a back-reference noun ("beslutet", "beskedet", "avskedet") and no reported action matches an article reporting an action when they share a person.
7. **Insufficient evidence stays insufficient.** The verdict is `same`, `not-same` or `insufficient`, never a guess. Articles more than 48 hours apart, or in different sports, are `not-same`.

### Known weaknesses (observed on the development snapshot after freezing; not fixed in EVH-1)

- Rule 6 does not check that the back-reference points at the same occurrence the other article reports: on the development snapshot it matched a national-team speculation piece to a reaction whose back-reference pointed at the sacking.
- A1 needs a coach-role word in both articles. Two dismissal reports that only name the decision ("avskedet", "skilja … från uppdraget") with no role word and no shared name are `insufficient`.
- A background cause written as a compound ("X-förlusten fällde avgörandet") is not detected as background.
- The lexicon is in-sample: written against the 2026-11-13 and 2026-11-14 snapshots.

Fixing any of these produces **EVH-2**: a new version with its own hash and its own evaluation, on snapshots captured after EVH-2 is frozen.

## Evaluation protocol

All third-party text and every label stay in the gitignored `.data/grouping-eval/`. The scripts in [`scripts/grouping-eval/`](../scripts/grouping-eval/) are original code and are committed. Run them from the repo root with `npx jiti`.

1. **Capture**: `capture.ts` writes `snapshots/snapshot-<UTC>.json`. Capture regularly (e.g. daily): the feeds roll over and a missed day can't be recovered.
2. **Label before looking at any output**: `label-template.ts <snapshot>` prints every article in full and writes an empty `labels/labels-<UTC>.v2.json`. Never filter the printed text (a `grep -v profile` once hid a teaser).
   - Group articles into **events** (your own short description). Mark each event `new` or `known:<registry id>` if an earlier snapshot already had it.
   - Relations between events: same event = **same identifiable occurrence**; listed `related-distinct` = **related development, distinct occurrence**; listed `insufficient` = unclear; anything else = **different or unrelated**.
   - Per article: `confidence` (`confident` or `insufficient`), `reason`, `feedEvidence` (exact phrases from its headline or teaser, checked verbatim when pinning), `outsideKnowledge` (anything the label needed from outside the feed), and `gold` (the reported `action`, any `background` actions, the `anchors`), which is used to attribute errors.
   - Set `hypothesisOutputSeen: false`. If you have seen output for this snapshot, don't label it.
3. **Pin**: `pin.ts <snapshot> <labels>` validates the file, records its sha256 in `pins.json` and registers new events in `events-registry.json`. It refuses once the snapshot has been evaluated.
4. **Evaluate**: `evaluate.ts <snapshot> <labels>` refuses unpinned or changed labels. It reports, on confident pairs:
   - pairwise precision and recall of `same`;
   - false merges (`same` on related-distinct or different pairs) and false splits (`not-same` on same pairs), with abstentions (`insufficient` on same pairs) separately;
   - the number of distinct labelled events, and of events with a same-occurrence pair;
   - the same figures on **new events only** (not in the development set);
   - each error's cause: action detection, anchor detection, background mention, event ambiguity, or the hypothesis rule itself;
   - production's `groupIntoStories()` read as pairs, as a baseline.

   Every run is appended to `evaluations.json` with the hypothesis version and scorer hash; the summary goes to `results/`. Output names only article numbers, event ids and rules, so it can be shared.
5. **No tuning before evaluating.** Record a version's failures on a snapshot first. A revised hypothesis gets a new version and is judged only on snapshots captured after it was frozen.

## Development baseline (in-sample, not evidence)

EVH-1 on the 2026-11-14 development snapshot (labels v1, pinned before EVH-1 existed; the lexicon was written against it):

| | Precision | Recall | False merges | Abstained on same |
|---|---|---|---|---|
| EVH-1 | 21/21 | 21/23 | 0 | 2 |
| Production `groupIntoStories()` | 8/11 | 8/23 | 3 | — |

The 23 same-occurrence pairs come from only 3 events. This shows the code does what it was written to do, not that the hypothesis holds.

## What would justify moving toward implementation

All of these, on snapshots captured **after** the evaluated version was frozen:

- **Breadth**: at least 15 new events with a same-occurrence pair, across at least 10 snapshots over at least two weeks, including several kinds (dismissals, transfers, match reports, injuries), not one dominant event.
- **Precision first**: no false merge between unrelated events, and pairwise precision of at least 95% on confident pairs. A false merge claims a relation that isn't there; a split is honest.
- **Recall that matters**: clearly better than production's baseline on the same new pairs, with abstentions counted as misses.
- **No systematic error class**: no single cause (background mentions, a misread word, missed anchors) accounting for repeated errors.
- **Labelling checked**: a human independently labels a sample of the snapshots, and agreement with the original labels is reported.

Even then, the next step is a grouping experiment built on the hypothesis, compared against the regression cases and the Degerfors fixture, not a production change.
