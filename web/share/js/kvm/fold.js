/*****************************************************************************
#                                                                            #
#    KVMD - The main PiKVM daemon.                                           #
#                                                                            #
#    Copyright (C) 2018-2024  Maxim Devaev <mdevaev@gmail.com>               #
#                                                                            #
#    This program is free software: you can redistribute it and/or modify    #
#    it under the terms of the GNU General Public License as published by    #
#    the Free Software Foundation, either version 3 of the License, or       #
#    (at your option) any later version.                                     #
#                                                                            #
#    This program is distributed in the hope that it will be useful,         #
#    but WITHOUT ANY WARRANTY; without even the implied warranty of          #
#    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the           #
#    GNU General Public License for more details.                            #
#                                                                            #
#    You should have received a copy of the GNU General Public License       #
#    along with this program.  If not, see <https://www.gnu.org/licenses/>.  #
#                                                                            #
*****************************************************************************/

/*
 * Foldable "laptop mode" for the iPhone Duo (and any foldable with a
 * fold-posture API).
 *
 * What this module does, and what it deliberately does NOT do:
 *
 *  - It reuses the existing HID path. Every key goes through
 *    Hid.emitKey() -> Keyboard.emit() -> Keypad.emitByCode() ->
 *    Keyboard.__sendKey(), which sends the exact same WebSocket HID event
 *    ({event_type: "key", event: {key: <code>, state: <bool>}}) as the
 *    built-in on-screen keyboard and a physical keyboard. No new protocol,
 *    no backend change, no separate KVM implementation.
 *  - It does NOT open a text field, so Safari's native keyboard never
 *    appears. Keys are <button> elements handled with pointer events.
 *  - It does NOT touch the stream: taps on this panel never reach
 *    #stream-box, because the panel is a separate element below it, and
 *    the stream keeps its own mouse/touch handlers untouched.
 *
 * Detection, in priority order (see docs/foldable-laptop-mode.md for the
 * full Safari story):
 *  1. Window Segments API (window.getWindowSegments) reporting two
 *     vertically stacked segments -> laptop posture.
 *  2. CSS fold posture: matchMedia("(screen-fold-posture: laptop)").
 *  3. iOS Safari fallback heuristic: an iPhone (not iPad) in portrait whose
 *     viewport is the Duo's inner display held portrait (~669 x ~951 pt,
 *     fold at the centre): width >= 600, height >= 850, width/height in
 *     [0.58, 0.82]. Conventional iPhones are 390-440 pt wide and fail the
 *     width test; iPads fail the iPhone test. This heuristic cannot tell
 *     a half-folded Duo from a fully-open one in portrait -- Safari
 *     exposes no hinge angle -- so it is a candidate state, not proof of
 *     a fold, and the toolbar's Exit button is always one tap away.
 *  4. Manual override: the "Foldable laptop mode" switch in
 *     System -> Web UI settings forces the layout on any device (this is
 *     also how you test it on a desktop browser), and "Auto-detect"
 *     (default on) gates rules 1-3.
 *
 * The module is intentionally free of the tools.js dependency so that
 * detectFoldLayout() can be unit-tested in plain Node (see the test
 * harness in docs/foldable-laptop-mode.md).
 */


"use strict";


// Codes that behave as sticky modifiers on a touch keyboard: one tap
// latches them (they stay down for the next key), a second tap within
// 350 ms locks them (they stay down until tapped again).
export const FOLD_MODIFIERS = [
	"ShiftLeft", "ShiftRight",
	"ControlLeft", "ControlRight",
	"AltLeft", "AltRight",
	"MetaLeft", "MetaRight",
];

const STORAGE_MANUAL = "fold.laptop";
const STORAGE_AUTO = "fold.auto";
const LOCK_WINDOW_MS = 350;
const RESIZE_DEBOUNCE_MS = 120;


// Pure function: no DOM access, safe to test in Node.
// env: {width, height, segments, posture, isIPhone}
// segments: [{top, bottom, left, right, width, height}] or null.
// Returns {active, reason, cls}; cls is the stable viewport class used
// to expire a session-only Exit suppression when the class changes.
export function detectFoldLayout(env) {
	let width = env.width || 0;
	let height = env.height || 0;

	if (Array.isArray(env.segments) && env.segments.length >= 2) {
		let segs = env.segments.slice().sort((a, b) => a.top - b.top);
		let top = segs[0];
		let bottom = segs[1];
		let stacked = (
			Math.abs(top.bottom - bottom.top) <= 4
			&& Math.abs(top.left - bottom.left) <= 4
			&& Math.abs(top.width - bottom.width) <= 4
		);
		if (stacked) {
			return {"active": true, "reason": "window-segments", "cls": "fold-api"};
		}
		return {"active": false, "reason": "window-segments-side-by-side", "cls": "fold-api"};
	}

	if (env.posture === "laptop") {
		return {"active": true, "reason": "screen-fold-posture", "cls": "fold-api"};
	}

	// iPhone Duo inner display, held portrait (hinge horizontal, fold at
	// the centre): ~669 pt wide, ~951 pt tall, ratio ~0.70.
	if (
		env.isIPhone
		&& height > width
		&& width >= 600
		&& height >= 850
		&& (width / height) >= 0.58
		&& (width / height) <= 0.82
	) {
		return {"active": true, "reason": "duo-inner-portrait", "cls": "duo-inner"};
	}

	return {"active": false, "reason": "no-fold-signal", "cls": "none"};
}


export function FoldSplit(__emitKey, __doc=null, __win=null) {
	var self = this;

	/************************************************************************/

	var __doc_el = (__doc || document);
	var __win_el = (__win || window);

	var __panel = null;
	var __exit_btn = null;
	var __nav_btn = null;
	var __fn_row = null;
	var __nav_row = null;

	var __active = false;
	var __suppressed_cls = null; // Session-only Exit; cleared on class change.
	var __latched = {}; // code -> true while held for the next key
	var __locked = {}; // code -> true while locked by double-tap
	var __latch_time = {}; // code -> timestamp of the latch tap
	var __pressed = {}; // code -> button currently held down (normal keys)
	var __resize_timer = null;

	var __storageGet = function(key, fallback) {
		try {
			let value = __win_el.localStorage.getItem(key);
			return (value === null ? fallback : value);
		} catch {
			return fallback;
		}
	};

	var __storageSet = function(key, value) {
		try {
			__win_el.localStorage.setItem(key, value);
		} catch {
			// Private mode etc: layout still works for this session.
		}
	};

	var __isManual = function() {
		return (__storageGet(STORAGE_MANUAL, "0") === "1");
	};

	var __isAuto = function() {
		return (__storageGet(STORAGE_AUTO, "1") !== "0");
	};

	var __readViewport = function() {
		let segments = null;
		try {
			if (typeof __win_el.getWindowSegments === "function") {
				segments = __win_el.getWindowSegments();
			}
		} catch {
			segments = null;
		}
		let posture = null;
		try {
			if (__win_el.matchMedia && __win_el.matchMedia("(screen-fold-posture: laptop)").matches) {
				posture = "laptop";
			}
		} catch {
			posture = null;
		}
		// iPhone, not iPad: iPads share the wide-portrait ratio but are a
		// different device class, and Duo Safari reports an iPhone UA.
		let ua = (__win_el.navigator ? __win_el.navigator.userAgent : "");
		let is_iphone = (/iPhone/.test(ua) && !/iPad/.test(ua));
		return {
			"width": __win_el.innerWidth || 0,
			"height": __win_el.innerHeight || 0,
			"segments": segments,
			"posture": posture,
			"isIPhone": is_iphone,
		};
	};

	/************************************************************************/

	self.isActive = function() {
		return __active;
	};

	// Manual override, also used by the System-menu switch.
	self.setManual = function(enabled) {
		__storageSet(STORAGE_MANUAL, (enabled ? "1" : "0"));
		__evaluate();
	};

	self.setAuto = function(enabled) {
		__storageSet(STORAGE_AUTO, (enabled ? "1" : "0"));
		__evaluate();
	};

	// One-tap exit from the toolbar. If the layout was forced manually,
	// this turns the manual switch off (persisted). Otherwise it only
	// suppresses the current viewport class for this session: opening or
	// closing the device (a class change) re-arms auto-detection.
	self.exit = function() {
		__releaseAllModifiers();
		if (__isManual()) {
			self.setManual(false);
			let el_switch = __doc_el.getElementById("fold-laptop-switch");
			if (el_switch) {
				el_switch.checked = false;
			}
		} else {
			__suppressed_cls = detectFoldLayout(__readViewport()).cls;
			__evaluate();
		}
	};

	var __evaluate = function() {
		let detected = detectFoldLayout(__readViewport());
		if (detected.cls !== __suppressed_cls) {
			__suppressed_cls = null;
		}
		let want = false;
		let reason = detected.reason;
		if (__isManual()) {
			want = true;
			reason = "manual";
		} else if (__isAuto() && detected.active && __suppressed_cls === null) {
			want = true;
		}
		if (want !== __active) {
			__active = want;
			if (!__active) {
				__releaseAllModifiers();
			}
			__apply();
		}
		if (__panel) {
			__panel.setAttribute("data-fold-reason", reason);
		}
	};

	var __apply = function() {
		__doc_el.body.classList.toggle("fold-laptop", __active);
		// wm.organizeWindow() may set inline top/width/height on the
		// stream window; fold.css wins over those with !important, so
		// no inline-style surgery is needed here, and leaving the
		// window manager alone keeps desktop behaviour untouched.
	};

	var __emit = function(code, state) {
		if (typeof __emitKey === "function") {
			try {
				__emitKey(code, state);
			} catch {
				// HID not ready (socket down etc.): drop, don't crash UI.
			}
		}
	};

	var __releaseAllModifiers = function() {
		for (let code of FOLD_MODIFIERS) {
			if (__latched[code] || __locked[code]) {
				__emit(code, false);
			}
			delete __latched[code];
			delete __locked[code];
			delete __latch_time[code];
		}
		__refreshModifierVisuals();
	};

	var __refreshModifierVisuals = function() {
		if (!__panel) {
			return;
		}
		for (let el of __panel.querySelectorAll("[data-fold-code]")) {
			let code = el.getAttribute("data-fold-code");
			if (FOLD_MODIFIERS.includes(code)) {
				el.classList.toggle("latched", !!__latched[code] && !__locked[code]);
				el.classList.toggle("locked", !!__locked[code]);
			}
		}
	};

	var __releaseLatchedAfterKey = function() {
		let changed = false;
		for (let code of FOLD_MODIFIERS) {
			if (__latched[code] && !__locked[code]) {
				__emit(code, false);
				delete __latched[code];
				delete __latch_time[code];
				changed = true;
			}
		}
		if (changed) {
			__refreshModifierVisuals();
		}
	};

	var __onModifierDown = function(el, code) {
		let now = Date.now();
		if (__locked[code]) {
			__emit(code, false);
			delete __locked[code];
			delete __latched[code];
			delete __latch_time[code];
		} else if (__latched[code]) {
			if (now - (__latch_time[code] || 0) <= LOCK_WINDOW_MS) {
				__locked[code] = true; // Second quick tap: lock, key stays down.
			} else {
				__emit(code, false);
				delete __latched[code];
				delete __latch_time[code];
			}
		} else {
			__emit(code, true);
			__latched[code] = true;
			__latch_time[code] = now;
		}
		__refreshModifierVisuals();
	};

	var __onKeyDown = function(el, code) {
		el.classList.add("pressed");
		if (FOLD_MODIFIERS.includes(code)) {
			__onModifierDown(el, code);
			return;
		}
		__pressed[code] = el;
		__emit(code, true);
	};

	var __onKeyUp = function(el, code) {
		el.classList.remove("pressed");
		if (FOLD_MODIFIERS.includes(code)) {
			return; // Modifiers are tap/latch, not hold: up does nothing.
		}
		if (__pressed[code]) {
			delete __pressed[code];
			__emit(code, false);
			__releaseLatchedAfterKey();
		}
	};

	var __bindKeys = function() {
		if (!__panel) {
			return;
		}
		for (let el of __panel.querySelectorAll("[data-fold-code]")) {
			let code = el.getAttribute("data-fold-code");
			el.tabIndex = -1; // Never take focus: no native keyboard, ever.
			el.addEventListener("pointerdown", function(ev) {
				ev.preventDefault();
				__onKeyDown(el, code);
			}, {"passive": false});
			for (let type of ["pointerup", "pointercancel", "pointerleave"]) {
				el.addEventListener(type, function() {
					__onKeyUp(el, code);
				});
			}
			// pointerdown's preventDefault already suppresses the
			// compatibility click, but belt-and-braces for Safari:
			el.addEventListener("click", function(ev) {
				ev.preventDefault();
			});
			el.addEventListener("contextmenu", function(ev) {
				ev.preventDefault();
			});
		}
	};

	var __init__ = function() {
		__panel = __doc_el.getElementById("fold-keyboard");
		__exit_btn = __doc_el.getElementById("fold-exit-button");
		__nav_btn = __doc_el.getElementById("fold-nav-button");
		__fn_row = __doc_el.getElementById("fold-row-fn");
		__nav_row = __doc_el.getElementById("fold-row-nav");
		if (!__panel) {
			return; // KVM page without the fold fragment: stay inert.
		}

		__bindKeys();

		if (__exit_btn) {
			__exit_btn.addEventListener("click", function(ev) {
				ev.preventDefault();
				self.exit();
			});
		}
		if (__nav_btn && __fn_row && __nav_row) {
			__nav_btn.addEventListener("click", function(ev) {
				ev.preventDefault();
				let show_nav = __fn_row.classList.contains("fold-row-visible");
				__fn_row.classList.toggle("fold-row-visible", !show_nav);
				__nav_row.classList.toggle("fold-row-visible", show_nav);
				__nav_btn.textContent = (show_nav ? "Fn" : "Nav");
				__nav_btn.setAttribute("aria-pressed", (show_nav ? "true" : "false"));
			});
		}

		// System-menu switches (System -> Web UI settings).
		let el_manual = __doc_el.getElementById("fold-laptop-switch");
		if (el_manual) {
			el_manual.checked = __isManual();
			el_manual.addEventListener("change", function() {
				self.setManual(el_manual.checked);
			});
		}
		let el_auto = __doc_el.getElementById("fold-auto-switch");
		if (el_auto) {
			el_auto.checked = __isAuto();
			el_auto.addEventListener("change", function() {
				self.setAuto(el_auto.checked);
			});
		}

		let schedule = function() {
			if (__resize_timer) {
				clearTimeout(__resize_timer);
			}
			__resize_timer = setTimeout(__evaluate, RESIZE_DEBOUNCE_MS);
		};
		__win_el.addEventListener("resize", schedule);
		__win_el.addEventListener("orientationchange", schedule);
		if (__win_el.visualViewport) {
			__win_el.visualViewport.addEventListener("resize", schedule);
		}
		try {
			let mq = __win_el.matchMedia("(screen-fold-posture: laptop)");
			if (mq && mq.addEventListener) {
				mq.addEventListener("change", schedule);
			}
		} catch {
			// matchMedia without fold support: the heuristic still applies.
		}
		// A hidden page must not leave keys held on the remote machine.
		// (Hid also releases on blur; this covers our tracked modifiers.)
		__doc_el.addEventListener("visibilitychange", function() {
			if (__doc_el.visibilityState === "hidden") {
				__releaseAllModifiers();
			}
		});
		__win_el.addEventListener("pagehide", __releaseAllModifiers);
		__win_el.addEventListener("blur", __releaseAllModifiers);

		__evaluate();
	};

	__init__();
}
