"use client";

import Mascot from "@/components/Mascot";
import SignupForm from "@/components/app/SignupForm";

const PERKS = [
  "Say WE OUTSIDE and get into the event's group chat",
  "Check in, earn XP and badges, claim drops and rewards",
  "Start a crew and plan moves together",
  "Dress your Hopper and keep your nights",
];

/**
 * What a page that needs an account shows instead, until there is one: what
 * you get, and the three-field sign-up right there. Once signed in, the session
 * store updates and the page renders itself; no reload.
 */
export default function AccountWall({ title, caption }: { title: string; caption: string }) {
  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <header className="pad-top flex items-center gap-3 pb-4">
        <Mascot state="oya" size={84} className="flex-none" />
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-black leading-[1.02]">{title}</h1>
          <p className="hint mt-1.5">{caption}</p>
        </div>
      </header>
      <ul className="mb-5 space-y-2">
        {PERKS.map((p) => (
          <li key={p} className="flex items-start gap-2.5 font-body text-[15px] leading-snug">
            <span aria-hidden className="mt-[7px] h-2 w-2 flex-none rotate-45 bg-orange" />
            {p}
          </li>
        ))}
      </ul>
      <div className="card">
        <SignupForm onDone={() => {}} />
      </div>
    </div>
  );
}
