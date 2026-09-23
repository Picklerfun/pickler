/* Browser-side helpers. Playwright serialises these functions and runs them in the page, so each
 * one has to be self-contained: it may not close over anything in this module or this repository. */

/** Every colour the --pk-* tokens actually paint, per surface scope on this page.
 *
 *  Reading the custom properties as text would compare `#0b0d1a` against `rgb(11, 13, 26)` and call
 *  the same colour a stray, so each token is instead painted onto a probe element and read back as
 *  the browser resolves it. The probe sits inside the scope it is measuring, which is what makes a
 *  nested data-surface report its own values rather than the page's. */
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

  // Anything the tokens cannot be: if `var(--x)` is not a colour the declaration is invalid at
  // computed-value time, so `color` falls back to inherited — which is how a radius, a duration or
  // a shadow is told apart from an ink without parsing any of them.
  const SENTINEL = "rgb(1, 2, 3)";
  const scopes = new Set([document.body, ...document.querySelectorAll("[data-surface]")]);
  const values = new Set();
  for (const scope of scopes) {
    const host = document.createElement("div");
    host.style.color = SENTINEL;
    const probe = document.createElement("div");
    host.append(probe);
    scope.append(host);
    for (const name of names) {
      probe.style.color = `var(${name})`;
      const painted = getComputedStyle(probe).color;
      if (painted !== SENTINEL) {
        values.add(painted);
      }
    }
    host.remove();
  }
  return { names: [...names], values: [...values] };
}

/** Every colour this page actually paints — ink, ground and the edges that have a width to show.
 *  A colour on screen that no token holds is a literal someone typed, wherever it lives. */
export function paintedColours() {
  const painted = [];
  const name = (node) =>
    node.tagName.toLowerCase() +
    (node.id ? `#${node.id}` : "") +
    (node.classList.length ? `.${node.classList[0]}` : "");
  for (const el of document.querySelectorAll("body *")) {
    // The Next dev overlay is not this product's design, and it is not on the deployed page.
    if (el.closest("nextjs-portal") || el.tagName.toLowerCase() === "nextjs-portal") {
      continue;
    }
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      continue;
    }
    const style = getComputedStyle(el);
    const selector = name(el);
    if (!style.backgroundColor.endsWith(", 0)")) {
      painted.push({ value: style.backgroundColor, selector, role: "background" });
    }
    const carriesText = [...el.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0,
    );
    if (carriesText) {
      painted.push({ value: style.color, selector, role: "text" });
    }
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      // An edge with no width paints nothing, and its colour defaults to currentColor, so reading
      // it would invent a border on every element on the page.
      if (parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== "none") {
        painted.push({ value: style[`border${side}Color`], selector, role: "border" });
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

  // A surface is a property of a subtree, not of <html>: /console leaves <body> on the light
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

  let nest = null;
  if (mustNest) {
    const inner = document.querySelector(mustNest);
    if (!inner) {
      nest = { found: false };
    } else if (!inner.dataset.surface) {
      nest = { found: true, selector: name(inner), surfaced: false };
    } else if (shell(inner)) {
      // The shared nav's inverted action satisfies a loose selector on every light route, which is
      // the same accident one level up: the assertion must land on the route's own content.
      nest = { found: true, selector: name(inner), surfaced: true, inShell: true };
    } else {
      const outer = inner.parentElement?.closest("[data-surface]");
      nest = {
        found: true,
        surfaced: true,
        inner: { selector: name(inner), surface: inner.dataset.surface, bg: bg(inner) },
        outer: outer
          ? { selector: name(outer), surface: outer.dataset.surface, bg: bg(outer) }
          : null,
      };
    }
  }
  return { where: name(ground), ground: painted(ground), root: bg(ground), nest, nests };
}
