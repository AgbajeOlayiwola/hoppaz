"use client";

import AccountWall from "@/components/app/AccountWall";
import LoadingStub from "@/components/app/LoadingStub";
import { useIntroActive, introNeedAccount } from "@/lib/intro/active";
import { supabaseConfigured } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";

/**
 * Wraps a page that needs an account (Crew, Me, the avatar editor). Anonymous
 * Hoppers see the sign-up right there instead; the moment they're in, the page
 * itself renders. Without a database (local demo) nothing is gated.
 *
 * `preview` (Crew, Me): while Paz's tour is with the Hopper, they see the page
 * itself, look only (every tap on a control says "sign up first"), so her tour
 * can show it. The wall is back the moment the tour ends or is skipped.
 */
export default function RequireAccount({
  title,
  caption,
  preview = false,
  children,
}: {
  title: string;
  caption: string;
  preview?: boolean;
  children: React.ReactNode;
}) {
  const { hasAccount, state } = useSession();
  const touring = useIntroActive();
  if (!supabaseConfigured() || state === "offline" || hasAccount) return <>{children}</>;
  if (state === "loading") {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading" lines={2} />
      </div>
    );
  }
  if (preview && touring) return <TourPreview>{children}</TourPreview>;
  return <AccountWall title={title} caption={caption} />;
}

/** The page, look only: a tap on anything that does something is turned into Paz's short "sign up first" line. */
function TourPreview({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative h-full [&_input]:pointer-events-none [&_textarea]:pointer-events-none"
      onClickCapture={(e) => {
        if (!(e.target instanceof Element) || !e.target.closest("a, button, [role='button'], summary, label")) return;
        e.preventDefault();
        e.stopPropagation();
        introNeedAccount();
      }}
    >
      {children}
    </div>
  );
}
