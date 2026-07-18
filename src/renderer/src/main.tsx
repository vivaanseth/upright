import React from "react";
import ReactDOM from "react-dom/client";
import { App, ResetDataDialog } from "./App";
import { Nudge } from "./components/Nudge";
import "./styles.css";

const requestedTheme = new URLSearchParams(window.location.search).get("theme");
if (["system", "light", "dark"].includes(requestedTheme ?? "")) {
  document.documentElement.dataset.theme = requestedTheme!;
}

const isNudge = window.location.hash === "#nudge";

class UprightErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean; confirmingReset: boolean; resetError: string | null }
> {
  state = {
    failed: false,
    confirmingReset: false,
    resetError: null as string | null,
  };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="failure-screen" aria-labelledby="runtime-error-title">
        <div>
          <span className="context-label">Unexpected problem</span>
          <h1 id="runtime-error-title">Upright needs to reload.</h1>
          <p>The camera is paused until the interface is ready again.</p>
          <div className="dialog-actions">
            <button
              className="button button-primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
            <button
              className="button button-secondary"
              onClick={() => this.setState({ confirmingReset: true })}
            >
              Reset local data
            </button>
            <button
              className="button button-quiet"
              onClick={() => void window.upright.window.quit()}
            >
              Quit
            </button>
          </div>
          {this.state.confirmingReset && (
            <ResetDataDialog
              error={this.state.resetError}
              onCancel={() =>
                this.setState({ confirmingReset: false, resetError: null })
              }
              onConfirm={async () => {
                try {
                  await window.upright.data.resetAll();
                  window.location.reload();
                } catch (error) {
                  this.setState({
                    resetError:
                      error instanceof Error
                        ? error.message
                        : "Upright could not reset local data.",
                  });
                }
              }}
            />
          )}
        </div>
      </main>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isNudge ? (
      <Nudge />
    ) : (
      <UprightErrorBoundary>
        <App />
      </UprightErrorBoundary>
    )}
  </React.StrictMode>,
);
