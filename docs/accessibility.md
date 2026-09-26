# Accessibility

Every route in this application is audited against WCAG 2.2 Level AA with axe-core, in
both themes, in CI, and any violation fails the build. There is no allow-list, no severity
floor and no baseline file. This document says what that gate does check, what it cannot,
and what turning it on the first time found — because the last of those is the argument
for the first two.

## Running it

```bash
pnpm e2e:a11y            # the whole audit
pnpm e2e:a11y --headed   # watch it drive the pages
```

It starts `ng serve` through Playwright's `webServer`, so no separate terminal is needed.
The CI job is `Accessibility (WCAG 2.2 AA)`; on failure it uploads the Playwright report as
the `a11y-report` artifact.

## Why it is an end-to-end gate and not a unit test

There is a well-known pattern of calling `axe.run()` on a `TestBed` fixture, one spec per
component. It is cheap and it catches a real class of bug — a missing `alt`, a button with
no accessible name — and it is not enough here, because more than half of what axe checks
is a property of the **page**:

- **Contrast** needs the cascade. The colour of a label is a token on `:root`, overridden
  by `.dark`, read through a Tailwind arbitrary value, painted over whatever background the
  nearest positioned ancestor happens to have. A fixture has the component and none of the
  four.
- **Landmarks and heading level** are questions about the document. `region`,
  `landmark-one-main` and `page-has-heading-one` are answered jointly by
  `LayoutShellComponent`, the routed page, and the toast container that `AppComponent`
  renders as a sibling of `<router-outlet>`. No single component knows.
- **`target-size`** needs layout. A fixture has no viewport.

So the audit drives the real application, signed in, with the backend mocked, and asks axe
about the document that results.

## What is audited

Eight routes — `/login`, `/register`, `/unauthorized`, `/dashboard`,
`/dashboard/posts`, `/dashboard/posts/:id`, `/dashboard/activity`, `/admin` — **in both
themes**, plus four states that only exist after an interaction:

| State                                | Why it is separate                                           |
| ------------------------------------ | ------------------------------------------------------------ |
| Login form showing validation errors | Error text, `aria-invalid` and `aria-describedby` only exist once a field is invalid |
| Mobile drawer open                   | An off-canvas dialog-ish surface that the desktop render has no equivalent of |
| Typeahead with results               | The `listbox`, its `option`s and `aria-activedescendant` exist only while open |
| Dashboard with its `@defer` panels resolved | A definition list, an avatar per row, and a dismissible card that the resting page does not have |

Both themes is the important half. Three of the contrast failures below existed **only** in
dark mode, and the application had shipped with them for the whole of Phases 1–9.

## What it found

The first green run needed six fixes. None of them was cosmetic and none was caught by
1,059 unit tests, a typecheck, a lint run, a bundle-budget gate or an SSR gate.

**Tailwind's `dark:` variant was never connected to the theme toggle.** Tailwind 4 compiles
`dark:` to `@media (prefers-color-scheme: dark)` unless told otherwise, and `ThemeService`
switches on a `.dark` class. So the toggle rewrote the custom properties in `styles.css`
and left every `dark:bg-*` / `dark:text-*` utility in every template inert. The auth card
stayed `bg-white` while `--color-foreground` went to `oklch(0.93 0 0)` — near-white body
text on a white card, 1.06:1, on the two most-visited routes in the application. The fix is
one line, `@custom-variant dark (&:where(.dark, .dark *))`. The reason it survived this long
is that nothing in the repository looked at dark mode: the unit suite never sets the class,
and a human reviewer toggling the theme on a machine whose OS was also dark would have seen
it work.

**`--color-primary` failed AA as a brand colour.** At `oklch(0.55 0.18 240)` it was 4.27:1
under `--color-primary-foreground` (every primary button) and 4.05:1 as link text on
`--color-muted` (every active nav item). `0.50` clears 4.5:1 in all three placements the
application uses.

**`--color-primary-foreground` was wrong in dark mode.** Dark mode makes the primary the
*lighter* of the pair, so the near-white foreground the light palette uses sat at 2.90:1 on
every primary surface. It is now the light palette's `--color-foreground`, at 6.42:1.

**The toast container had a prohibited ARIA attribute and was outside every landmark.**
`<div aria-label="Notifications">` — a name on a generic element attaches to no role and is
dropped, so the container was anonymous; and since it is a sibling of `<router-outlet>` at
the application root, every toast was content in no landmark. `role="region"` fixes both.

**Four routes had no `<main>`.** `/login`, `/register`, `/unauthorized` and `/admin` render
outside `LayoutShellComponent`, which is the only place in the application that provides
landmarks. The dashboard routes get theirs from the shell and must not add a second.

**`/dashboard` had no `<h1>`.** Its own title was an `<h2>`, while both sibling routes start
at `<h1>`.

## Rules of the gate

**The tag set is a union, not `['wcag22aa']`.** axe tags a rule with the WCAG version that
*introduced* it, so `color-contrast` is `wcag2aa` and stays that way in 2.2. Asking for
`wcag22aa` alone selects the rules 2.2 added — one rule — and audits nothing else.

**`target-size` has to be switched on explicitly.** It is the only rule 2.2 AA adds, and
axe ships it `enabled: false`. A gate that passes `wcag22aa` to `withTags()` and stops there
selects it and then never runs it: the suite says WCAG 2.2 and audits WCAG 2.1.
`e2e/a11y/axe.spec.ts` asserts that the override still switches a rule from off to on, so a
future axe release enabling it by default is a failing test rather than a silent no-op.

**`AxeBuilder#options` replaces the options object.** It does not merge, so
`.withTags(TAGS).options({ rules })` — the spelling every example uses — throws the tag
filter away and runs axe's entire catalogue, `best-practice` included. That version of this
gate reported `heading-order`, which carries no WCAG tag at all, as a WCAG 2.2 AA violation.
Both go through one `options()` call, and a test asserts a best-practice-only violation
comes back clean.

**`best-practice` is deliberately excluded.** It is axe's advice, not a success criterion,
and a zero-violation gate has to be a gate on a published standard or the next axe release
moves the goalposts on a green branch. `region` and `page-has-heading-one` are enforced
here because they carry WCAG tags as well, not because axe recommends them.

**`incomplete` does not fail the build.** Those are the checks axe could not decide — a
colour over a gradient, a target whose neighbours overlap. Failing on them would make the
gate non-deterministic on exactly the elements it is least sure about.

**No threshold.** An `impact: 'minor'` violation is a failed success criterion. A severity
floor is the mechanism by which an accessibility gate becomes a number nobody looks at.

## What it does not cover

Worth stating plainly, because a green gate reads like more than it is. axe finds roughly
a third of WCAG issues by count and cannot find any of the following:

- **The prerendered HTML.** The audit runs against the hydrated, client-rendered DOM —
  the document a visitor interacts with, and the one that differs between themes. It is not
  the static HTML that `/login`, `/register` and `/unauthorized` are served as before
  hydration. `scripts/ci/assert-ssr.mjs` reads that.
- **Keyboard operability and focus order.** Whether the drawer traps focus, whether Escape
  returns it, whether a route change moves it anywhere sensible. That is the next item in
  `SPEC.md` Phase 9 and it needs assertions, not a scanner.
- **Anything about meaning.** Whether an `alt` describes the image, whether a label names
  the field, whether an error message helps. axe checks that a name exists.
- **`DialogComponent`.** It is reachable from no route today, so the audit never renders it.
  When a route opens one, it needs a state in `e2e/a11y/a11y.spec.ts`.
- **Zoom, reflow at 320px, and motion.** 1.4.10 and 2.3.3 are not axe rules.

## Adding to it

A new route goes in the `ROUTES` table in `e2e/a11y/a11y.spec.ts` and is audited in both
themes automatically. A new interaction state goes in the `interaction states` block: get
the state on screen with ordinary Playwright, then call `expectNoViolations(page, label)`.

When a violation is genuinely wrong — axe does have false positives — the answer is not an
allow-list. Fix the markup so the rule is satisfied, or, if the rule really cannot apply,
disable it *at the element* with an explanatory comment, so the exemption is next to the
thing it exempts and shows up in a diff.
