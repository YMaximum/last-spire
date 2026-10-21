# Dependency maintenance

Updates are reviewed on a focused branch from current `main`. Tests and development
tools are not a reason to change the production runtime or silently raise the
browser compatibility floor. Merging and publishing remain separate.

## Toolchain

The current maintenance baseline uses Vite 8.3.4, Vitest 5.0.5, and TypeScript 7.0.2.
The account API remains on Node 22 and its existing esbuild packaging. Node types
stay on the 22.x line so type checking cannot approve APIs absent from production.

- [Vite's migration guide](https://vite.dev/guide/migration) documents the bundler
  and default browser-target changes. The project explicitly retains Chrome/Edge
  107, Firefox 104, and Safari 16 as build targets. This is a compilation target,
  not evidence that every device/browser version was tested.
- [Vitest's migration guide](https://vitest.dev/guide/migration/) documents version
  five's changed defaults. Keep worker isolation and the serialized CI worker limit;
  do not disable isolation for faster output. The complete suite must pass without
  rewriting golden saves or reducing assertions to accommodate an update.
- TypeScript's stricter side-effect import checking uses the standard `vite/client`
  declarations for CSS imports. Do not turn off checking to hide migration errors.
- [Checkout v7](https://github.com/actions/checkout/releases/tag/v7.0.1) and
  [setup-node v7](https://github.com/actions/setup-node/releases/tag/v7.1.0) run on
  Node 24 inside the Actions runner, while `setup-node` still selects Node 22 for
  project commands. These actions require a runner supporting the Node 24 action
  runtime (at least 2.327.1). Keep immutable action pins, read-only job permissions,
  disabled credential persistence, and explicit dependency-cache opt-out.

## Dependabot policy

Compatible npm minor/patch updates are grouped. Security proposals are grouped
separately, and unrelated npm major migrations remain independently reviewable.
GitHub Actions changes share one review group. These rules reduce duplicate PRs;
they do not enable automatic execution, merging, deployment, or billing changes.

Major `@types/node` updates are ignored until an intentional Node runtime migration.
Security updates still need investigation and appropriate compatibility checks.
Do not assume a major version bump is necessary solely because a stale security
proposal selected the newest available release. Check current advisories and the
actual resolved dependency graph.

When replacing overlapping PRs, link the tested replacement and close the old
proposals with a clear reason. Preserve their branches; do not merge obsolete lock
files into current `main`. Keep actual infrastructure and diagnostic logs private.

## Validation

Use Node 22 for TypeScript, production browser/API builds, and the complete test
suite. Run hosting checks, public-content checks, dependency audit, and the pinned
secret scanner on history and generated outputs. Check the dependency lock's
registry origins and integrity hashes. Exercise the browser preview, reload/save
behaviour, and private-route denial after changing the bundler. Test the updated
workflow on the isolated CI worker before publication; local tests cannot prove
the installed runner supports a new action runtime.
