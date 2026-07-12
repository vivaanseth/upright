import { Pulse, Camera, Gear, PersonSimple } from "@phosphor-icons/react";
import type { View } from "../store";

const items: Array<{ view: View; label: string; icon: typeof Pulse }> = [
  { view: "dashboard", label: "Today", icon: Pulse },
  { view: "diagnostics", label: "Camera", icon: Camera },
  { view: "settings", label: "Settings", icon: Gear },
];

export function Sidebar({
  view,
  onChange,
}: {
  view: View;
  onChange: (view: View) => void;
}): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <PersonSimple size={22} weight="bold" />
        </span>
        <span>Posture</span>
      </div>
      <nav aria-label="Main navigation">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              className={`nav-item ${view === item.view ? "active" : ""}`}
              onClick={() => onChange(item.view)}
              aria-current={view === item.view ? "page" : undefined}
            >
              <Icon
                size={19}
                weight={view === item.view ? "fill" : "regular"}
              />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="privacy-note">
        <EyeLock />
        <div>
          <strong>Local by design</strong>
          <span>No image leaves this computer.</span>
        </div>
      </div>
    </aside>
  );
}

function EyeLock(): React.JSX.Element {
  return (
    <span className="privacy-glyph" aria-hidden="true">
      P
    </span>
  );
}
