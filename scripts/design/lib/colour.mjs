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
