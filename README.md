# figma-ui-spec

Turns a Figma design into a build spec written in a project's own tokens and components, lists every place where the design and the design system disagree, and guards shared components against changes made as a side effect of feature work.

Built for Tailwind v4 projects whose shared components use [cva](https://cva.style). The project itself is never changed: the tool only reads it.

Status: `catalogue`, `design`, `table`, `map`, `spec`, `decide`, `guard` and `hook` work.

## Use

```bash
npm install
node bin/figma-ui-spec.js catalogue --repo my-web-app            # what the tool reads from the project
node bin/figma-ui-spec.js catalogue --repo my-web-app --json
node bin/figma-ui-spec.js catalogue --repo my-web-app --root ../my-web-app-worktree
```

`catalogue` prints the project's design system as the tool understands it:

- typography components: one line per variant value, resolved to family, size, line height, weight and letter spacing, for example `Heading level=4  Lexend 32px/40 700`. Classes no theme variable explains are listed as unresolved;
- theme tokens by kind (font families, text sizes, weights, line heights, letter spacing, spacing unit, radius, shadows, colours), with references followed (`primary  #f2a91b  via color-amber-500`) and framework defaults marked;
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

```bash
node bin/figma-ui-spec.js table --repo my-web-app --figma '<url>'
node bin/figma-ui-spec.js map --repo my-web-app --key <library key> --name Checkbox --to src/ui/Checkbox.tsx#Checkbox
```

`table` puts every value and component the design uses next to what the project's code has for it, with how often each is used:

- colours by library style or raw value: the token with that value, preferring palette names over aliases; a translucent colour as `token/opacity`;
- text: the typography component variant that matches exactly, else the utility classes that build it from theme tokens, with what the nearest variant gets wrong;
- shadows by effect style, gaps and padding as steps of the spacing unit, and corner radii;
- components: the code component already mapped with `map`, lucide or project icons for small icon components, and name-based suggestions for the rest.

Each row has a status: `same`, `renamed` (the value exists under another name), `classes` (no component variant, but tokens cover it), `differs` (the code has the name with another value), `off-scale` or `missing` (with the nearest option). `map` saves a decided component mapping to `.repos/<name>/component-map.json`, under the key the table shows: the Figma library key, or `name:<name>` for a component local to the design file, so the mapping still holds when it is copied to another file. An entry may also carry `props`, mapping Figma property values to code props.

```bash
node bin/figma-ui-spec.js spec --repo my-web-app --figma '<url>' --out docs/checkout --name checkout
node bin/figma-ui-spec.js decide --spec docs/checkout/checkout.json --conflict K3 --outcome local-override --by Sam
```

`spec` writes `<name>.json` and `<name>.md`: what to build for each state of each flow, in the project's own terms.

- **Flows and states.** Frames are grouped the way designers lay out a board: per section, split into bands by long divider lines, each band named by its top label. The label right above a frame names its state. A state whose labels say it shows today's UI (`CURRENT`, `OLD`, `EXISTING`, `BEFORE`, `LIVE`) is listed as a reference and not built. A section at any depth named like an earlier iteration (`Iteration`, `Exploration`, `Draft`, `WIP`, `Archive`, or only a version such as `v2`) is listed as superseded and not built either, unless a section inside it is named `Final`; a section named `Final` never is. Each superseded section is listed as a question, so nothing drops out unseen.
- **Trees.** Each state becomes a tree: `<Component> file#Export` with its props for mapped component instances, lucide icons for icon instances and `lucide/<name>` frames, typography as a component variant or classes, and the rest as markup with Tailwind classes for layout, sizing, colour, border, radius and shadow. Wrappers that add nothing are left out. Colours use the semantic alias the role makes unambiguous (`border` for strokes, `fg` for text, `bg` for fills), else the palette name.
- **Conflicts.** A value the code does not have gets an id (`K1`, `K2`…) and the default outcome `nearest`: the closest token or variant, with the exact alternative as the override. For a text whose nearest is a component variant of the same face, the override keeps the variant and adds only the classes that differ (`Body size=lg font-medium`). `decide` records another outcome (`local-override`, `new-variant`, `token-change`); the next `spec` run into the same folder keeps ids and decisions and builds the trees accordingly.
- **Questions** list missing empty, loading and error states, unmapped components with suggestions, design frames named like reference frames, sections beside a `Final` one that are not named as an iteration, headings that differ between the states of one flow (often a frame copied from another flow, which is named), and open designer comments. **Gaps** list names and values the design and the code disagree on; they also go into `.repos/<name>/design-system-gaps.md`, a running list for the designer.

```bash
node bin/figma-ui-spec.js guard --repo my-web-app --diff origin/main...HEAD
node bin/figma-ui-spec.js guard --repo my-web-app --paths src/ui/heading.tsx --after /tmp/heading.new.tsx --spec docs/checkout/checkout.json
```

`guard` lists changes to shared code that no decision allows, and exits 1 when there are any:

- each `@theme` variable a change adds, removes or gives another value, in the config's theme files;
- any other change to a file under `protectedPaths`, including a theme file changed outside its variables.

A `new-variant` decision allows a change to the file of the typography component its nearest option names (`Heading level=1` in `src/ui/heading.tsx`) when that variant is the only existing one that changes: added variants pass, while changes to other variants, and any change outside the variant tables (base classes, defaults, compound variants, render code, other exports), stay findings. So a variant whose props are typed from the cva definition (`VariantProps<typeof …>`) can be added without asking, but one that also needs a hand-written type or render code to change asks once, and a person confirms it. A `token-change` decision allows changes to the variables its nearest option reads (`border-gray-200` allows `--color-gray-200`, `Heading level=1` allows `--text-h1` and its `--text-h1--line-height`). Decisions come from `--spec`, else from every spec the config's `specs` globs find, and only from specs written for the same project; a spec that cannot be read is skipped and named in the output. A decision is not tied to a branch: it allows the same change on any branch for as long as its spec is found, so move a finished ticket's spec out of the `specs` globs (for example by archiving its folder). `--diff` takes `a...b` (b against where it left a), `a..b`, or one ref against the working tree, untracked files included; `--paths` names files about to change, with `--after` holding the new contents of one of them. Without the new contents a theme file change is always a finding, since the variables it touches are unknown.

`hook` is the same check as a [Claude Code PreToolUse hook](https://docs.claude.com/en/docs/claude-code/hooks) for `Write`, `Edit` and `MultiEdit`: it reads the tool call on stdin, works out the file's new contents, finds the project whose `root` holds the file (or a git worktree of it), and answers `ask` when the guard has findings. An edit whose result it cannot work out is checked by path, so a shared file still asks; a file outside the protected paths never reads the theme or the specs, so a person confirms the shared change. Anything else gets no answer and leaves the normal permission flow alone.

```json
{ "matcher": "Edit|Write|MultiEdit", "hooks": [{ "type": "command", "command": "node /path/to/figma-ui-spec/bin/figma-ui-spec.js hook" }] }
```

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
- `theme.fontFamilies`: family names for font variables set at runtime (for example by `next/font`), keyed by the token's name: `{ "karla": "Karla" }` for `--font-karla`.
- `typography`: typography components, each with its `component` name, the `file` holding its definition and the `cva` variable name.
- `protectedPaths`: globs of shared code that feature work must not change. A `!glob` takes back files the globs before it matched: `["src/ui/**", "!**/*.test.tsx"]`.
- `specs`: absolute globs of the specs whose decisions `guard` and `hook` apply when no `--spec` is given.
- `components.dirs`: folders whose exported PascalCase components are candidates for Figma components; `components.iconDirs`: the project's icon components; `components.lucide`: lucide's icon module folder, when the project uses lucide.
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
