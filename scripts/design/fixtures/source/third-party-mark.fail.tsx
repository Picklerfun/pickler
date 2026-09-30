export function Logo() {
  return <svg data-third-party-mark="" aria-hidden />;
}

export const spread = { "data-third-party-mark": true };

export function mark(element: Element) {
  element.setAttribute(`data-third-party-mark`, "");
}
