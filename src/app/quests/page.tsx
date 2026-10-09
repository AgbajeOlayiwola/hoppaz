import { redirect } from "next/navigation";

/**
 * The Quests page is gone: quests live on each night's own card and in the
 * "Ways to earn" sheet that opens from your XP on Me. This stays only so an
 * old link or bookmark lands somewhere useful.
 */
export default function QuestsPage() {
  redirect("/me#earn");
}
