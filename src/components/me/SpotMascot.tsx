import Mascot, { type MascotState } from "@/components/Mascot";

/**
 * The mascot for an empty state. The mascot is cream, so on the cream day
 * ground it gets the ink edge; that is a CSS rule off <html data-theme>, so
 * the server and the browser render the same markup.
 */
export default function SpotMascot({ state, size = 120, label }: { state: MascotState; size?: number; label: string }) {
  return <Mascot state={state} size={size} label={label} className="[[data-theme=day]_&]:[--rig-edge:#0E0B0A]" />;
}
