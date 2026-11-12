# figma-ui-spec

Turns a Figma design into a build spec written in a project's own tokens and components, lists every place where the design and the design system disagree, and guards shared components against changes made as a side effect of feature work.

Built for Tailwind v4 projects whose shared components use [cva](https://cva.style). The project itself is never changed: the tool only reads it.

Status: `catalogue` and `design` work. The spec and the guard are not built yet.

## Use

```bash
npm install
node bin/figma-ui-spec.js catalogue --repo my-web-app            # what the tool reads from the project
node bin/figma-ui-spec.js catalogue --repo my-web-app --json
node bin/figma-ui-spec.js catalogue --repo my-web-app --root ../my-web-app-worktree
```

`catalogue` prints the project's design system as the tool understands it:

- typography components: one line per variant value, resolved to family, size, line height, weight and letter spacing, for example `Title level=4  Comfortaa 33px/41.25 700`. Classes no theme variable explains are listed as unresolved;
- theme tokens by kind (font families, text sizes, weights, line heights, letter spacing, spacing unit, radius, shadows, colours), with references followed (`primary  #ffc82c  via color-orange-500`) and framework defaults marked;
- the protected paths from the config.

The theme is read the way Tailwind v4 layers it: the framework's default theme first, then the project's `@theme` blocks in order, with `--namespace-*: initial` clearing a namespace except the sub-namespaces Tailwind keeps (font weights under `--font-*`, text shadows under `--text-*` and so on).

Classes are resolved as plain Tailwind applies them: within one property the later class wins, a `leading-*` class beats the line height a `text-*` size brings with it whatever the order, and `em` letter spacing is taken against the final size. No class-merging step is modelled. A component that passes its classes through tailwind-merge with the default config can drop an earlier `leading-*` when a `text-*` size comes later, so its real line height may differ from the catalogue's. Classes behind a variant prefix (`md:text-h4`, `hover:font-bold`) are listed as conditional and left out of the style.

```bash
node bin/figma-ui-spec.js design --figma 'https://www.figma.com/design/<key>/<name>?node-id=12-34'
node bin/figma-ui-spec.js design --figma '<url>' --frames 12:40,12:41 --json > snapshot.json
```

`design` reads a Figma page, section or frame through the REST API, with `FIGMA_TOKEN` from `.env`:

- the outline first, three levels deep in one call, plus one call per further level of nested sections: the design frames and local components under each section, and everything beside them that is not a design, each with the reason it was skipped (pasted images, arrows and divider lines, outline shapes, notes, short text-only labels, hidden layers). Project-specific rules go in the config's `design.skip`;
- then the frames' full trees, a few per request, normalised to what a build needs: auto-layout direction, gap and padding, sizes and positions relative to the frame, fills, strokes, radius, shadows, text with its font, the library styles each node uses by name, bound variable ids, and component instances with their variant properties;
- the file's comments pinned under the root, with the frame each sits in.

Responses are cached in `.cache/<file key>/<version>/`, so re-reading an unchanged file costs two calls (the version check and the comments). The token's owner needs a Full or Dev seat: Figma's limits for the node endpoint are much lower for View and Collab seats. A short `Retry-After` is waited out once; a long one stops the run with the wait time.

Needs Node 22.18 or later; the CLI runs the TypeScript sources directly.

## Configure

Everything specific to a machine or a project lives in this checkout and is gitignored:

```
.env              FIGMA_TOKEN=…   (copy .env.example)
.repos/<name>/    config.json for each project
.cache/           Figma snapshots
```

A test and the pre-commit hook (enabled by `npm install`) refuse to track any of them. Variables already set in the environment win over `.env`.

`.repos/<name>/config.json`, see [repos.example/config.json](repos.example/config.json):

- `root`: absolute path to the project checkout; `--root` replaces it.
- `theme.base`: the framework's default theme, usually `node_modules/tailwindcss/theme.css`.
- `theme.files`: the project's CSS files holding `@theme` blocks, in load order.
- `theme.rootPx`: pixels per rem, 16 by default.
- `theme.fontFamilies`: family names for font variables set at runtime (for example by `next/font`), keyed by the token's name: `{ "roboto": "Roboto" }` for `--font-roboto`.
- `typography`: typography components, each with its `component` name, the `file` holding its definition and the `cva` variable name.
- `protectedPaths`: globs of shared code that feature work must not change.
- `design.skip`: extra skip rules for `design`, each with a `reason` and a `name` regex, a node `type`, or both: `{ "name": "^Annotation", "reason": "annotation" }`.

## Develop

```bash
npm run typecheck
npm run lint            # oxlint, warnings fail
npm run format          # oxfmt; format:check in CI
npm test
```

Lint rules live in `.oxlintrc.json`: oxlint's correctness, suspicious and perf categories, a few style rules, and sonarjs complexity limits (cognitive complexity 15, nesting 3, at most 3 operators per condition). The pre-commit hook runs lint and the format check when `node_modules` is installed. It checks the whole working tree, not only what is staged, so format or stash untracked scratch files before committing.

`fixtures/tailwind-v4` is a small project with the edge cases the readers have to handle: a `/*` inside a string, namespace resets, nested `@keyframes`, runtime font variables, `var()` fallbacks and cva definitions with arrays, numeric and boolean keys.

## License

MIT
