"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/useSession";
import { useToast } from "@/lib/store";
import { AREAS } from "@/lib/geo";
import { VIBES } from "@/lib/brand";
import { parseFlyerCaption } from "@/lib/parseCaption";

export default function DropPage() {
  const router = useRouter();
  const { userId } = useSession();
  const say = useToast((s) => s.say);

  const [igUrl, setIgUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [area, setArea] = useState(AREAS[0].name);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("21:00");
  const [vibe, setVibe] = useState<string>(VIBES[0]);
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const readCaption = () => {
    if (!caption.trim()) {
      say("PASTE A CAPTION FIRST");
      return;
    }
    const got = parseFlyerCaption(caption);
    let hits = 0;
    if (got.title) {
      setTitle(got.title);
      hits++;
    }
    if (got.venue) {
      setVenue(got.venue);
      hits++;
    }
    if (got.area) {
      setArea(got.area);
      hits++;
    }
    if (got.time) {
      setTime(got.time);
      hits++;
    }
    if (got.date) {
      setDate(got.date);
      hits++;
    }
    if (got.price !== undefined) {
      setPrice(String(got.price));
      hits++;
    }
    if (got.vibe) {
      setVibe(got.vibe);
      hits++;
    }
    say(hits ? `PULLED ${hits} FIELDS OUT OF THE CAPTION` : "COULD NOT READ THAT ONE, FILL IT IN");
  };

  const submit = async () => {
    if (!title.trim() || !venue.trim()) {
      say("NEEDS A NAME AND A VENUE");
      return;
    }
    const a = AREAS.find((x) => x.name === area)!;
    const sb = getSupabase();
    if (!sb || !userId) {
      say("NOT CONNECTED · CANNOT SAVE THIS YET");
      return;
    }
    setSaving(true);
    // Lagos is UTC+1 year round, so the local wall clock maps straight through.
    const startsAt = new Date(`${date}T${time}:00+01:00`).toISOString();
    const { error } = await sb.from("events").insert({
      title: title.trim(),
      venue_name: venue.trim(),
      area: a.name,
      // The venue centroid is the area until someone pins it properly. An
      // admin fixes the exact point when approving.
      geog: `SRID=4326;POINT(${a.lng} ${a.lat})`,
      starts_at: startsAt,
      price_naira: Number(price.replace(/\D/g, "") || 0),
      vibe,
      ig_url: igUrl.trim() || null,
    });
    setSaving(false);
    if (error) {
      console.warn("[hoppaz] drop failed:", error.message);
      say("COULD NOT SAVE THAT, TRY AGAIN");
      return;
    }
    say("DROPPED · WAITING ON AN ADMIN", "violet");
    router.push("/");
  };

  return (
    <div className="h-full overflow-y-auto px-4 pb-8">
      <header className="pad-top pb-3">
        <h1 className="font-display text-2xl font-black leading-none">Drop a flyer</h1>
        <p className="seclabel mt-1.5">Paste the caption or fill it in</p>
      </header>

      <p className="mb-4 border-l-2 border-violet pl-3 font-mono text-[11px] leading-relaxed text-[#A89588]">
        Paste the caption from an Instagram flyer and this pulls out the venue, date, time and
        price. The link is kept so Hoppers can go back to the post.
      </p>

      <label className="mb-3 block">
        <span className="label">Instagram post link</span>
        <input
          type="url"
          value={igUrl}
          onChange={(e) => setIgUrl(e.target.value)}
          placeholder="instagram.com/p/..."
          autoComplete="off"
        />
      </label>

      <label className="mb-3 block">
        <span className="label">Paste the caption</span>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={5}
          className="font-mono text-[12.5px] leading-relaxed"
          placeholder={"AMAPIANO SUNDOWN\nSunday 11 Oct, 6pm till late\nBature Brewery, Lekki Phase 1\n₦5,000 at the gate"}
        />
      </label>

      <button className="btn btn-ghost mb-5 w-full" onClick={readCaption}>
        READ THE CAPTION
      </button>

      <div className="mb-5 h-px bg-line" />

      <label className="mb-3 block">
        <span className="label">Party name</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
      </label>
      <label className="mb-3 block">
        <span className="label">Venue</span>
        <input value={venue} onChange={(e) => setVenue(e.target.value)} autoComplete="off" />
      </label>

      <div className="mb-3 flex gap-2.5">
        <label className="min-w-0 flex-1">
          <span className="label">Area</span>
          <select value={area} onChange={(e) => setArea(e.target.value)}>
            {AREAS.map((a) => (
              <option key={a.name}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1">
          <span className="label">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="mb-3 flex gap-2.5">
        <label className="min-w-0 flex-1">
          <span className="label">Start</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="min-w-0 flex-1">
          <span className="label">Gate fee ₦</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="numeric"
            placeholder="5000"
            autoComplete="off"
          />
        </label>
      </div>

      <label className="mb-5 block">
        <span className="label">Vibe</span>
        <select value={vibe} onChange={(e) => setVibe(e.target.value)}>
          {VIBES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>

      <button className="btn w-full" onClick={submit} disabled={saving}>
        {saving ? "DROPPING…" : "DROP IT ON THE MAP"}
      </button>
      <p className="hint mt-2.5">
        Nothing goes live on its own. An admin clears it first, then the whole community sees it and
        you get the Flyer drop badge.
      </p>
    </div>
  );
}
