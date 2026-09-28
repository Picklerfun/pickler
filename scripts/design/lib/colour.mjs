/** "rgb(11, 13, 26)" or "rgba(11, 13, 26, 0.5)" to [r,g,b,a]. */
export function parse(value) {
  const nums = String(value).match(/[\d.]+/g);
  if (!nums || nums.length < 3) {
    return null;
  }
  return [
    Number(nums[0]),
    Number(nums[1]),
    Number(nums[2]),
    nums[3] === undefined ? 1 : Number(nums[3]),
  ];
}

/** Paint `over` onto `under`. A translucent ink over a ground is what the eye sees, and comparing
 *  the ink's own rgba to the ground would report a contrast nobody experiences. */
export function composite(over, under) {
  const a = over[3];
  return [0, 1, 2].map((i) => over[i] * a + under[i] * (1 - a)).concat(1);
}

/** Paint `src` (a colour and its coverage) onto `dst`, either of which may be partly covering. */
function over(src, srcA, dst, dstA) {
  const outA = srcA + dstA * (1 - srcA);
  if (outA === 0) {
    return [[0, 0, 0], 0];
  }
  const colour = [0, 1, 2].map((i) => (src[i] * srcA + dst[i] * dstA * (1 - srcA)) / outA);
  return [colour, outA];
}

/** What the browser actually paints, given the chain of levels from an element up to the root and
 *  an optional ink on top. `levels` runs element-first, each `{ opacity, ground }`.
 *
 *  Element opacity is not an alpha that can be folded into a colour. It creates a stacking context:
 *  the element and everything inside it render into one buffer, and that buffer is composited once
 *  onto what is behind. So an element that paints its own ground and dims itself does not dim its
 *  ink against its own ground — at a text pixel the buffer holds the opaque ink, and it is the ink
 *  that gets blended with whatever is behind the group.
 *
 *  Multiplying the opacities and folding the product into the ink's alpha is right only while the
 *  dimmed elements paint no ground of their own, because then there is nothing else in the buffer.
 *  Where they do, that model lands the opacity on the ink twice: measured against a rendered
 *  control it reported 2.53 where the browser painted 4.38. */
export function paint(levels, ink = null) {
  let colour = ink ? [ink[0], ink[1], ink[2]] : [0, 0, 0];
  let covered = ink ? ink[3] : 0;
  for (const { opacity, ground } of levels) {
    if (ground) {
      [colour, covered] = over(colour, covered, ground, ground[3]);
    }
    // The whole group — this element's ground and everything drawn inside it — dims as one.
    covered *= opacity;
  }
  // White is what a browser paints under all of it.
  const [seen] = over(colour, covered, [255, 255, 255], 1);
  return [...seen, 1];
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function ratio(fg, bg) {
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const hex = ([r, g, b]) =>
  "#" +
  [r, g, b]
    .map((n) => Math.round(n).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
