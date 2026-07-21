import type { ReactNode } from "react";
import { ShareScrollFix } from "./share-scroll-fix";

/**
 * Layout for the public share routes. Its only job is to release the
 * kiosk scroll lock inherited from globals.css so the page scrolls normally
 * on phones.
 */
export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ShareScrollFix />
      {children}
    </>
  );
}
