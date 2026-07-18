import {
  Pulse,
  Camera,
  ClockCounterClockwise,
  Gear,
  PersonSimple,
} from "@phosphor-icons/react";
import type { View } from "../store";

const items: Array<{ view: View; label: string; icon: typeof Pulse }> = [
  { view: "dashboard", label: "Today", icon: Pulse },
  { view: "history", label: "History", icon: ClockCounterClockwise },
  { view: "diagnostics", label: "Camera", icon: Camera },
  { view: "settings", label: "Settings", icon: Gear },
];

const headingIds: Record<View, string> = {
  dashboard: "dashboard-title",
  history: "history-title",
  diagnostics: "camera-title",
  settings: "settings-title",
};

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
        <span>Upright</span>
      </div>
      <nav aria-label="Main navigation">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.view}
              className={`nav-item ${view === item.view ? "active" : ""}`}
              onClick={() => {
                onChange(item.view);
                window.requestAnimationFrame(() => {
                  const heading = document.getElementById(
                    headingIds[item.view],
                  );
                  if (!heading) return;
                  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
                  heading.focus();
                });
              }}
              aria-current={view === item.view ? "page" : undefined}
              aria-label={item.label}
              data-tooltip={item.label}
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
      U
    </span>
  );
}
