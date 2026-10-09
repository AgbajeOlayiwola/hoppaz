"use client";

import AccountWall from "@/components/app/AccountWall";
import LoadingStub from "@/components/app/LoadingStub";
import { supabaseConfigured } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";

/**
 * Wraps a page that needs an account (Crew, Me, the avatar editor). Anonymous
 * Hoppers see the sign-up right there instead; the moment they're in, the page
 * itself renders. Without a database (local demo) nothing is gated.
 */
export default function RequireAccount({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  const { hasAccount, state } = useSession();
  if (!supabaseConfigured() || state === "offline" || hasAccount) return <>{children}</>;
  if (state === "loading") {
    return (
      <div className="h-full px-4 pt-16">
        <LoadingStub label="Loading" lines={2} />
      </div>
    );
  }
  return <AccountWall title={title} caption={caption} />;
}
