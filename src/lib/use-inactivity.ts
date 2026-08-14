import { useEffect, useRef } from "react";

const EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"];

export function useInactivityLogout(onTimeout: () => void, timeoutMs = 15 * 60 * 1000) {
  const cb = useRef(onTimeout);
  cb.current = onTimeout;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), timeoutMs);
    };
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [timeoutMs]);
}
