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

/** Element opacity in force at each level, given each element's own opacity from the text element
 *  up to the root. Opacity is not part of a colour and it compounds down the tree, so 0.55 inside
 *  0.8 is 0.44 — which is where white ink on the night-blue panel drops under AA while measuring
 *  21:1 on the two colours alone. These are suffix products: the value at index i is the opacity
 *  applying to whatever is painted at that level, including every ancestor above it. */
export function effectiveOpacity(opacities) {
  const out = [];
  let carried = 1;
  for (let i = opacities.length - 1; i >= 0; i -= 1) {
    carried *= opacities[i];
    out[i] = carried;
  }
  return out;
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
