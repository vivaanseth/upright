import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
  configurable: true,
});

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  value: vi.fn().mockResolvedValue(undefined),
  configurable: true,
});
