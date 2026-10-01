// A comment may name data-third-party-mark; it puts it on nothing.
export const selector = "[data-third-party-mark]";
export const shouted = "svg[DATA-THIRD-PARTY-MARK], [data-surface]";

export function skipped(element: Element) {
  return element.closest("[data-third-party-mark]") !== null;
}

export function Logo() {
  return <svg data-surface="dark" data-mark="brand" aria-hidden />;
}
