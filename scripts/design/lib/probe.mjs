/* Browser-side helpers. Playwright serialises these functions and runs them in the page, so each
 * one has to be self-contained: it may not close over anything in this module or this repository.
 * What a function needs from here is handed to it as an argument. */

/** A colour as a computed value spells it: rgb(), rgba() or color(), whatever the source wrote. */
export const COLOUR = String.raw`(?:rgba?|color)\([^()]*\)`;

/** Every colour written in one computed value: a shadow list, a gradient, a filter. */
export function coloursIn(value) {
  return String(value).match(new RegExp(COLOUR, "g")) ?? [];
}

/** Every colour the --pk-* tokens hold, per surface scope on this page.
 *
 *  A token that is a colour is painted onto a probe and read back as the browser resolves it, so
 *  `#0b0d1a` and `rgb(11, 13, 26)` are one value. A token that is not a colour but contains some —
 *  a whole shadow — has each of its colours painted the same way, so a rule that reads the shadow
 *  token paints colours the palette holds. Scope 0 is the page; every `[data-surface]` follows. */
export function resolveTokens() {
  const names = new Set();
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) {
        walk(rule.cssRules);
      }
      for (const property of rule.style ?? []) {
        if (property.startsWith("--pk-")) {
          names.add(property);
        }
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      continue; // cross-origin sheet, nothing to read
    }
  }

  const SENTINEL = "rgb(1, 2, 3)";
  const scopes = [document.body, ...document.querySelectorAll("[data-surface]")];
  const values = scopes.map((scope) => {
    const held = new Set();
    const host = document.createElement("div");
    host.style.color = SENTINEL;
    const probe = document.createElement("div");
    host.append(probe);
    scope.append(host);
    const paint = (text) => {
      probe.style.color = "";
      probe.style.color = text;
      const painted = getComputedStyle(probe).color;
      if (painted !== SENTINEL) {
        held.add(painted);
      }
      return painted !== SENTINEL;
    };
    for (const name of names) {
      if (paint(`var(${name})`)) {
        continue;
      }
      const written = getComputedStyle(probe).getPropertyValue(name);
      for (const colour of written.match(/#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|color)\([^()]*\)/gi) ??
        []) {
        paint(colour);
      }
    }
    host.remove();
    return [...held];
  });
  return { names: [...names], values };
}

/** Every colour this page paints, with the scope whose tokens it has to come from.
 *
 *  Ink, ground and edges, and also what the first version never read: gradients, shadows, text
 *  shadows, drop-shadows, outlines and SVG paint. A night sky is a `background-image` and a glow is
 *  a `box-shadow`, so a check that reads neither passes both.
 *
 *  Not read: `::before` and `::after`, which have no element to ask, and what a canvas draws. */
export function paintedColours(pattern) {
  const scopes = [document.body, ...document.querySelectorAll("[data-surface]")];
  const scopeOf = (el) => {
    const owner = el.closest("[data-surface]");
    return owner ? scopes.indexOf(owner) : 0;
  };
  // `pattern` is COLOUR above, handed in because nothing here can reach the module.
  const colours = (value) => String(value).match(new RegExp(pattern, "g")) ?? [];
  const name = (node) =>
    node.tagName.toLowerCase() +
    (node.id ? `#${node.id}` : "") +
    (node.classList.length ? `.${node.classList[0]}` : "");
  const painted = [];
  for (const el of document.querySelectorAll("body *")) {
    // The Next dev overlay is not this product's design, and it is not on the deployed page.
    if (el.closest("nextjs-portal") || el.tagName.toLowerCase() === "nextjs-portal") {
      continue;
    }
    // A third party's mark keeps its own colours; recolouring a logo is not ours to do.
    if (el.closest("[data-third-party-mark]")) {
      continue;
    }
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      continue;
    }
    const style = getComputedStyle(el);
    const selector = name(el);
    const scope = scopeOf(el);
    const say = (value, role) => painted.push({ value, selector, role, scope });
    if (!style.backgroundColor.endsWith(", 0)")) {
      say(style.backgroundColor, "background");
    }
    const carriesText = [...el.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0,
    );
    if (carriesText) {
      say(style.color, "text");
      for (const colour of colours(style.textShadow)) {
        say(colour, "text-shadow");
      }
    }
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      // An edge with no width paints nothing, and its colour defaults to currentColor, so reading
      // it would invent a border on every element on the page.
      if (parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== "none") {
        say(style[`border${side}Color`], "border");
      }
    }
    for (const colour of colours(style.backgroundImage)) {
      say(colour, "background-image");
    }
    for (const colour of colours(style.boxShadow)) {
      say(colour, "box-shadow");
    }
    for (const colour of colours(style.filter)) {
      say(colour, "filter");
    }
    if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
      say(style.outlineColor, "outline");
    }
    if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) {
      for (const [property, role] of [
        ["fill", "fill"],
        ["stroke", "stroke"],
      ]) {
        for (const colour of colours(style[property])) {
          say(colour, role);
        }
      }
    }
  }
  return painted;
}

/** The ground this page paints, and whether the one block that must invert actually does.
 *
 *  `mustNest` is a selector for the specific element, not a boolean. It used to be a boolean, and
 *  the check looked for the first inverting pair anywhere in the document — which on every light
 *  route is the shell's inverted "Create agent" action in the nav. So the portfolio's dark total
 *  panel was rebuilt with `background: #0b0d1a; color: #fff` and no `data-surface` at all, and the
 *  check stayed green: it reported that the portfolio inverts, when what inverted was the nav. An
 *  assertion satisfied by a different element than the one it names is worse than no assertion,
 *  because it is believed. */
export function surfaces(mustNest) {
  const painted = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const colour = getComputedStyle(node).backgroundColor;
      if (!colour.endsWith(", 0)")) {
        return colour;
      }
    }
    return "rgb(255, 255, 255)";
  };
  const bg = (el) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--pk-bg)";
    el.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  };
  const name = (node) =>
    node.tagName.toLowerCase() +
    (node.id ? `#${node.id}` : "") +
    (node.classList.length ? `.${node.classList[0]}` : "");

  // A surface is a property of a subtree, not of <html>: /studio leaves <body> on the light
  // default and paints its ground on <main data-surface="dark">. So the ground of a screen is the
  // deepest element still covering the whole viewport — which is what the eye reads as the page —
  // and not the background of <body>, which here is white on a night-blue screen.
  let ground = document.body;
  const covers = (el) => {
    const box = el.getBoundingClientRect();
    return box.width >= innerWidth && box.height >= innerHeight && box.top <= 0 && box.left <= 0;
  };
  for (let descend = true; descend;) {
    descend = false;
    for (const child of ground.children) {
      if (covers(child)) {
        ground = child;
        descend = true;
        break;
      }
    }
  }

  /* Every nested pair, not the first. The loop used to break on the first inverting pair it found,
   * so a page with three inverted blocks proved one — and which one depended on DOM order. The
   * landing's green named its ticker tape purely because the tape is the first [data-surface] under
   * .page; the mascot card and FOUR MOVES were never that check's subject, and had the nav come
   * first the identical green would have said nothing about any of the three. */
  const shell = (el) => Boolean(el.closest("nav, header, footer"));
  const nests = [...document.querySelectorAll("[data-surface] [data-surface]")]
    .filter((inner) => inner.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
    .map((inner) => {
      const outer = inner.parentElement?.closest("[data-surface]");
      const ink = (el) => {
        const probe = document.createElement("div");
        probe.style.color = "var(--pk-ink)";
        el.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      };
      return {
        inner: {
          selector: name(inner),
          surface: inner.dataset.surface,
          bg: bg(inner),
          paints: painted(inner),
          ink: ink(inner),
          shell: shell(inner),
        },
        outer: outer && {
          selector: name(outer),
          surface: outer.dataset.surface,
          bg: bg(outer),
          ink: ink(outer),
        },
      };
    });

  /* Every block the route says must invert, and every element each selector matches. One selector
   * per route was insufficient for the same reason the boolean was: the landing has three inverted
   * blocks, and `#how` speaks for one of them. A selector matching more than one element asserts
   * all of them rather than the first, so a loose selector reports loudly instead of quietly
   * picking whichever came first in DOM order. */
  const targets = (mustNest ?? []).map((selector) => {
    const found = [...document.querySelectorAll(selector)];
    return {
      selector,
      matches: found.map((inner) => {
        if (!inner.dataset.surface) {
          return { selector: name(inner), surfaced: false };
        }
        if (shell(inner)) {
          // The shared nav's inverted action satisfies a loose selector on every light route.
          return { selector: name(inner), surfaced: true, inShell: true };
        }
        const outer = inner.parentElement?.closest("[data-surface]");
        return {
          surfaced: true,
          inner: {
            selector: name(inner),
            surface: inner.dataset.surface,
            bg: bg(inner),
            paints: painted(inner),
          },
          outer: outer
            ? { selector: name(outer), surface: outer.dataset.surface, bg: bg(outer) }
            : null,
        };
      }),
    };
  });

  return { where: name(ground), ground: painted(ground), root: bg(ground), targets, nests };
}
