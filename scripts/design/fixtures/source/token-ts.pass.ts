export const read = (style: CSSStyleDeclaration) => style.getPropertyValue("--pk-ink").trim();
export const index = (position: number) => ({ "--i": position });
export const family = (hue: string) => `--pk-agent-${hue}-fill`;
