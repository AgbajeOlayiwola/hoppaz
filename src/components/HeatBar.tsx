export default function HeatBar({ heat, right }: { heat: number; right?: string }) {
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <span className="font-mono text-[10px] font-bold text-orange tabular-nums">HEAT {heat}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
        <i
          className="block h-full rounded-full bg-gradient-to-r from-orange-ember to-orange"
          style={{ width: `${Math.max(3, heat)}%` }}
        />
      </span>
      {right ? (
        <span className="whitespace-nowrap font-mono text-[10px] font-bold text-dim">{right}</span>
      ) : null}
    </div>
  );
}
