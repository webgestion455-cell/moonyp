import { forwardRef } from "react";

/**
 * Honeypot field — invisible to humans, attractive to bots.
 * Use `name` ("website", "url", etc.) that bots commonly auto-fill.
 * Validate server/client side: if value is non-empty, treat the submission as a bot.
 *
 * Usage:
 *   const hp = useRef<HTMLInputElement>(null);
 *   ...
 *   if (hp.current?.value) return; // silently drop
 *   <Honeypot ref={hp} />
 */
export const Honeypot = forwardRef<HTMLInputElement, { name?: string }>(function Honeypot(
  { name = "website" },
  ref,
) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-9999px",
        top: "auto",
        width: 1,
        height: 1,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      }}
    >
      <label htmlFor={`hp-${name}`}>Leave this field empty</label>
      <input
        ref={ref}
        id={`hp-${name}`}
        name={name}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
      />
    </div>
  );
});
