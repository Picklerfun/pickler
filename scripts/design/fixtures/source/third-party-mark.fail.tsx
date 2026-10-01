export function Logo() {
  return <svg data-third-party-mark="" aria-hidden />;
}

export const spread = { "data-third-party-mark": true };

export function mark(element: HTMLElement, part: string) {
  element.setAttribute(`data-third-party-mark`, "");
  element.dataset.thirdPartyMark = "";
  element.dataset["thirdPartyMark"] = "";
  element.setAttribute("DATA-THIRD-PARTY-MARK", "");
  element.setAttribute(`data-${part}`, "");
}

export function Shouting() {
  return <svg data-Third-Party-Mark="" aria-hidden />;
}

export const built = { ["data-" + "third-party-mark"]: true };
export const part = "third-party-mark";
export const templated = `data-${part}-${"x"}third-party-mark`;
