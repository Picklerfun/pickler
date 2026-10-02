import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
// Usa el Chrome ya instalado (spec D5); override con PICKLER_CHROME.
const executablePath =
  process.env.PICKLER_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(executablePath))
  throw new Error(`Chrome no encontrado en ${executablePath}; define PICKLER_CHROME`);
const out = process.argv[2] || '/tmp/pickler-agent-render';
mkdirSync(out, { recursive: true });
// Sin argumento: index más todos los overviews del manifest (Pickler tiene pocos).
globalThis.window = {}; // el manifest asigna window.DOCS
const manifest = await import(pathToFileURL(resolve('docs/overview/data/manifest.js')).href)
  .then(() => globalThis.window.DOCS)
  .catch(() => []);
const files = process.argv[3]
  ? [process.argv[3]]
  : ['index', ...manifest.map((d) => d.file.replace(/\.html$/, ''))];
const browser = await puppeteer.launch({ headless: true, executablePath });
const results = [];
try {
  for (const file of files.filter(
    (f) => !process.argv[3] || f === process.argv[3],
  ))
    for (const width of [1440, 390]) {
      const page = await browser.newPage();
      await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(
        pathToFileURL(resolve('docs/overview', file + '.html')).href,
        { waitUntil: 'networkidle0', timeout: 30000 },
      );
      const state = await page.evaluate(() => ({
        title: document.title,
        documentWidth: document.documentElement.scrollWidth,
        widthDrops: (() => {
          const before = document.documentElement.scrollWidth;
          if (before <= innerWidth + 1) return [];
          return [
            ...document.querySelectorAll('header,main,footer,nav,pre,svg'),
          ].flatMap((el) => {
            const previous = el.style.display;
            el.style.display = 'none';
            const after = document.documentElement.scrollWidth;
            el.style.display = previous;
            return after < before
              ? [{ tag: el.tagName, cls: el.className, after }]
              : [];
          });
        })(),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        overflowElements: [...document.querySelectorAll('body *')]
          .filter(
            (e) =>
              e.getBoundingClientRect().right > innerWidth + 1 &&
              getComputedStyle(e).position !== 'fixed',
          )
          .slice(0, 100)
          .map((e) => ({
            tag: e.tagName,
            cls: e.className,
            width: e.getBoundingClientRect().width,
            text: e.textContent.slice(0, 80),
            parent: e.parentElement?.tagName + '.' + e.parentElement?.className,
            parentOverflow: getComputedStyle(e.parentElement).overflowX,
          })),
        phases: [...document.querySelectorAll('article.phase-card')].map(
          (p) => ({
            num: p.dataset.phase,
            status: p.dataset.status,
            selected: p.querySelector('select')?.value,
          }),
        ),
        board: [...document.querySelectorAll('[data-sb]')].map((n) => [
          n.dataset.sb,
          n.textContent.trim(),
        ]),
        brokenImages: [...document.images]
          .filter((i) => !i.complete || i.naturalWidth === 0)
          .map((i) => i.src),
      }));
      const safeFile = file.replace(/[^a-z0-9._-]+/gi, '_');
      await page.screenshot({
        path: join(out, `${safeFile}-${width}.png`),
        fullPage: true,
      });
      await page.screenshot({
        path: join(out, `${safeFile}-${width}-viewport.png`),
      });
      results.push({ file, width, errors, ...state });
      await page.close();
    }
} finally {
  await browser.close();
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
if (
  results.some(
    (r) =>
      r.errors.length ||
      r.overflow ||
      r.brokenImages.length ||
      r.phases.some((p) => p.status !== p.selected),
  )
)
  process.exitCode = 1;
