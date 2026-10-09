import Link from "next/link";
import PageHeader from "@/components/app/PageHeader";

const RULES: Array<{ title: string; body: string }> = [
  {
    title: "Be kind and respect boundaries",
    body: "No harassment, threats, hate, unwanted sexual attention, stalking or sharing someone’s private information. A wave is an invitation to talk only if the other person agrees.",
  },
  {
    title: "Keep events and rewards honest",
    body: "Post accurate event details. Do not fake check-ins, QR scans, photos, quest evidence, tickets or reward claims. Honour partner reward terms and quantity limits.",
  },
  {
    title: "Post photos with permission",
    body: "Only upload photos you have the right to share. Avoid close-up images of people who have not agreed to be posted. Hoppaz reviews event photos before they appear to others.",
  },
  {
    title: "Keep meetups public and safe",
    body: "Meet in public places, tell someone you trust where you are going, and use your own judgment. Hoppaz does not verify every event, Hopper, crew or partner offer.",
  },
  {
    title: "Report issues",
    body: "Use the report and block controls in chat. Hoppaz staff review reports and may remove content, suspend access or stop a reward drop.",
  },
];

export default function CommunityPage() {
  return (
    <div className="h-full overflow-y-auto px-4 pb-10">
      <div className="mx-auto w-full max-w-xl">
        <PageHeader back="/me" title="Community rules" caption="Make Lagos nights safer and better for everyone" />

        <ol className="space-y-6">
          {RULES.map((r, i) => (
            <li key={r.title} className="flex gap-4">
              <span aria-hidden className="w-6 flex-none pt-[5px] font-mono text-[13px] font-medium text-dim">
                {String(i + 1).padStart(2, "0")}
              </span>
              <section className="min-w-0">
                <h2 className="font-display text-[20px] font-black leading-tight">{r.title}</h2>
                <p className="mt-2 font-body text-[15px] leading-relaxed">{r.body}</p>
              </section>
            </li>
          ))}
        </ol>

        <p className="mt-10 border-t border-line pt-5 font-body text-[15px]">
          Also read the{" "}
          <Link href="/privacy" className="hz-link">
            privacy notice
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
