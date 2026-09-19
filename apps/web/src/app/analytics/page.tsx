import { redirect } from "next/navigation";

// Analytics and the leaderboard are one page now: the numbers are the context for the ranking.
export default function Analytics() {
  redirect("/leaderboard");
}
