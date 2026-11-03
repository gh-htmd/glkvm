# Foldable laptop mode (iPhone Duo split keyboard)

Split the KVM page into two halves, laptop-style, when a foldable phone
is held portrait and partially folded: the remote screen on top, a
touch keyboard below, with the split on the display crease.

## What it is

- **Fork:** `gh-htmd/glkvm`, branch `feature/iphone-duo-split-keyboard`
  (forked from `gl-inet/glkvm`, which is itself a PiKVM derivative).
- **Files:**
  - `web/share/js/kvm/fold.js` — detection + keyboard panel controller.
  - `web/share/css/kvm/fold.css` — split layout, scoped to
    `body.fold-laptop` so every other layout is untouched.
  - `web/kvm/window-fold.pug` — the panel markup (91 keys, no `<input>`).
  - `web/kvm/index.pug` / `web/kvm/index.html` — loads `kvm/fold.css`
    and the panel. The checked-in `index.html` was hand-synced to the
    pug (see "Regenerating the HTML" below); the pug is the source of
    truth.
  - `web/kvm/windows.pug` — includes the panel.
  - `web/kvm/navbar-system.pug` — System → Web UI settings switches.
  - `web/share/js/kvm/hid.js` — adds `Hid.emitKey(code, state)`.
  - `web/share/js/kvm/session.js` — constructs `FoldSplit` after `Hid`.
- **No backend change.** Every key goes through the existing path:
  `FoldSplit` → `Hid.emitKey()` → `Keyboard.emit()` →
  `Keypad.emitByCode()` → `Keyboard.__sendKey()` → the same WebSocket
  HID event (`{event_type: "key", event: {key, state}}`) a physical
  keyboard or the built-in on-screen keyboard sends. The panel only
  works for codes the built-in `#keyboard-window` keypad already knows
  (verified: all 91 panel codes are present there); it cannot invent a
  new HID code. The built-in keyboard window stays in the DOM in split
  mode (hidden by CSS) precisely so that key map still exists.

## How detection works

In priority order (`detectFoldLayout()` in `fold.js`):

1. **Window Segments API** — `window.getWindowSegments()` reporting
   two vertically stacked segments → laptop layout.
2. **CSS fold posture** — `matchMedia("(screen-fold-posture: laptop)")`.
3. **iOS Safari heuristic** — an iPhone (not iPad) in portrait with
   viewport width ≥ 600 pt, height ≥ 850 pt, width/height in
   [0.58, 0.82]. That is the Duo's inner display held portrait
   (~669 × ~951 pt, fold at the centre, 475.5 pt — hence the 50/50
   split). Conventional iPhones (390–440 pt wide) fail the width test;
   the Duo's outer display (~466 × ~678 pt) fails it too; iPads fail
   the iPhone test.
4. **Manual override** — System → Web UI settings:
   - "Foldable laptop mode (split screen + keyboard)" (`fold.laptop`,
     stored in localStorage) forces the layout on any device. This is
     also how to test it on a desktop browser.
   - "Auto-detect foldable laptop layout" (`fold.auto`, default on)
     gates rules 1–3.

Re-evaluation happens on `resize`, `orientationchange`,
`visualViewport` resize, and fold-posture media changes (debounced
120 ms), so rotating or opening/closing the device reflows live
without a reload.

## The Safari limitation, stated plainly

**iOS Safari exposes no hinge angle, no fold posture, and no window
segments.** There is no web API on the Duo that can tell a
half-folded device from a fully-open one held in the same portrait
orientation — the viewport is the full inner display either way.
So rule 3 is a *candidate* state, not proof of a fold:

- On a Duo in inner portrait, auto mode will show the split layout
  even if the device is fully open. That is the documented trade-off,
  not a bug in the detection.
- The toolbar's **Exit** button is always one tap away. Exiting an
  auto-activated layout suppresses only the current viewport class
  for this session; opening/closing the device (a class change) or a
  reload re-arms auto-detection. Exiting a manually-forced layout
  turns the manual switch off (persisted).
- If you want certainty instead of the heuristic, turn auto-detect off
  and use the manual switch, or open the page with the layout forced
  on — the switch is the reliable control Safari allows.

## Keyboard behaviour

- Full rows: Esc + F1–F12 (or, via the **Nav** button, Ins/Home/PgUp/
  Del/End/PgDn/Pt-Sq/ScrLk/P/Brk + arrows), numbers, QWERTY, Caps +
  Enter row, Shift row, and Ctrl/Win/Alt/Space/Menu/Ctrl + arrows.
  That covers standard keys, Ctrl/Alt/Shift/Meta, function keys, and
  Esc/Tab/Enter/Backspace, plus arrows and navigation keys.
- **Sticky modifiers** (the touch-keyboard problem, solved without
  chords): tap Shift/Ctrl/Alt/Win once and it stays down for the next
  key, then releases automatically. Tap twice quickly (≤ 350 ms) and
  it locks down until tapped again. Latched keys are amber, locked
  keys green.
- **No native keyboard:** the panel contains no `<input>` or
  contenteditable element, keys are `tabindex="-1"` buttons handled
  with pointer events + `preventDefault`, so Safari's keyboard never
  opens and the panel never steals focus from the page.
- **Mouse/touch on the stream is untouched:** the panel is a separate
  element below `#stream-box`; the stream's own mouse/touch handlers
  are not modified, and in split mode the stream's header, info line,
  and on-stream mouse buttons are hidden so the top half is pure
  remote screen. A tap on the keyboard cannot reach the remote mouse.
- **Stuck keys:** leaving the page, hiding it, or exiting split mode
  releases every latched/locked modifier. `Hid` also releases all keys
  on blur, as before.

## Layout notes

- Split is exactly 50/50 (`50dvh` each, `dvh` so Safari's collapsing
  chrome doesn't leave a gap or push the keyboard off-screen). The
  Duo's fold is at the centre of the inner display, so 50% *is* the
  crease; a dark 8 px hinge strip marks it.
- `fold.css` uses `!important` on `#stream-window` geometry because
  `wm.organizeWindow()` sets inline top/width/height on that window;
  the window manager itself is not modified, and when the mode is off
  no fold rule applies (the panel defaults to `display: none`).
- Safe-area insets are honoured at the bottom of the panel.

## Testing

- **Unit (Node, no browser):** `detectFoldLayout()` and the full
  `FoldSplit` key/modifier state machine are tested by a throwaway
  harness (fake DOM + fake emit callback) covering: stacked vs
  side-by-side segments, posture, Duo-inner vs conventional iPhone vs
  outer display vs iPad-like vs desktop, plain key press/release,
  sticky Ctrl+C, double-tap lock, verbatim Esc/F1/Backspace/Enter/
  Tab/arrows, auto-activate → Exit → class-change re-arm, and
  Exit releasing a latched modifier. All cases pass. The harness is
  not committed (it lives outside the repo); the module is kept free
  of the `tools.js` dependency precisely so this kind of test stays
  possible.
- **Live browser:** not completed. The panel + CSS were served
  standalone for a Chromium check (manual mode forced on), but the
  managed browser could not load the page at all: first it refused
  loopback navigation (127.0.0.1/localhost) outright, then a second
  attempt against the VM's non-loopback address also failed, and
  even opening a blank tab produced no usable tab — the failure is
  in the browser environment, not the demo server (which answers
  normally to direct requests). Until a live-browser run reports
  split halves, the Shift+A sticky sequence, and Exit against the
  emit log, treat those as covered only by the Node harness above,
  not by a rendered page.
- **Regression scope:** with the mode off, the only changes on the
  KVM page are an inert hidden panel, two extra System-menu switches
  (default off / on for auto-detect, which only activates on a fold
  signal or the Duo-inner heuristic), and a 9-line `Hid.emitKey`
  passthrough. No Python/backend file was touched.
- **Not yet verified on hardware:** a real iPhone Duo and a real
  GLKVM device were not available here. Before shipping, check on
  the device: (1) inner-portrait viewport really lands in the
  heuristic band after Safari chrome is subtracted, (2) the 50%
  split lines up with the physical crease, (3) a full session
  (login → stream → keys → mouse) works end to end, and (4) exiting
  returns to the normal mobile layout.

## Deploying to a GLKVM device

This repo is the KVMD source, not a firmware image: nothing here can
build the device's signed `update.img`, and the device's built-in
Upgrade UI (which fetches official firmware from
`fw.gl-inet.com` and verifies its signature in
`kvmd/apps/kvmd/api/upgrade.py`) will not install a custom release.
What the GitHub release ships instead is a **webapp-only patch
tarball** (the changed files under `web/` plus
`scripts/install-webapp-update.sh` as `install.sh`), because this
feature touches only static web files.

On the device, as root, from the extracted tarball:

```
./install.sh
```

The script backs the whole served web tree up first (printing the
backup path), copies the five changed files together into
`/usr/share/kvmd/web`, verifies them, and finishes — no restart
needed, just reload the KVM page and check System → Web UI settings
for the two new switches. If `/usr/share/kvmd/web` is not writable,
remount it read-write first (see your `mount` output for which
filesystem holds it); if the path itself differs on your firmware,
re-run with `WEB_ROOT=<actual path> ./install.sh`.

Do not use `apply_to_glkvm.sh` for this: it syncs only the Python
`kvmd/` package (deleting the target first) and never touches `web/`.

## Regenerating the HTML

`make pug` in upstream uses the testenv container's pug version.
Regenerating `web/kvm/index.html` with a current local `pug-cli`
rewrites unrelated sections (it drops a hand-maintained venc-mode row
and reformats other menus), so the checked-in HTML in this branch
was instead hand-synced to the pug changes (CSS link, two switches,
fold panel — 37 added lines, nothing else). If you regenerate with
the testenv pug, diff it and keep only the fold additions.
