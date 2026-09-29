// Screenshots, for a person to judge. The checks beside this one catch what is measurable; spacing,
// rhythm and whether a screen reads like its canvas are not, and want eyes. Full page at both ends
// of the width axis, because a layout that survives 1400 and fails 390 fails for most people.
//
// DESIGN_SHOTS_DIR names the folder, so a baseline and a later run can sit side by side for
// compare.mjs. Without it the shots go to scripts/design/shots, as they always have.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eachRoute, finish } from "./lib/render.mjs";
import { ROUTES } from "./routes.mjs";

const SHOTS = process.env.DESIGN_SHOTS_DIR
  ? path.resolve(process.env.DESIGN_SHOTS_DIR)
  : path.join(path.dirname(fileURLToPath(import.meta.url)), "shots");
const SIZES = [
  { name: "desktop", width: 1400, height: 1000 },
  { name: "phone", width: 390, height: 844 },
];

// Cleared each run. A stale shot of a screen that no longer renders is worse than no shot: it is a
// picture of a page nobody can reach, and it looks exactly like a picture of a page that works.
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const problems = [];
let blocked = [];
const taken = [];
for (const { name, width, height } of SIZES) {
  const pass = await eachRoute(
    ROUTES,
    async (page, route) => {
      const file = path.join(SHOTS, `${route.name}-${name}.png`);
      // Animations off: a blinking dot or a floating mascot caught at a different moment is a
      // difference between two runs that nobody made.
      await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
      taken.push(`${route.name}-${name}.png`);
    },
    { width, height },
  );
  // The same route is blocked at both widths, so only one pass's blocks are worth reporting.
  blocked = pass.blocked;
}

process.stdout.write(
  taken.length
    ? `wrote ${taken.length} shot(s) to ${SHOTS}: ${taken.join(", ")}\n`
    : `wrote no shots — nothing rendered.\n`,
);
finish("shots", { routes: ROUTES, blocked, problems });
