import Link from "next/link";
import PageHeader from "@/components/app/PageHeader";

/** Where privacy questions go. NEXT_PUBLIC_SUPPORT_EMAIL overrides it for a staging project. */
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "itshoppaz@gmail.com";

const SECTIONS: Array<{ title: string; body: string }> = [
  {
    title: "Who we are",
    body: "Hoppaz is the controller of the personal data described on this page.",
  },
  {
    title: "What Hoppaz stores",
    body: "Your anonymous account has an internal ID. Your profile may include the name, home area and avatar you choose. Hoppaz stores event check-ins, quest and reward claims, crew memberships, messages, reports, and event photos you submit.",
  },
  {
    title: "Location",
    body: "If you allow device location, Hoppaz sends your coordinates to verify proximity to an event or drop. The verification functions use those coordinates to return a distance decision; they do not write the submitted coordinates into the activity ledger. The app may remember your selected location on this device. Your exact device coordinates are not shown to other people. Your selected home area and profile are used for the features you enable, such as crew pins.",
  },
  {
    title: "Photos and messages",
    body: "Event photos are private while awaiting review. Approved photos are displayed in Hoppaz with time-limited image access. Chat messages are visible in their room or private thread; moderators may resolve reported content and can map anonymous room aliases to an account when investigating abuse. Blocking and reporting are available in chat.",
  },
  {
    title: "Sharing",
    body: "Monthly report cards use a private, hard-to-guess link. Anyone with that link can view the report snapshot. Do not share it if you want to keep those activity details private.",
  },
  {
    title: "Hosting and partners",
    body: "Hoppaz uses Supabase for account, database, realtime and image storage services, and Vercel to host the app. When you redeem a partner reward, you may show its claim code to that partner so they can honour it. Hoppaz does not sell profile or location data.",
  },
  {
    title: "Your choices",
    body: "You can edit your display name, home area and avatar. You can remove your account from the Me screen; this deletes the profile, associated activity, crew data, chat messages, shared report links, and stored event photos from Hoppaz systems.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="h-full overflow-y-auto px-4 pb-10">
      <div className="mx-auto w-full max-w-xl">
        <PageHeader back="/me" title="Your data on Hoppaz" caption="Plain-language privacy notice · Lagos" />

        <div className="space-y-6">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="font-display text-[20px] font-black leading-tight">{s.title}</h2>
              <p className="mt-2 font-body text-[15px] leading-relaxed">{s.body}</p>
            </section>
          ))}

          <section>
            <h2 className="font-display text-[20px] font-black leading-tight">Contact and privacy requests</h2>
            <p className="mt-2 font-body text-[15px] leading-relaxed">
              For access, correction, deletion or any privacy question, email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="hz-link break-all">
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>

        <p className="mt-10 border-t border-line pt-5 font-body text-[15px]">
          Also read the{" "}
          <Link href="/community" className="hz-link">
            community rules
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
