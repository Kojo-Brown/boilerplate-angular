# Focus management, live regions, and route-change announcements

A routed navigation is not a page load, and almost everything a browser does for free on a
page load it does not do for a navigation. This document is about the three things that go
missing, what was built to put them back, and — mostly — the ways each of those things can
be implemented, look correct, and still do nothing.

The WCAG audit in [`accessibility.md`](./accessibility.md) cannot catch any of it. axe
inspects a document at rest; every failure here is a property of the *transition* between
two documents, and a page that announces nothing and strands focus on a destroyed element
is, at rest, a page with no violations.

## What a page load does that a navigation does not

Click a link in a plain HTML document and the browser:

1. replaces the document, and hands the new one to the screen reader, which announces its
   title;
2. resets the virtual cursor and the sequential-focus starting point to the top;
3. moves focus out of the link that was clicked, because that link is gone.

Click a `routerLink` and none of it happens. The URL changes, the DOM under
`<router-outlet>` is swapped, the title is updated in the tab — and for a visitor who is
not looking at the screen, *nothing observable occurs at all*. Focus stays on the link,
which is then destroyed, so the next Tab restarts from the top of the document and the
visitor pays for the whole sidebar again on every navigation.

This is the single largest accessibility difference between a single-page application and
the pages it replaced, and it is invisible to every kind of test that does not name it.

## The pieces

| File | What it is |
| --- | --- |
| `core/a11y/live-region.component.ts` | One ARIA live region, rendered at bootstrap, populated later |
| `core/a11y/route-announcer.component.ts` | Says the name of the page after the router changes it |
| `core/a11y/route-focus.ts` | `provideRouteFocus()`, the target registry, and `[appRouteFocusTarget]` |
| `core/a11y/skip-link.component.ts` | SC 2.4.1, and the reason it does not follow its own `href` |
| `core/routing/title.strategy.ts` | Publishes the resolved route title *after* it is set |

`AppComponent` hosts the skip link and the announcer. Everything else is a provider or a
directive a route opts into.

## The four findings

Each of these is a way to ship this feature and have it do nothing. All four are pinned by
a spec rather than described in a comment and left to drift.

### 1. `NavigationEnd` is emitted before the title is updated

From `@angular/router`'s own bundle, in the tap that completes a navigation:

```js
this.events.next(new NavigationEnd(t.id, …));
this.titleStrategy?.updateTitle(t.targetRouterState.snapshot);
```

So the announcer everybody writes —

```ts
router.events.pipe(filter(e => e instanceof NavigationEnd))
  .subscribe(() => announcer.announce(title.getTitle()));   // wrong
```

— announces the title of the page the visitor has just **left**, on every navigation. What
makes it dangerous is how thoroughly it passes inspection: the navigation happened, an
announcement was made, the tab title is correct by the time anyone looks, and the only
person who can tell is the one who cannot see the screen.

`AppTitleStrategy.titleUpdated` is the same information emitted from the line *after*
`setTitle`, which makes the ordering a non-question rather than something to get right.
`title.strategy.spec.ts` asserts the ordering against the real router, and asserts the
consequence directly — that `Title.getTitle()` at `NavigationEnd` is the previous page's.
If a future Angular swaps those two lines, that spec fails, and this indirection can go.

It is an `Observable` and not a `Signal` because a navigation is an **event**. Two
navigations onto two rows of the same list are two events and one state, and a signal does
not notify when set to the value it already holds — so the second navigation would be
reported as nothing having happened. That visitor, moving between sibling rows, is
precisely who this exists for.

### 2. `useClass` would have built a second title strategy

`AppTitleStrategy` is `providedIn: 'root'`, so

```ts
{ provide: TitleStrategy, useClass: AppTitleStrategy }   // two instances
```

hands the router a *second* instance and leaves the root one — the instance the announcer
injects — subscribed to a stream nothing ever pushes to. The tab title stays correct,
because the router's copy is what sets it. Nothing throws, nothing logs, and the
announcer is silent forever. `useExisting` is the fix; `app.config.spec.ts` asserts the two
injections return the same object.

### 3. A live region has to exist before it has anything to say

A screen reader registers a live region as it enters the accessibility tree and watches it
from then on. An element created *and* populated in the same task is, to the reader, a
region that has always contained that text — and it announces nothing. This is why the
region is in `AppComponent`'s template, present and empty from the first paint, rather than
created on demand by the service that writes to it. It is also why it sits outside
`<router-outlet>`: it has to survive the navigation it is reporting on.

Two more, from the same family:

- **Hidden without being hidden.** `display: none`, `visibility: hidden`, the `hidden`
  attribute and `aria-hidden` each remove the element from the accessibility tree, which is
  the tree the announcement is read from. Every one of them makes the region invisible in
  the way that also means silent. `sr-only` is the clip-rect pattern precisely because it
  leaves the element rendered and exposed.
- **Repeating itself has to be possible.** Writing `'Post'` into a region that already
  reads `'Post'` is not a change and therefore not an announcement. Two mechanisms are
  needed and both are load-bearing: `Announcement` carries an id, so an identical string
  is still a new value and gets past `input()`'s equality check; and the component clears
  the region and writes 100 ms later, so the DOM sees two mutations rather than none.
  Both writes inside one change-detection cycle would render once, which is why the delay
  is a timer rather than a second `set`.

Announcements supersede rather than queue. Two arriving inside the delay mean the first
describes a page the visitor has already left, and reading both in order would report an
abandoned navigation as though it had completed.

### 4. `<main>` is not focusable, and a skip link that scrolls has not skipped anything

`element.focus()` on a `<main>` with no `tabindex` does nothing, silently. The only symptom
is focus staying where it was — which is indistinguishable from the feature never having
been added. `[appRouteFocusTarget]` supplies `tabindex="-1"` itself rather than trusting
every `<main>` in the application to remember it, and supplies the `id` the skip link
points at so the two cannot drift apart.

The skip link keeps its `href="#main-content"`, because that is what makes it a link: it is
announced as one, `Enter` activates it, and on the prerendered routes it works before any
JavaScript has loaded. But the click is handled rather than followed, for two reasons. The
fragment would go into the URL and stay there, to be carried into the next `routerLink`
navigation. And a native fragment jump moves the **scroll position** and the
sequential-navigation starting point without moving **focus** — so the next Tab continues
from the sidebar the visitor was trying to skip. That is the classic skip link that skips
nothing, and to anyone watching the page scroll it looks like it works.

Focus rings are left to `:focus-visible`. A `tabindex="-1"` container focused
programmatically does not match `:focus-visible` in any current browser, so nothing is
drawn for a route change, while a visitor who arrives via the skip link by keyboard does
match and does get a ring. Suppressing `:focus` outright would take the ring away from that
second case too, which is a 2.4.7 failure.

## When focus does *not* move

Two cases, both pinned:

- **The first navigation.** On load the browser has already put focus at the top of the
  document, and a visitor who arrived on a URL with a fragment has been taken to it.
  Stealing focus back to `<main>` undoes both — and under hydration it does so a beat
  *after* the page looked settled. `skip(1)` on the router's own navigations rather than a
  timer is what makes this correct for a prerendered route, whose first client-side
  navigation resolves to the route it was already showing.
- **A fragment-only change.** `#section-2` on the current page is a navigation as far as
  the router is concerned and emits `NavigationEnd`, but the page did not change, and
  moving focus to `<main>` would move it away from the thing the visitor just asked to be
  taken to. Comparing the URLs with their fragments stripped is what tells the two apart.

And the timing: focus moves in `afterNextRender`, not on the event. The incoming
component's view is created during activation, but its DOM is written in the
change-detection pass that *follows* the navigation — so on `NavigationEnd` the new
`<main>` may not have registered yet, and focusing then focuses the outgoing page's target
a moment before it is destroyed, which sends focus to `<body>`. `afterNextRender` also has
no server-side counterpart, which is the whole of this provider's platform handling.

## The registry, and why it is not a `querySelector`

There is no single element to look for. The dashboard routes get their `<main>` from
`LayoutShellComponent`; `/login`, `/register`, `/unauthorized` and `/admin` render outside
the shell and each provide their own. Whichever is currently mounted registers itself, so
"no target at all" is a fact the service knows rather than a `null` some caller has to
interpret — and it warns, in development, naming the URL and the directive.

De-registration checks that the element leaving is still the current one. Angular creates
the incoming component's view *before* destroying the outgoing one, so the new `<main>`
registers and then the old one is destroyed; an unconditional de-registration would empty
the registry at exactly the moment it is about to be read.

## The bug this found

`LayoutShellComponent`'s sidebar is an off-canvas drawer on a narrow viewport, closed with
`-translate-x-full`. Moved off screen — and still rendered, still in the tab order, still in
the accessibility tree. Every navigation link in it was reachable by Tab and readable by a
screen reader while being invisible, with the focus ring scrolled off the side of the
document and nothing on screen changing to say where the visitor was.

`inert` is the one attribute that removes an element from both the tab order and the
accessibility tree at once. `aria-hidden` alone would have left it tabbable; `display: none`
would have killed the slide-in transition the drawer exists to have. It is applied only in
the browser and only below the breakpoint: `mediaQuerySignal` reports its fallback rather
than a measurement on the server, and prerendering the drawer inert would hide the
navigation from a visitor whose JavaScript has not arrived.

1,059 unit specs, a zero-violation WCAG 2.2 AA gate over eight routes in two themes, and
four interaction-state audits all passed with this live.

## What is not asserted

**What the screen reader actually said.** No browser exposes it, and no Playwright API can
reach it. The closest honest claim is the one assistive technology acts on — that a
correctly configured live region's text changed — so that is what
`e2e/a11y/focus-and-announcements.spec.ts` asserts, at the DOM level, including the empty
state in between that makes a repeat a change. Verifying the announcement itself is a
manual pass with VoiceOver or NVDA, and it is not a CI gate here.

**Focus inside a dialog.** `@angular/cdk/dialog` brings its own focus trap and restores
focus to the opener on close, which is why there is nothing here about it. The toast
container is deliberately not a live region either — each toast carries `role="status"` and
announces through `LiveAnnouncer`; a second region around them would nest inside that one
and double every announcement. See the comment on `ToastContainerComponent`.

**`LiveAnnouncer` for route changes.** The CDK's announcer keeps one shared element and one
pending timeout for the whole application, so two announcements within its 100 ms window
leave only the second — and the first `announce()`'s promise still resolves, as though it
had been spoken. A toast raised by a guard or a resolver during a navigation is exactly that
collision. Route announcements therefore own their own region, and toasts keep the CDK's.
