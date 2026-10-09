import { notFound } from "next/navigation";
import PhoneFrame from "./PhoneFrame";

/**
 * Development only: the app inside a phone frame, for looking at the mobile
 * layout from a laptop browser (http://localhost:3000/phone). Production
 * builds answer 404, so players never see it.
 */
export default function PhonePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PhoneFrame />;
}
