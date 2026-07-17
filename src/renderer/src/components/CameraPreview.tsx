import { useEffect, useRef } from "react";
import { CameraSlash } from "@phosphor-icons/react";

export function CameraPreview({
  stream,
  compact = false,
}: {
  stream: MediaStream | null;
  compact?: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    if (stream) void ref.current.play().catch(() => undefined);
  }, [stream]);

  return (
    <div
      className={`camera-preview ${compact ? "camera-preview-compact" : ""}`}
    >
      {stream ? (
        <>
          <video
            ref={ref}
            autoPlay
            muted
            playsInline
            aria-label="Mirrored camera preview"
          />
          <div className="framing-guide" aria-hidden="true">
            <span className="guide-head" />
            <span className="guide-shoulders" />
          </div>
          <span className="preview-label">Preview stays on this screen</span>
        </>
      ) : (
        <div className="camera-empty">
          <CameraSlash size={28} />
          <span>Camera preview is off</span>
        </div>
      )}
    </div>
  );
}
