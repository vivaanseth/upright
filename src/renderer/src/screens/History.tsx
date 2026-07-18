import type { SessionSummary } from "../../../shared/contracts";

const duration = (milliseconds: number): string => {
  const minutes = Math.round(milliseconds / 60_000);
  if (milliseconds > 0 && minutes === 0) return "Less than 1 min";
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export function History({
  sessions,
}: {
  sessions: SessionSummary[];
}): React.JSX.Element {
  return (
    <section className="screen history-screen" aria-labelledby="history-title">
      <header className="screen-header">
        <div>
          <span className="context-label">Stored on this computer</span>
          <h1 id="history-title" tabIndex={-1}>
            Recent sessions
          </h1>
        </div>
      </header>
      {sessions.length === 0 ? (
        <div className="history-empty">
          <strong>No completed sessions yet.</strong>
          <p>Completed tracking sessions will appear here automatically.</p>
        </div>
      ) : (
        <div className="history-list" role="list">
          {sessions.map((session) => {
            const classified =
              session.goodMs + session.cautionMs + session.poorMs;
            const good = classified
              ? Math.round((session.goodMs / classified) * 100)
              : 0;
            return (
              <article className="history-row" key={session.id} role="listitem">
                <div>
                  <strong>
                    <time dateTime={session.startedAt}>
                      {new Date(session.startedAt).toLocaleDateString(
                        undefined,
                        {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        },
                      )}
                    </time>
                  </strong>
                  <span>
                    {duration(
                      session.trackedMs + session.unknownMs + session.awayMs,
                    )}
                  </span>
                </div>
                <div>
                  <strong>{good}%</strong>
                  <span>comfortable</span>
                </div>
                <div>
                  <strong>{session.reminderCount}</strong>
                  <span>
                    {session.reminderCount === 1 ? "nudge" : "nudges"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
