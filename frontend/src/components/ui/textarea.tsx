import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[96px] w-full rounded-2xl bg-foreground/[0.045] dark:bg-white/[0.055] px-3.5 py-2.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground/75 focus-visible:bg-foreground/[0.065] dark:focus-visible:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export { Textarea }
