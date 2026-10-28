import { useId } from "react";
import "./jarvis-command.css";

export type JarvisState = "idle" | "listening" | "working" | "speaking" | "error";

export interface JarvisCoreProps {
  state: JarvisState;
  onActivate?: () => void;
  interactive?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
}

/** Visual state follows the caller's real microphone, request and playback events. */
export function JarvisCore({ state, onActivate, interactive = false, disabled = false, label = "Dictate a command", className = "" }: JarvisCoreProps) {
  const gradient = `jc-core-${useId().replace(/:/g, "")}`;
  const visual = <>
    <span className="jc-core__aura" />
    <svg className="jc-core__drawing" viewBox="0 0 280 280" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="40" y1="30" x2="240" y2="250" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e5fdff" /><stop offset=".45" stopColor="#7de8f3" /><stop offset="1" stopColor="#2f6e7a" />
        </linearGradient>
      </defs>
      <circle className="jc-core__guide" cx="140" cy="140" r="131" />
      <g className="jc-core__ticks">
        {Array.from({ length: 72 }, (_, i) => <line key={i} x1="140" y1={i % 6 === 0 ? "6" : "11"} x2="140" y2="15" transform={`rotate(${i * 5} 140 140)`} />)}
      </g>
      <g className="jc-core__orbit jc-core__orbit--outer" stroke={`url(#${gradient})`}>
        <path d="M140 18a122 122 0 0 1 116 84M262 140a122 122 0 0 1-84 116M140 262a122 122 0 0 1-116-84M18 140A122 122 0 0 1 102 24" />
        <circle cx="140" cy="18" r="3" className="jc-core__satellite" />
        <circle cx="140" cy="262" r="2" className="jc-core__satellite" />
      </g>
      <circle className="jc-core__guide" cx="140" cy="140" r="111" />
      <g className="jc-core__orbit jc-core__orbit--middle" stroke={`url(#${gradient})`}>
        <circle cx="140" cy="140" r="102" strokeDasharray="120 34 12 28 60 66" />
        <path className="jc-core__fine" d="M140 33a107 107 0 0 1 76 31M247 140a107 107 0 0 1-31 76M140 247a107 107 0 0 1-76-31M33 140a107 107 0 0 1 31-76" />
      </g>
      <circle className="jc-core__guide" cx="140" cy="140" r="89" />
      <g className="jc-core__orbit jc-core__orbit--inner" stroke={`url(#${gradient})`}>
        <circle cx="140" cy="140" r="82" strokeDasharray="86 43" />
        <circle cx="140" cy="140" r="76" strokeDasharray="2 8" className="jc-core__fine" />
      </g>
      <g className="jc-core__crosshair">
        <path d="M140 21v14M140 245v14M21 140h14M245 140h14" />
        <path d="M135 31h10M135 249h10M31 135v10M249 135v10" />
      </g>
      <circle className="jc-core__centre-ring" cx="140" cy="140" r="65" />
      <circle className="jc-core__centre-line" cx="140" cy="140" r="61" />
      <path className="jc-core__brackets" d="M92 113v-9h9M179 104h9v9M92 167v9h9M179 176h9v-9" />
    </svg>
    <span className="jc-core__heart" aria-hidden="true">
      <span className="jc-core__monogram">J</span>
      <span className="jc-core__wave"><i /><i /><i /><i /><i /></span>
    </span>
  </>;

  return <div className={`jc-core jc-core--${state} ${className}`} data-state={state}>
    {interactive ? <button type="button" className="jc-core__surface" onClick={onActivate} disabled={disabled} aria-label={label} aria-pressed={state === "listening"}>{visual}</button>
      : <div className="jc-core__surface" aria-hidden="true">{visual}</div>}
  </div>;
}
