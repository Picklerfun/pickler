/* What compare.mjs prints, decided apart from the browser so it can be pinned by a test. */

/** The screens a noise file names, with how far each moved: `DIFFERS  <name>  <n>% of pixels…`. */
export function readNoise(text) {
  const noise = new Map();
  for (const line of String(text).split("\n")) {
    const match = /^(?:DIFFERS|NOISE)\s+(\S+)\s+([\d.]+)% of pixels/.exec(line);
    if (match) {
      noise.set(match[1], Number(match[2]));
    }
  }
  return noise;
}

/**
 * One line for one pair of shots, or null when they are identical.
 *
 * A screen that shows a clock, a countdown or a chart drawn from the current time differs between
 * two runs of the same tree. `noise` is what two such runs measured; a difference no larger than
 * three times that, or than 0.05% where the noise was smaller, is reported as NOISE and not as a
 * change. It is still printed: a real change that small on a noisy screen is for eyes to find.
 */
export function line(name, result, noise = new Map()) {
  if (result.resized) {
    return `RESIZED  ${name}  ${result.before.join("×")} → ${result.after.join("×")} (not compared pixel by pixel)`;
  }
  if (result.changed === 0) {
    return null;
  }
  const percent = result.changed * 100;
  const { left, top, right, bottom } = result.box;
  const known = noise.get(name);
  const quiet = known !== undefined && percent <= Math.max(known * 3, 0.05);
  return `${quiet ? "NOISE  " : "DIFFERS"}  ${name}  ${percent.toFixed(3)}% of pixels, inside x ${left}–${right}, y ${top}–${bottom}`;
}
