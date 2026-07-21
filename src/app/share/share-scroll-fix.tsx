"use client";

import { useEffect } from "react";

/**
 * The booth app runs as a fullscreen kiosk, so globals.css pins
 * `html, body { overflow: hidden; height: 100vh }`.
 *
 * The public share page is served by the same Next.js app and inherited that
 * lock, which made it impossible to scroll on a phone — everything below the
 * fold (the individual photos and the Live Video tab) was unreachable.
 *
 * This adds an opt-out class for share routes only, and removes it on unmount so
 * the kiosk screens are unaffected.
 */
export function ShareScrollFix() {
  useEffect(() => {
    const targets = [document.documentElement, document.body];
    targets.forEach((el) => el.classList.add("allow-scroll"));

    return () => {
      targets.forEach((el) => el.classList.remove("allow-scroll"));
    };
  }, []);

  return null;
}
