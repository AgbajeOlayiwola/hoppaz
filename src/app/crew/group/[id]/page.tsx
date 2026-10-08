"use client";

import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, LogOut } from "lucide-react";
import { useSession } from "@/lib/useSession";
import { useToast } from "@/lib/store";
import { groupChannel, useEventGroups } from "@/lib/chat";
import { dayLagos } from "@/lib/geo";
import RoomView from "@/components/chat/RoomView";

/** An event's group chat: permanent, for everyone who said they're going and joined. */
export default function GroupChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const say = useToast((s) => s.say);
  const { userId, hasAccount } = useSession();
  const { groups, join, leave } = useEventGroups(userId);
  const group = groups.find((g) => g.event_id === id) ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden px-4">
      <header className="pad-top flex flex-none items-center gap-3 pb-3">
        <button onClick={() => router.push("/crew")} aria-label="Back to crew" className="grid h-9 w-9 flex-none place-items-center rounded border border-line">
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-black leading-tight">{group?.title ?? "Group chat"}</h1>
          <p className="seclabel">
            {group ? `${dayLagos(group.starts_at)} · ${group.members} IN THE CHAT` : "EVENT GROUP CHAT"}
          </p>
        </div>
        {group?.status === "joined" && (
          <button
            onClick={async () => {
              if (!window.confirm("Leave this group chat? You can join again from Crew while your invite stands.")) return;
              await leave(id);
              say("LEFT THE GROUP CHAT");
              router.push("/crew");
            }}
            aria-label="Leave group chat"
            className="grid h-8 w-8 place-items-center text-dim"
          >
            <LogOut size={15} />
          </button>
        )}
      </header>

      {!group ? (
        <p className="hint">Group chats open when you say you&apos;re going to an event. Tap I&apos;M GOING on an event, and its invite lands in Crew.</p>
      ) : group.status === "invited" ? (
        <div className="card">
          <p className="font-display text-sm font-black">You&apos;re invited</p>
          <p className="hint mt-1">Everyone going to {group.title} can join. It stays after the night, so you can keep in touch.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn flex-1" onClick={async () => say((await join(id)) ? "YOU'RE IN THE GROUP CHAT" : "COULD NOT JOIN", "violet")}>JOIN THE CHAT</button>
            <button className="btn btn-ghost flex-none" onClick={async () => { await leave(id); router.push("/crew"); }}>NO THANKS</button>
          </div>
        </div>
      ) : (
        <RoomView
          channel={groupChannel(id)}
          people={{ kind: "group", eventId: id }}
          userId={userId}
          hasAccount={hasAccount}
          note="STAYS AFTER THE NIGHT"
          empty="You're in. Say hi to everyone going."
          noPeople="Nobody else has joined yet."
          placeholder="Message the group"
        />
      )}
    </div>
  );
}
