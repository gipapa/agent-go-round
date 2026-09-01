# Real tutorial gate evidence

Copy [`template.md`](./template.md) to `milestone-a.md` through `milestone-e.md`
when the corresponding milestone gate is run. Add the matching `milestone-a`
through `milestone-e` label to the milestone PR. The evidence file is part of
the milestone's completion review and must be linked from the PR description; CI
fails if a labeled PR does not change its matching evidence file. A case that was
not run because its
feature was not migrated must be recorded as `skipped` with the reason; it is not
a pass.

The local `.tutorial-test.local.json` may contain credentials and must never be
copied into this directory.
