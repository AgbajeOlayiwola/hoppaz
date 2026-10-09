"use client";

import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { useToast } from "@/lib/store";

/**
 * The staff controls for street box spawning (supabase/spawning.sql): the rules
 * that decide when and where boxes appear, the spots they appear at, the areas
 * that never get boxes, and the boxes that are live right now.
 * The admin page owns the data and the POST helper; this file only draws it.
 */

type RewardItem = {
  type: "xp" | "badge" | "collectible";
  title: string;
  description?: string;
  xp_amount?: number;
  weight?: number;
  badge_key?: string;
  collectible_key?: string;
  quantity?: number;
};

export type SpawnRule = {
  id: string;
  name: string;
  active: boolean;
  areas: string[] | null;
  kinds: string[];
  days: number[];
  start_minute: number;
  end_minute: number;
  every_minutes: number;
  boxes_per_wave: number;
  lifetime_minutes: number;
  max_claims: number;
  radius_m: number;
  night_from_minute: number;
  night_until_minute: number;
  reward_model: "fixed" | "random";
  rewards: RewardItem[];
  last_run_at: string | null;
};

export type Spawner = {
  summary: {
    points_total: number;
    points_active: number;
    night_safe_active: number;
    zones_active: number;
    live_spawn: number;
    live_welcome: number;
    rules_active: number;
  } | null;
  rules: SpawnRule[];
  zones: { id: string; name: string; reason: string; active: boolean; source: "osm" | "staff" }[];
  live: {
    id: string;
    title: string;
    area: string | null;
    kind: "spawn" | "welcome";
    closes_at: string;
    claimed_count: number;
    max_claims: number | null;
  }[];
  areas: string[];
  /** Set when the spawner tables are missing: spawning.sql has not been run on this database. */
  error?: string;
};

export const emptySpawner: Spawner = { summary: null, rules: [], zones: [], live: [], areas: [] };

type Act = (body: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

const KINDS = [
  ["street", "Street"],
  ["park", "Park"],
  ["run", "Run route"],
  ["beach", "Beach"],
  ["landmark", "Landmark"],
  ["market", "Market"],
  ["venue", "Venue"],
] as const;
const DAYS = [
  ["Mon", 1],
  ["Tue", 2],
  ["Wed", 3],
  ["Thu", 4],
  ["Fri", 5],
  ["Sat", 6],
  ["Sun", 7],
] as const;
const DEFAULT_REWARDS: RewardItem[] = [
  { type: "xp", title: "Street find", xp_amount: 30, weight: 80 },
  { type: "xp", title: "Lucky find", xp_amount: 100, weight: 18 },
  { type: "xp", title: "Jackpot", xp_amount: 300, weight: 2 },
];
/** Checkboxes sit inside the global full-width input style, so shrink them back. */
const CHECK = "h-4 w-4 flex-none cursor-pointer p-0 accent-orange";
const SUMMARY = "cursor-pointer py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-orange";

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const span = (n: number) => (n % 1440 === 0 ? `${n / 1440} d` : n % 60 === 0 ? `${n / 60} h` : `${n} min`);
const boxes = (n: number) => `${n} ${n === 1 ? "box" : "boxes"}`;
const lagosTime = (iso: string, date = false) =>
  new Date(iso).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    ...(date ? { day: "numeric", month: "short" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

// The Lagos calendar day of a moment, to tell "closes tonight" from "closes tomorrow" (a welcome box lasts 24 hours).
const lagosDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

function daysText(days: number[]) {
  const d = [...days].sort((a, b) => a - b).join();
  if (d === "1,2,3,4,5,6,7") return "Every day";
  if (d === "1,2,3,4,5") return "Weekdays";
  if (d === "6,7") return "Weekends";
  return [...days].sort((a, b) => a - b).map((n) => DAYS[n - 1][0]).join(", ");
}

function ruleLine(r: SpawnRule) {
  const window = r.start_minute === r.end_minute ? "All day" : `${hhmm(r.start_minute)} to ${hhmm(r.end_minute)}`;
  return `${window} · every ${span(r.every_minutes)} · ${boxes(r.boxes_per_wave)} · ${span(r.lifetime_minutes)} · first ${r.max_claims}`;
}

function ruleDetail(r: SpawnRule) {
  const kinds = r.kinds.length === KINDS.length ? "all spot kinds" : r.kinds.join(", ");
  const where = r.areas?.length ? r.areas.join(", ") : "all areas";
  return `${daysText(r.days)} · ${kinds} · ${where} · ${r.last_run_at ? `last run ${lagosTime(r.last_run_at, true)}` : "never run"}`;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mb-4 p-3">
      <h2 className="seclabel mb-3 text-orange">{title}</h2>
      {children}
    </section>
  );
}

function Line({ title, sub, tag, children }: { title: string; sub: string; tag?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold">
          {title}
          {tag && <span className="tag tag-v ml-2 align-middle">{tag}</span>}
        </p>
        <p className="hint">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function Switch({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="chip" disabled={disabled} onClick={onClick}>
      {on ? "ON" : "OFF"}
    </button>
  );
}

export default function SpawnerSection({ spawner, act, busy, loading = false }: { spawner: Spawner; act: Act; busy: boolean; loading?: boolean }) {
  const say = useToast((s) => s.say);
  const { summary, rules, zones, live, areas } = spawner;

  // Before the first read the lists are empty defaults, which would read as "No rules yet" and invite a duplicate.
  if (loading) {
    return (
      <Card title="Box spawner">
        <p className="hint">Loading the spawner…</p>
      </Card>
    );
  }

  if (spawner.error) {
    return (
      <Card title="Box spawner">
        <p className="hint">
          The spawner is not set up on this database ({spawner.error}). Run supabase/spawning.sql, then refresh.
        </p>
      </Card>
    );
  }

  const toggleRule = async (r: SpawnRule) => {
    if (await act({ action: "toggle_spawn_rule", id: r.id, active: !r.active })) say(r.active ? "RULE OFF" : "RULE ON", "violet");
  };
  const spawnNow = async (r: SpawnRule) => {
    const res = await act({ action: "spawn_now", rule_id: r.id });
    if (!res) return;
    const n = Number(res.spawned) || 0;
    if (n) say(`${n} ${n === 1 ? "BOX" : "BOXES"} SPAWNED`, "violet");
    else say("NOTHING SPAWNED. NO FREE SPOTS FOR THIS RULE");
  };
  const toggleZone = async (id: string, active: boolean) => {
    if (await act({ action: "toggle_no_spawn_zone", id, active })) say(active ? "AREA BLOCKED" : "AREA OPEN AGAIN", "violet");
  };
  const endBox = async (id: string) => {
    if (await act({ action: "end_box", id })) say("BOX ENDED", "violet");
  };

  const welcomeShown = live.filter((b) => b.kind === "welcome").length;
  const welcomeLive = summary?.live_welcome ?? welcomeShown;

  return (
    <>
      <Card title="Box spawner">
        {summary && (
          <p className="hint">
            <b className="text-cream">{summary.points_active}</b> spots on ({summary.night_safe_active} safe after 21:00) ·{" "}
            <b className="text-cream">{summary.zones_active}</b> blocked {summary.zones_active === 1 ? "area" : "areas"} · <b className="text-cream">{summary.live_spawn}</b> street boxes live ·{" "}
            <b className="text-cream">{summary.live_welcome}</b> welcome boxes live · <b className="text-cream">{summary.rules_active}</b>{" "}
            {summary.rules_active === 1 ? "rule" : "rules"} on
          </p>
        )}
        {summary?.points_total === 0 && (
          <p className="hint mt-1 text-danfo">No spots yet. Run supabase/spawn_points_lagos.sql or add one below.</p>
        )}
        <div className="mt-2">
          {rules.map((r) => (
            <div key={r.id} className="border-t border-line py-2 first:border-0">
              <p className="font-display text-sm font-bold">{r.name}</p>
              <p className="hint">{ruleLine(r)}</p>
              <p className="hint">{ruleDetail(r)}</p>
              <div className="mt-2 flex items-center gap-2">
                <Switch on={r.active} label={`${r.name} is ${r.active ? "on" : "off"}`} disabled={busy} onClick={() => void toggleRule(r)} />
                <button className="btn flex-1 px-3 py-2" disabled={busy} onClick={() => void spawnNow(r)}>
                  SPAWN NOW
                </button>
              </div>
              <details className="mt-1">
                <summary className={SUMMARY}>Edit rule</summary>
                <RuleForm rule={r} areas={areas} act={act} busy={busy} />
              </details>
            </div>
          ))}
          {!rules.length && <p className="hint">No rules yet.</p>}
        </div>
        <NewRule areas={areas} act={act} busy={busy} />
      </Card>

      <Card title="Spawn spots and blocked areas">
        <SpotForm act={act} busy={busy} />
        <ZoneForm act={act} busy={busy} />
        <div className="mt-3 max-h-72 overflow-y-auto">
          {zones.map((z) => (
            <Line key={z.id} title={z.name} sub={`${z.reason || "No reason noted"} · ${z.source === "osm" ? "OpenStreetMap" : "Staff"}`}>
              <Switch on={z.active} label={`${z.name} is ${z.active ? "blocked" : "open"}`} disabled={busy} onClick={() => void toggleZone(z.id, !z.active)} />
            </Line>
          ))}
          {!zones.length && <p className="hint">No blocked areas yet.</p>}
          {zones.length >= 200 && <p className="hint pt-2">Showing the first 200, staff areas first.</p>}
        </div>
      </Card>

      <Card title="Live street boxes">
        {live.map((b) => (
          <Line
            key={b.id}
            title={b.title}
            tag={b.kind === "welcome" ? "WELCOME" : undefined}
            sub={`${b.claimed_count} of ${b.max_claims ?? "any"} · ${b.area ?? "Lagos"} · closes ${lagosTime(b.closes_at, lagosDay(b.closes_at) !== lagosDay(new Date().toISOString()))}`}
          >
            <button className="btn btn-ghost px-3 py-2" disabled={busy} onClick={() => void endBox(b.id)}>
              END NOW
            </button>
          </Line>
        ))}
        {!live.length && <p className="hint">No street or welcome boxes live.</p>}
        {welcomeLive > welcomeShown && <p className="hint pt-2">Showing {welcomeShown} of {welcomeLive} welcome boxes.</p>}
      </Card>
    </>
  );
}

function NewRule({ areas, act, busy }: { areas: string[]; act: Act; busy: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [round, setRound] = useState(0);
  return (
    <details ref={ref} className="mt-3 border-t border-line pt-2">
      <summary className={SUMMARY}>New rule</summary>
      <RuleForm
        key={round}
        areas={areas}
        act={act}
        busy={busy}
        onSaved={() => {
          setRound((n) => n + 1);
          if (ref.current) ref.current.open = false;
        }}
      />
    </details>
  );
}

type RewardRow = { id: number; type: RewardItem["type"]; title: string; xp: string; weight: string; key: string; keep: Pick<RewardItem, "description" | "quantity"> };

function RuleForm({ rule, areas, act, busy, onSaved }: { rule?: SpawnRule; areas: string[]; act: Act; busy: boolean; onSaved?: () => void }) {
  const say = useToast((s) => s.say);
  const seq = useRef(1000);
  const [kinds, setKinds] = useState<string[]>(rule?.kinds ?? KINDS.map(([k]) => k));
  const [days, setDays] = useState<number[]>(rule?.days ?? [1, 2, 3, 4, 5, 6, 7]);
  const [picked, setPicked] = useState<string[]>(rule?.areas ?? []);
  const [rewards, setRewards] = useState<RewardRow[]>(() =>
    (rule?.rewards ?? DEFAULT_REWARDS).map((r, i) => ({
      id: i,
      type: r.type,
      title: r.title,
      xp: String(r.xp_amount ?? 0),
      weight: String(r.weight ?? 1),
      key: r.badge_key ?? r.collectible_key ?? "",
      keep: { description: r.description, quantity: r.quantity },
    })),
  );
  const flip = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const patch = (id: number, change: Partial<RewardRow>) => setRewards((rows) => rows.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await act({
      action: "save_spawn_rule",
      id: rule?.id,
      name: f.get("name"),
      active: rule ? undefined : f.get("active") === "on",
      areas: picked.length ? picked : null,
      kinds,
      days,
      start: f.get("start"),
      end: f.get("end"),
      every_minutes: f.get("every"),
      boxes_per_wave: f.get("wave"),
      lifetime_minutes: f.get("life"),
      max_claims: f.get("first"),
      radius_m: f.get("radius"),
      night_from: f.get("night_from"),
      night_until: f.get("night_until"),
      reward_model: f.get("reward_model"),
      rewards: rewards.map((r) => ({
        ...r.keep,
        type: r.type,
        title: r.title,
        xp_amount: r.xp,
        weight: r.weight,
        ...(r.type === "badge" ? { badge_key: r.key } : r.type === "collectible" ? { collectible_key: r.key } : {}),
      })),
    });
    if (res) {
      say(rule ? "RULE SAVED" : "RULE ADDED", "violet");
      onSaved?.();
    }
  };

  return (
    <form className="mt-2 grid gap-2" onSubmit={(e) => void submit(e)}>
      <input name="name" required minLength={2} maxLength={80} defaultValue={rule?.name} placeholder="Rule name" aria-label="Rule name" />
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          Starts
          <input name="start" type="time" required defaultValue={hhmm(rule?.start_minute ?? 420)} />
        </label>
        <label className="label">
          Ends
          <input name="end" type="time" required defaultValue={hhmm(rule?.end_minute ?? 1260)} />
        </label>
      </div>
      <p className="hint">Lagos time. Boxes only spawn inside this window. Same start and end means all day.</p>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Days">
        {DAYS.map(([label, n]) => (
          <button key={n} type="button" aria-pressed={days.includes(n)} className="chip px-0" onClick={() => setDays((d) => flip(d, n))}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          Every (min)
          <input name="every" type="number" min="5" max="1440" required defaultValue={rule?.every_minutes ?? 30} />
        </label>
        <label className="label">
          Boxes per wave
          <input name="wave" type="number" min="1" max="50" required defaultValue={rule?.boxes_per_wave ?? 3} />
        </label>
        <label className="label">
          Box life (min)
          <input name="life" type="number" min="5" max="1440" required defaultValue={rule?.lifetime_minutes ?? 30} />
        </label>
        <label className="label">
          First to open
          <input name="first" type="number" min="1" max="1000" required defaultValue={rule?.max_claims ?? 5} />
        </label>
        <label className="label">
          Radius (m)
          <input name="radius" type="number" min="25" max="500" required defaultValue={rule?.radius_m ?? 80} />
        </label>
        <label className="label">
          Reward
          <select name="reward_model" defaultValue={rule?.reward_model ?? "random"}>
            <option value="random">Random</option>
            <option value="fixed">Fixed</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="label">
          Night starts
          <input name="night_from" type="time" required defaultValue={hhmm(rule?.night_from_minute ?? 1260)} />
        </label>
        <label className="label">
          Night ends
          <input name="night_until" type="time" required defaultValue={hhmm(rule?.night_until_minute ?? 360)} />
        </label>
      </div>
      <p className="hint">At night only spots marked safe after 21:00 are used. Same time twice turns the night limit off.</p>
      <fieldset>
        <legend className="label">Spot kinds</legend>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {KINDS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className={CHECK} checked={kinds.includes(k)} onChange={() => setKinds((list) => flip(list, k))} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="label">Areas</legend>
        <div className="flex flex-wrap gap-1">
          {areas.map((a) => (
            <button key={a} type="button" aria-pressed={picked.includes(a)} className="chip" onClick={() => setPicked((list) => flip(list, a))}>
              {a}
            </button>
          ))}
        </div>
        <p className="hint mt-1">None picked means everywhere.</p>
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="label">Rewards</legend>
        {rewards.map((r) => (
          <div key={r.id} className="grid gap-2 rounded border border-line p-2">
            <div className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
              <select
                aria-label="Reward type"
                value={r.type}
                onChange={(e) => patch(r.id, { type: e.target.value as RewardItem["type"] })}
              >
                <option value="xp">XP</option>
                <option value="badge">Badge</option>
                <option value="collectible">Collectible</option>
              </select>
              <input aria-label="Reward title" required maxLength={100} value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} placeholder="Title people see" />
              <button
                type="button"
                className="btn btn-ghost px-2 py-2"
                aria-label="Remove reward"
                disabled={rewards.length < 2}
                onClick={() => setRewards((rows) => rows.filter((x) => x.id !== r.id))}
              >
                <X size={14} />
              </button>
            </div>
            <div className={`grid gap-2 ${r.type === "xp" ? "grid-cols-2" : "grid-cols-3"}`}>
              <label className="label">
                XP
                <input type="number" min={r.type === "xp" ? 1 : 0} max="10000" required value={r.xp} onChange={(e) => patch(r.id, { xp: e.target.value })} />
              </label>
              <label className="label">
                Weight
                <input type="number" min="0.01" max="10000" step="any" required value={r.weight} onChange={(e) => patch(r.id, { weight: e.target.value })} />
              </label>
              {r.type !== "xp" && (
                <label className="label">
                  {r.type === "badge" ? "Badge key" : "Item key"}
                  <input required maxLength={60} value={r.key} onChange={(e) => patch(r.id, { key: e.target.value })} placeholder={r.type === "badge" ? "night-owl" : "jollof-pot"} />
                </label>
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-ghost"
          disabled={rewards.length >= 20}
          onClick={() => setRewards((rows) => [...rows, { id: seq.current++, type: "xp", title: "", xp: "30", weight: "1", key: "", keep: {} }])}
        >
          <Plus size={14} /> ADD A REWARD
        </button>
        <p className="hint">Weight is the share of draws: 80, 18 and 2 pay out 80%, 18% and 2% of the time. A fixed rule pays one reward, so keep one row.</p>
      </fieldset>
      {!rule && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" className={CHECK} />
          Switch it on after saving
        </label>
      )}
      <button className="btn" disabled={busy || !kinds.length || !days.length}>
        {rule ? "SAVE RULE" : "ADD RULE"}
      </button>
    </form>
  );
}

function SpotForm({ act, busy }: { act: Act; busy: boolean }) {
  const say = useToast((s) => s.say);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await act({ action: "add_spawn_point", name: f.get("name"), kind: f.get("kind"), lat: f.get("lat"), lng: f.get("lng"), night_safe: f.get("night_safe") === "on" });
    if (!res) return;
    const area = (res.spot as { area: string | null } | undefined)?.area;
    say(`SPOT ADDED · ${area ? area.toUpperCase() : "NO AREA WITHIN 5 KM"}`, "violet");
    form.reset();
  };
  return (
    <form className="grid gap-2" onSubmit={(e) => void submit(e)}>
      <p className="label mb-0">Add a spawn spot</p>
      <input name="name" required minLength={2} maxLength={100} placeholder="Spot name" aria-label="Spot name" />
      <select name="kind" defaultValue="street" aria-label="Spot kind">
        {KINDS.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input name="lat" type="number" step="any" min="6.3" max="6.8" required placeholder="Latitude" aria-label="Latitude" />
        <input name="lng" type="number" step="any" min="3.05" max="3.95" required placeholder="Longitude" aria-label="Longitude" />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="night_safe" className={CHECK} />
        Safe after 21:00 (lit, busy, people around)
      </label>
      <button className="btn" disabled={busy}>
        ADD SPOT
      </button>
    </form>
  );
}

function ZoneForm({ act, busy }: { act: Act; busy: boolean }) {
  const say = useToast((s) => s.say);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const res = await act({ action: "add_no_spawn_zone", name: f.get("name"), reason: f.get("reason"), lat: f.get("lat"), lng: f.get("lng"), radius_m: f.get("radius") });
    if (!res) return;
    say("AREA BLOCKED", "violet");
    form.reset();
  };
  return (
    <form className="mt-4 grid gap-2 border-t border-line pt-3" onSubmit={(e) => void submit(e)}>
      <p className="label mb-0">Block an area</p>
      <p className="hint">No boxes spawn inside it: water, military, estates, anywhere unsafe.</p>
      <input name="name" required minLength={2} maxLength={100} placeholder="Area name" aria-label="Area name" />
      <input name="reason" maxLength={200} placeholder="Why (optional)" aria-label="Reason" />
      <div className="grid grid-cols-2 gap-2">
        <input name="lat" type="number" step="any" min="6.3" max="6.8" required placeholder="Latitude" aria-label="Latitude" />
        <input name="lng" type="number" step="any" min="3.05" max="3.95" required placeholder="Longitude" aria-label="Longitude" />
      </div>
      <label className="label">
        Radius (m)
        <input name="radius" type="number" min="25" max="5000" required defaultValue="300" />
      </label>
      <button className="btn" disabled={busy}>
        BLOCK THIS AREA
      </button>
    </form>
  );
}
