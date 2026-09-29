// A comment may quote #c8f03a and rgba(0, 0, 0, 0.5).
import Link from "next/link";

export const anchor = "#how";
export const selector = "#tape, #mascot-card";
export const ticker = "$HALF";

export function Row() {
  return (
    <Link href="#feed" style={{ color: "currentColor" }}>
      Issue #12 is fixed
    </Link>
  );
}
