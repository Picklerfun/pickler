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

/** The ground this page paints, and the innermost nested surface if there is one. */
export function surfaces() {
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

  // The mechanism the whole system rests on: a subtree taking the opposite data-surface inverts
  // everything inside it. Find a data-surface inside another data-surface and read both grounds.
  // Only a rendered one counts — a closed dialog would prove the tokens cascade and prove nothing
  // about the screen.
  let nested = null;
  for (const inner of document.querySelectorAll("[data-surface] [data-surface]")) {
    const outer = inner.parentElement?.closest("[data-surface]");
    if (!outer || !inner.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
      continue;
    }
    nested = {
      inner: { selector: name(inner), surface: inner.dataset.surface, bg: bg(inner) },
      outer: { selector: name(outer), surface: outer.dataset.surface, bg: bg(outer) },
    };
    if (nested.inner.bg !== nested.outer.bg) {
      break; // an inverting pair is what is being looked for; keep looking past a matching one
    }
  }
  return { where: name(ground), ground: painted(ground), root: bg(ground), nested };
}
