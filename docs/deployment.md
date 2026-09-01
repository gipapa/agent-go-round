# Deployment and rollback

## Production source

The repository's GitHub Pages source is the `gh-pages` branch at `/`, confirmed with:

```bash
gh api repos/gipapa/agent-go-round/pages --jq '{build_type,source,url}'
```

Production is deployed only by `.github/workflows/gh-pages.yml`. The workflow runs its
lint, test, build, and bundle-budget verification job before the deployment job. The
separate `preview.yml` workflow writes only to the `/preview/` subdirectory and is not
the production pipeline. The former `.github/workflows/pages.yml` workflow was
disabled in the repository settings on 2026-09-01 and is deleted from the PR0
working tree.

Production URL: <https://gipapa.github.io/agent-go-round/>

## Preview

Run **Deploy preview to gh-pages** manually with a branch or commit, or push the
`next` branch. The preview is built with:

```text
BASE_PATH=/${repository}/preview/
```

Preview URL after the first successful preview workflow run: <https://gipapa.github.io/agent-go-round/preview/>

The preview workflow uses the same lint, test, build, and bundle checks as production
and publishes to `gh-pages/preview/` with `keep_files: true`.

## Rollback to the Phase 0 baseline

Confirm the target tag and Pages source before changing the deployment branch:

```bash
git show --no-patch --decorate pre-pi-native-v2-2026-09
gh api repos/gipapa/agent-go-round/pages --jq '{build_type,source,url}'
```

To rebuild and publish the baseline, use a separate temporary checkout and the
repository's existing `gh-pages` publisher:

```bash
rollback_dir="$(mktemp -d)"
git archive pre-pi-native-v2-2026-09 | tar -x -C "$rollback_dir"
cd "$rollback_dir"
npm ci
BASE_PATH="/agent-go-round/" npm run build
npx gh-pages -d dist -b gh-pages -m "rollback: pre-pi-native-v2-2026-09"
```

After publishing, open the production URL and run the baseline desktop/mobile smoke
check. Keep the temporary checkout until the URL and the `gh-pages` tree have been
verified.
