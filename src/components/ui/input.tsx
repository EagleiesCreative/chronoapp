import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, onWheel, ...props }: React.ComponentProps<"input">) {
  // A focused <input type="number"> changes its value when the wheel/trackpad
  // scrolls over it. Scrolling the admin panel with the pointer over a field
  // silently decremented values (e.g. a 500 price became 497, 20000 → 19995).
  // Blur on wheel so scrolling never edits a number, while arrows/typing still work.
  const handleWheel = React.useCallback(
    (e: React.WheelEvent<HTMLInputElement>) => {
      if (type === "number" && document.activeElement === e.currentTarget) {
        e.currentTarget.blur();
      }
      onWheel?.(e);
    },
    [type, onWheel]
  );

  return (
    <input
      type={type}
      onWheel={handleWheel}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
