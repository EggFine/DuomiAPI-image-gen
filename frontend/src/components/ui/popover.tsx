import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { Slot } from "@radix-ui/react-slot"
import { createPortal } from "react-dom"
import {
  gsap,
  prefersReducedMotion,
  STUDIO_EASE,
  useGSAP,
} from "@/lib/motion"
import { cn } from "@/lib/utils"

interface PopoverContextValue {
  open: boolean
  setOpen: (v: boolean) => void
  triggerRef: React.RefObject<HTMLElement | null>
}

const PopoverContext = createContext<PopoverContextValue | null>(null)

export function Popover({
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(next)
      }
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )

  return (
    <PopoverContext.Provider value={{ open, setOpen, triggerRef }}>
      {children}
    </PopoverContext.Provider>
  )
}

export function PopoverTrigger({
  children,
  asChild,
}: {
  children: React.ReactNode
  asChild?: boolean
}) {
  const ctx = useContext(PopoverContext)
  if (!ctx) throw new Error("PopoverTrigger must be used inside Popover")

  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      {...(!asChild ? { type: "button" as const } : {})}
      ref={(node: HTMLElement | null) => {
        ctx.triggerRef.current = node
      }}
      onClick={() => ctx.setOpen(!ctx.open)}
      aria-expanded={ctx.open}
    >
      {children}
    </Comp>
  )
}

export function PopoverContent({
  children,
  className,
  align = "start",
  sideOffset = 10,
  preferredSide = "bottom",
}: {
  children: React.ReactNode
  className?: string
  align?: "start" | "center" | "end"
  sideOffset?: number
  preferredSide?: "bottom" | "top"
}) {
  const ctx = useContext(PopoverContext)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const animatedOpenRef = useRef<boolean>(false)
  const [coords, setCoords] = useState<{
    top: number
    left: number
    side: "top" | "bottom"
    ready: boolean
  }>({ top: 0, left: 0, side: preferredSide, ready: false })

  const updatePosition = useCallback(() => {
    if (!ctx?.open || !ctx.triggerRef.current || !contentRef.current) return
    const trig = ctx.triggerRef.current.getBoundingClientRect()
    const pop = contentRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 14

    let actualSide: "top" | "bottom" = preferredSide
    let top =
      preferredSide === "top"
        ? trig.top - pop.height - sideOffset
        : trig.bottom + sideOffset

    if (
      preferredSide === "bottom" &&
      top + pop.height > vh - pad &&
      trig.top - pop.height - sideOffset >= pad
    ) {
      top = trig.top - pop.height - sideOffset
      actualSide = "top"
    } else if (
      preferredSide === "top" &&
      top < pad &&
      trig.bottom + sideOffset + pop.height <= vh - pad
    ) {
      top = trig.bottom + sideOffset
      actualSide = "bottom"
    }
    top = Math.max(pad, Math.min(vh - pop.height - pad, top))

    let left = trig.left
    if (align === "center") {
      left = trig.left + trig.width / 2 - pop.width / 2
    } else if (align === "end") {
      left = trig.right - pop.width
    }
    left = Math.max(pad, Math.min(vw - pop.width - pad, left))

    setCoords({ top, left, side: actualSide, ready: true })
  }, [ctx?.open, ctx?.triggerRef, align, sideOffset, preferredSide])

  useLayoutEffect(() => {
    if (!ctx?.open) {
      animatedOpenRef.current = false
      setCoords((c) => ({ ...c, ready: false }))
      return
    }
    updatePosition()
    const raf = requestAnimationFrame(updatePosition)
    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
    }
  }, [ctx?.open, updatePosition])

  useGSAP(
    () => {
      if (!ctx?.open || !coords.ready || !contentRef.current) return
      if (animatedOpenRef.current) return
      animatedOpenRef.current = true

      const el = contentRef.current
      if (prefersReducedMotion()) {
        gsap.set(el, { autoAlpha: 1 })
        return
      }

      gsap.fromTo(
        el,
        {
          autoAlpha: 0,
          y: coords.side === "top" ? 5 : -5,
          scale: 0.98,
          transformOrigin:
            coords.side === "top" ? "bottom center" : "top center",
        },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.26,
          ease: STUDIO_EASE.expo,
          clearProps: "transform,visibility",
        }
      )
    },
    { scope: contentRef, dependencies: [ctx?.open, coords.ready, coords.side] }
  )

  useEffect(() => {
    if (!ctx?.open) return
    const handlePointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null
      if (!target) return
      if (contentRef.current?.contains(target)) return
      if (ctx.triggerRef.current?.contains(target)) return
      if (
        (target as HTMLElement).closest?.("[data-radix-popper-content-wrapper]")
      ) {
        return
      }
      ctx.setOpen(false)
    }
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ctx.setOpen(false)
      }
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKey)
    }
  }, [ctx])

  if (!ctx?.open) return null

  return createPortal(
    <div
      ref={contentRef}
      data-studio-popover-portal="true"
      style={{
        position: "fixed",
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        opacity: coords.ready ? 1 : 0,
        zIndex: 60,
      }}
      className={cn(
        "studio-floating-popover rounded-[22px] p-4 text-popover-foreground",
        className
      )}
    >
      {children}
    </div>,
    document.body
  )
}
