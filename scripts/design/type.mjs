// The display face carries its width axis. Archivo at the right weight and the wrong width is a
// different typeface, and nothing on screen says so — the letterforms are simply not the ones the
// canvases were drawn in. Declaring the axis and forgetting to apply it is invisible to every other
// check in here and to every pair of eyes, which is why it gets measured.
import { eachRoute, finish } from "./lib/render.mjs";
import { ROUTES } from "./routes.mjs";

const headings = () =>
  [...document.querySelectorAll("h1, h2")].map((el) => {
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      selector: el.tagName.toLowerCase() + (el.classList.length ? `.${el.classList[0]}` : ""),
      family: style.fontFamily,
      variation: style.fontVariationSettings,
      size: style.fontSize,
      weight: style.fontWeight,
      text: el.textContent.trim().slice(0, 40).replace(/\s+/g, " "),
      rendered: el.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
    };
  });

const { results, blocked } = await eachRoute(ROUTES, (page) => page.evaluate(headings));

const problems = [];
for (const { route, value } of results) {
  const shown = value.filter((heading) => heading.rendered);
  for (const heading of shown) {
    const where = `${route.name} ${heading.selector} "${heading.text}"`;
    // next/font generates its own family names, so the stack reads
    // `Archivo, "Archivo Fallback", Archivo, sans-serif`. Matching the word is the check.
    if (!/archivo/i.test(heading.family)) {
      problems.push({
        route,
        text: `${where}: font-family is ${heading.family}, which is not the display face`,
      });
    }
    const axis = /"wdth"\s*([\d.]+)/.exec(heading.variation ?? "");
    if (!axis) {
      problems.push({
        route,
        text: `${where}: font-variation-settings is ${heading.variation || "normal"} — no wdth axis, so this is Archivo at its default width and not the face the canvases use`,
      });
    }
  }
}

finish("type", {
  routes: ROUTES,
  blocked,
  results,
  summary: (value) => `${value.filter((h) => h.rendered).length} heading(s)`,
  problems,
});
