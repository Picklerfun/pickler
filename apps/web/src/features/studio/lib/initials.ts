/**
 * The agent's mark, everywhere it is drawn (the create flow's stack card, the studio home's
 * mark and chip): two or more words take the first letter of the first two; one word takes its
 * first two letters; nothing gives "?".
 */
export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return (words[0] ?? "").slice(0, 2).toUpperCase();
  }
  return words
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}
