"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Shuffle } from "lucide-react";
import clsx from "clsx";
import Avatar from "@/components/Avatar";
import { useSession } from "@/lib/useSession";
import { useHoppaz, useToast } from "@/lib/store";
import {
  BEARDS, BODIES, EARS, EYE_COLORS, EYES, FRAMES, GLASSES, HAIR, HAIR_COLORS, LABELS, LIPS, MOUTHS, NECKS, SKINS,
  WARDROBE, normalizeLook, randomLook, type Item, type Look, type Slot,
} from "@/lib/avatar";

const TABS = ["BODY", "HAIR", "FACE", "FITS", "KICKS", "EXTRAS"] as const;
type Tab = (typeof TABS)[number];

const FIT_SLOTS: ReadonlyArray<[Slot, string]> = [
  ["top", "Tops"],
  ["bottom", "Bottoms"],
  ["head", "Headwear"],
];

// Skins are stored by index and new tones were appended, so show them deep to light.
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};
const SKIN_ORDER = SKINS.map((hex, i) => ({ hex, i })).sort((a, b) => lum(a.hex) - lum(b.hex));

export default function AvatarEditor() {
  const router = useRouter();
  const { profile, patchProfile } = useSession();
  const stored = useHoppaz((s) => s.look);
  const setLook = useHoppaz((s) => s.setLook);
  const say = useToast((s) => s.say);

  // Start from the database copy, then the local one, then the default.
  const initial = useMemo(() => normalizeLook(profile?.avatar ?? stored), [profile?.avatar, stored]);
  const [draft, setDraft] = useState<Look | null>(null);
  const look = draft ?? initial;
  const set = (patch: Partial<Look>) => setDraft({ ...look, ...patch });

  const [tab, setTab] = useState<Tab>("BODY");
  const [label, setLabel] = useState<string>("all");

  const save = async () => {
    setLook(look);
    await patchProfile({ avatar: look });
    say("LOOK SAVED");
    router.push("/me");
  };

  const labelName = (key: string) => LABELS.find((l) => l.key === key)?.name ?? key;
  const fits = (slot: Slot) => WARDROBE.filter((i) => i.slot === slot && (label === "all" || i.brand === label));
  const wearing = (i: Item) => look[i.slot] === i.id;
  const wear = (i: Item) => {
    if (i.slot === "head") set({ head: wearing(i) ? null : i.id });
    else set({ [i.slot]: i.id } as Partial<Look>);
  };

  return (
    <div className="flex h-full flex-col">
      {/* ---------------------------------------------------- the stage -- */}
      <div className="pad-top relative flex-none overflow-hidden border-b border-line bg-ink px-4 pb-3">
        <div className="relative z-10 flex items-center justify-between">
          <Link href="/me" aria-label="Back to Me" className="grid h-9 w-9 place-items-center rounded border border-line bg-ink-2">
            <ArrowLeft size={15} />
          </Link>
          <p className="seclabel">Dress for the bus</p>
          <button
            onClick={() => setDraft(randomLook())}
            aria-label="Random look"
            className="grid h-9 w-9 place-items-center rounded border border-line bg-ink-2"
          >
            <Shuffle size={15} />
          </button>
        </div>
        {/* The orange sun behind the rider, straight from the Rough Cut style */}
        <span aria-hidden className="absolute left-1/2 top-[58%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange" />
        <div key={JSON.stringify(look)} className="relative z-10 mx-auto h-[230px] w-[140px] animate-pop">
          <Avatar look={look} label="Your Hopper" />
        </div>
      </div>

      {/* ------------------------------------------------------ the tabs -- */}
      <div role="tablist" className="flex flex-none gap-1 overflow-x-auto border-b border-line bg-ink-2 px-2 py-2">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx(
              "flex-none rounded px-3 py-2 font-mono text-[10px] font-bold tracking-[0.12em]",
              tab === t ? "bg-orange text-ink" : "text-dim"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === "BODY" && (
          <>
            <Section title="Frame">
              {FRAMES.map(([k, name]) => (
                <Tile
                  key={k}
                  on={look.frame === k}
                  // Switching frame also suggests a build; build stays its own pick below.
                  onClick={() => set({ frame: k, body: k === "female" ? "curvy" : "straight" })}
                  name={name}
                >
                  <Avatar look={{ ...look, frame: k, body: k === "female" ? "curvy" : "straight" }} crop="head" />
                </Tile>
              ))}
            </Section>
            <p className="label">Skin</p>
            <div className="mb-5 flex flex-wrap gap-2.5">
              {SKIN_ORDER.map(({ hex, i }, n) => (
                <Swatch key={hex} hex={hex} on={look.skin === i} onClick={() => set({ skin: i })} label={`Skin tone ${n + 1}`} />
              ))}
            </div>
            <p className="label">Build</p>
            <Chips list={BODIES} value={look.body} onPick={(body) => set({ body })} />
          </>
        )}

        {tab === "HAIR" && (
          <>
            <p className="label">Colour</p>
            <div className="mb-5 flex flex-wrap gap-2.5">
              {HAIR_COLORS.map((c, i) => (
                <Swatch key={c.key} hex={c.hex} on={look.hairColor === i} onClick={() => set({ hairColor: i })} label={c.key} />
              ))}
            </div>
            <p className="label">Style</p>
            <Grid>
              {HAIR.map(([k, name]) => (
                <Tile key={k} on={look.hair === k} onClick={() => set({ hair: k })} name={name}>
                  <Avatar look={{ ...look, hair: k, head: null }} crop="head" />
                </Tile>
              ))}
            </Grid>
          </>
        )}

        {tab === "FACE" && (
          <>
            <Section title="Eyes">
              {EYES.map(([k, name]) => (
                <Tile key={k} on={look.eyes === k} onClick={() => set({ eyes: k })} name={name}>
                  <Avatar look={{ ...look, eyes: k }} crop="head" />
                </Tile>
              ))}
            </Section>
            <p className="label">Eye colour</p>
            <div className="mb-5 flex flex-wrap gap-2.5">
              {EYE_COLORS.map((c, i) => (
                <Swatch key={c.key} hex={c.hex} on={look.eyeColor === i} onClick={() => set({ eyeColor: i })} label={`${c.key} eyes`} />
              ))}
            </div>
            <Section title="Mouth">
              {MOUTHS.map(([k, name]) => (
                <Tile key={k} on={look.mouth === k} onClick={() => set({ mouth: k })} name={name}>
                  <Avatar look={{ ...look, mouth: k }} crop="head" />
                </Tile>
              ))}
            </Section>
            <Section title="Lips">
              {LIPS.map(([k, name]) => (
                <Tile key={k} on={look.lips === k} onClick={() => set({ lips: k })} name={name}>
                  <Avatar look={{ ...look, lips: k }} crop="head" />
                </Tile>
              ))}
            </Section>
            <Section title="Facial hair">
              {BEARDS.map(([k, name]) => (
                <Tile key={k} on={look.beard === k} onClick={() => set({ beard: k })} name={name}>
                  <Avatar look={{ ...look, beard: k }} crop="head" />
                </Tile>
              ))}
            </Section>
          </>
        )}

        {tab === "FITS" && (
          <>
            <div className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
              <LabelChip on={label === "all"} onClick={() => setLabel("all")}>All labels</LabelChip>
              {LABELS.filter((l) => WARDROBE.some((i) => i.brand === l.key && i.slot !== "shoes")).map((l) => (
                <LabelChip key={l.key} on={label === l.key} onClick={() => setLabel(l.key)}>
                  {l.name}
                </LabelChip>
              ))}
            </div>
            {label !== "all" && (
              <p className="hint mb-4 border-l-2 border-orange pl-3">
                {LABELS.find((l) => l.key === label)?.note}
              </p>
            )}
            {FIT_SLOTS.map(([slot, title]) =>
              fits(slot).length ? (
                <Section key={slot} title={title}>
                  {fits(slot).map((i) => (
                    <Tile key={i.id} on={wearing(i)} onClick={() => wear(i)} name={i.name} brand={labelName(i.brand)}>
                      <Avatar look={{ ...look, [slot]: i.id }} crop={slot === "head" ? "head" : "full"} />
                    </Tile>
                  ))}
                </Section>
              ) : null
            )}
          </>
        )}

        {tab === "KICKS" && (
          <Section title="Shoes">
            {WARDROBE.filter((i) => i.slot === "shoes").map((i) => (
              <Tile key={i.id} on={wearing(i)} onClick={() => wear(i)} name={i.name} brand={labelName(i.brand)}>
                <Avatar look={{ ...look, shoes: i.id }} />
              </Tile>
            ))}
          </Section>
        )}

        {tab === "EXTRAS" && (
          <>
            <p className="label">Glasses</p>
            <Chips list={GLASSES} value={look.glasses} onPick={(glasses) => set({ glasses })} />
            <p className="label mt-5">Ears</p>
            <Chips list={EARS} value={look.ears} onPick={(ears) => set({ ears })} />
            <p className="label mt-5">Neck</p>
            <Chips list={NECKS} value={look.neck} onPick={(neck) => set({ neck })} />
          </>
        )}

        <p className="hint mt-6">
          Labels are Lagos and Nigerian houses. Pieces are drawn in their spirit, not copied from
          their catalogues.
        </p>
      </div>

      <div className="flex flex-none gap-2 border-t border-line bg-ink-2 px-4 py-3">
        <button className="btn flex-1" onClick={() => void save()} disabled={!draft}>
          SAVE LOOK
        </button>
        <button className="btn btn-ghost flex-none" onClick={() => setDraft(null)} disabled={!draft}>
          RESET
        </button>
      </div>
    </div>
  );
}

function Swatch({ hex, on, onClick, label }: { hex: string; on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      className={clsx("h-10 w-10 rounded-full border-2", on ? "border-orange" : "border-line")}
      style={{ background: hex, boxShadow: on ? "0 0 0 3px #0E0B0A inset" : undefined }}
    />
  );
}

function Chips<K extends string>({
  list,
  value,
  onPick,
}: {
  list: ReadonlyArray<readonly [K, string]>;
  value: K;
  onPick: (k: K) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map(([k, name]) => (
        <button
          key={k}
          aria-pressed={value === k}
          onClick={() => onPick(k)}
          className={clsx("tag px-3 py-2 text-[10px]", value === k && "tag-o")}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function LabelChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={clsx(
        "flex-none rounded-full border px-3 py-1.5 font-display text-[11px] font-black",
        on ? "border-orange bg-orange text-ink" : "border-line text-cream"
      )}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <p className="label">{title}</p>
      <Grid>{children}</Grid>
    </>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="mb-5 grid grid-cols-3 gap-2">{children}</div>;
}

function Tile({
  on,
  onClick,
  name,
  brand,
  children,
}: {
  on: boolean;
  onClick: () => void;
  name: string;
  brand?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={clsx(
        // min-w-0: an SVG sized in % counts as 300px wide toward a grid track otherwise
        "flex min-w-0 flex-col items-stretch overflow-hidden rounded-md border bg-ink-2 text-left",
        on ? "border-orange" : "border-line"
      )}
    >
      <span className="block h-24 bg-ink-3 p-1.5">{children}</span>
      <span className="px-2 py-1.5">
        {brand && <span className="block truncate font-mono text-[8px] font-bold uppercase tracking-[0.08em] text-orange">{brand}</span>}
        <span className="block truncate font-display text-[11px] font-black leading-tight">{name}</span>
      </span>
    </button>
  );
}
