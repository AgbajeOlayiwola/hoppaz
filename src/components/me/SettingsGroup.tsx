"use client";

import { useState } from "react";
import clsx from "clsx";
import { ChevronDown, FileText, Lock, Play, Settings, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { RowButton, RowLink, RowValue } from "./Rows";

/**
 * Settings, folded away at the bottom of Me. Name, home area, account, replay
 * the intro, privacy, community rules, staff (only for staff) and delete.
 */
export default function SettingsGroup({
  name,
  handle,
  area,
  hasAccount,
  email,
  accountReady,
  isAdmin,
  onSaveName,
  onChangeArea,
  onReplayIntro,
  onDelete,
}: {
  name: string | null;
  handle: string | null;
  area: string;
  hasAccount: boolean;
  email: string | null;
  /** Hide the account row until we know if there is one. */
  accountReady: boolean;
  isAdmin: boolean;
  onSaveName: (name: string | null) => Promise<void>;
  onChangeArea: () => void;
  onReplayIntro: () => void;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sure, setSure] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <section aria-label="Settings" className="mt-7">
      <div className="overflow-hidden rounded-hz border border-line bg-ink-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="me-settings"
          className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left focus-visible:[outline-offset:-2px]"
        >
          <Settings size={19} strokeWidth={1.9} aria-hidden className="flex-none text-dim" />
          <span className="min-w-0 flex-1 font-body text-[15px] font-semibold">Settings</span>
          <ChevronDown size={18} aria-hidden className={clsx("flex-none text-dim transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div id="me-settings" className="border-t border-line [&>*+*]:border-t [&>*+*]:border-line">
            {editing ? (
              <form
                className="px-4 py-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  await onSaveName(draft.trim().slice(0, 24) || null);
                  setEditing(false);
                }}
              >
                <label className="label" htmlFor="me-name">
                  What should the bus call you
                </label>
                <input id="me-name" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={24} autoComplete="off" autoFocus />
                <p className="hint mt-2">
                  Your crew searches for this name. In chat you show as @{handle ?? "your handle"}, so people know it&apos;s you.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="submit" className="btn flex-1">SAVE</button>
                  <button type="button" className="btn btn-ghost flex-none" onClick={() => setEditing(false)}>CANCEL</button>
                </div>
              </form>
            ) : (
              <RowValue
                label="NAME"
                value={name || "Hopper"}
                action="EDIT"
                onAction={() => {
                  setDraft(name ?? "");
                  setEditing(true);
                }}
              />
            )}
            <RowValue label="HOME AREA" value={area} action="CHANGE" onAction={onChangeArea} />
            {accountReady &&
              (hasAccount ? (
                <RowLink href="/account" icon={UserRound} title="Account" hint={email ?? undefined} />
              ) : (
                <RowLink href="/account" icon={UserRound} title="Make an account" hint="Wave at people, join crews, chat privately. Your XP comes with you." />
              ))}
            <RowButton icon={Play} title="Replay the intro" onClick={onReplayIntro} />
            <RowLink href="/privacy" icon={Lock} title="Privacy" />
            <RowLink href="/community" icon={FileText} title="Community rules" />
            {isAdmin && <RowLink href="/admin" icon={ShieldCheck} title="Staff" />}
            {sure ? (
              <div className="px-4 py-4">
                <p className="font-body text-[15px] font-semibold text-fireant">Delete your account?</p>
                <p className="hint mt-1">
                  Your nights, chats, crews and photos go with it. No coming back.
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn flex-1" onClick={() => setSure(false)}>
                    KEEP IT
                  </button>
                  <button
                    type="button"
                    disabled={deleting}
                    className="btn btn-ghost flex-1 border-fireant text-fireant"
                    onClick={async () => {
                      setDeleting(true);
                      await onDelete();
                      setDeleting(false);
                    }}
                  >
                    {deleting ? "DELETING" : "DELETE FOREVER"}
                  </button>
                </div>
              </div>
            ) : (
              <RowButton icon={Trash2} title="Delete my account" tone="danger" chevron={false} onClick={() => setSure(true)} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

