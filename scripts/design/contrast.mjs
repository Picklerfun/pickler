// Contrast, read off the rendered page. This is the check that catches a component reading the
// wrong token: §4's table can be perfectly right while a heading reads --pk-ink-faint where it
// meant --pk-ink-muted, and only the rendering shows it.
//
// How much of the DOM: every element carrying its own text, with no cap. The walk is one evaluate
// call and costs milliseconds, so the thing worth rationing is the report, not the work. Findings
// are therefore grouped by the four things that decide a ratio — ink, ground, size, weight — so one
// mis-read token reports once with a count and a line to look at, instead of four hundred times.
import { composite, hex, parse, ratio } from "./lib/colour.mjs";
import { eachRoute, finish } from "./lib/render.mjs";
import { ROUTES } from "./routes.mjs";

// WCAG 1.4.3: large text is 24px at any weight, or 18.66px at 700 or more.
const LARGE = 24;
const LARGE_BOLD = 18.66;

const collect = () =>
  [...document.querySelectorAll("body *")]
    .filter((el) => {
      const carriesText = [...el.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0,
      );
      return carriesText && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    })
    .map((el) => {
      const style = getComputedStyle(el);
      // The grounds from this element up to <html>. Compositing happens in Node, against the tested
      // arithmetic, so that nothing here can quietly disagree with lib/colour.mjs.
      const grounds = [];
      let painted = false;
      for (let node = el; node; node = node.parentElement) {
        const background = getComputedStyle(node);
        if (background.backgroundImage !== "none") {
          painted = true;
        }
        if (!background.backgroundColor.endsWith(", 0)")) {
          grounds.push(background.backgroundColor);
        }
      }
      const name = (node) =>
        node.tagName.toLowerCase() +
        (node.id ? `#${node.id}` : "") +
        (node.classList.length ? `.${node.classList[0]}` : "");
      return {
        selector: (el.parentElement ? `${name(el.parentElement)} > ` : "") + name(el),
        ink: style.color,
        grounds,
        overImage: painted,
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
        text: el.textContent.trim().slice(0, 40).replace(/\s+/g, " "),
      };
    });

const { results, blocked } = await eachRoute(ROUTES, (page) => page.evaluate(collect));

const problems = [];
const counts = [];
let overImage = 0;
for (const { route, value } of results) {
  const seen = new Map();
  // Printed even when clean. A walk that silently matched nothing reports the same green as a page
  // with no problems, and this is the number that tells the two apart.
  counts.push(`${route.name}: ${value.length} text element(s)`);
  for (const item of value) {
    const ink = parse(item.ink);
    if (!ink || ink[3] === 0) {
      continue;
    }
    if (item.overImage) {
      // An opaque gradient or starfield sits between the ink and any colour we can read, so any
      // number computed here would be fiction. Counted and named, never quietly passed.
      overImage += 1;
      continue;
    }
    // Composite the stack from the far end back: the page's own ground first, then anything
    // translucent painted over it, then the ink. White is what a browser paints under all of it.
    let ground = [255, 255, 255, 1];
    for (const layer of item.grounds.reverse()) {
      ground = composite(parse(layer), ground);
    }
    const seenInk = composite(ink, ground);
    const large = item.size >= LARGE || (item.size >= LARGE_BOLD && item.weight >= 700);
    const need = large ? 3 : 4.5;
    const measured = ratio(seenInk, ground);
    if (measured >= need) {
      continue;
    }
    // One wrong token paints many elements. Group by what actually decides the ratio.
    const key = `${hex(seenInk)}|${hex(ground)}|${item.size}|${item.weight}`;
    const already = seen.get(key);
    if (already) {
      already.count += 1;
      continue;
    }
    seen.set(key, { count: 1 });
    problems.push({
      key,
      route,
      line: () =>
        `${route.name} ${item.selector}: ${measured.toFixed(2)} needs ${need} — ` +
        `${hex(seenInk)} on ${hex(ground)} at ${item.size}px/${item.weight}` +
        ` ×${seen.get(key).count} — "${item.text}"`,
    });
  }
}

process.stdout.write(`measured — ${counts.join(", ")}\n`);

if (overImage) {
  process.stdout.write(
    `note: ${overImage} element(s) sit over a background image; their ground cannot be read, so ` +
      `they are not measured here and want eyes on the screenshots.\n`,
  );
}

finish("contrast", {
  routes: ROUTES,
  blocked,
  problems: problems.map((p) => ({ route: p.route, text: p.line() })),
});
