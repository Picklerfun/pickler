/* Browser-side: Playwright serialises this function and runs it in a blank page, so it closes
 * over nothing. Two PNGs as data URLs in, how far apart they are out. */
export async function difference([before, after]) {
  const load = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("an image did not decode"));
      image.src = src;
    });
  const [a, b] = await Promise.all([load(before), load(after)]);
  const size = { before: [a.width, a.height], after: [b.width, b.height] };
  if (a.width !== b.width || a.height !== b.height) {
    return { ...size, resized: true, changed: null, box: null };
  }
  const pixels = (image) => {
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const one = pixels(a);
  const two = pixels(b);
  let changed = 0;
  const box = { left: a.width, top: a.height, right: -1, bottom: -1 };
  for (let at = 0; at < one.length; at += 4) {
    // Two values of one channel is what re-rasterising the same glyph can move; more is a change.
    const moved =
      Math.abs(one[at] - two[at]) > 2 ||
      Math.abs(one[at + 1] - two[at + 1]) > 2 ||
      Math.abs(one[at + 2] - two[at + 2]) > 2;
    if (moved) {
      changed += 1;
      const x = (at / 4) % a.width;
      const y = Math.floor(at / 4 / a.width);
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x);
      box.bottom = Math.max(box.bottom, y);
    }
  }
  return {
    ...size,
    resized: false,
    changed: changed / (one.length / 4),
    box: changed ? box : null,
  };
}
