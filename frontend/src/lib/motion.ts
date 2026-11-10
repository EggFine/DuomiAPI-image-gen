import React, { useRef } from "react"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { ScrollToPlugin } from "gsap/ScrollToPlugin"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP, Flip, ScrollToPlugin)

export const STUDIO_EASE = {
  out: "power3.out",
  expo: "expo.out",
  inOut: "power2.inOut",
  spring: "back.out(1.45)",
  softSpring: "back.out(1.2)",
} as const

// Project-wide GSAP defaults (per official gsap-core skill)
gsap.defaults({
  duration: 0.28,
  ease: STUDIO_EASE.out,
})

// Standard media query conditions for gsap.matchMedia() (per official gsap-core skill)
export const STUDIO_MEDIA = {
  motionOk: "(prefers-reduced-motion: no-preference)",
  reduceMotion: "(prefers-reduced-motion: reduce)",
  desktop: "(min-width: 768px)",
  mobile: "(max-width: 767px)",
} as const

// Reusable curried gsap.utils functions (per official gsap-utils skill)
export const clampPercent = gsap.utils.clamp(0, 100)
export const clampZoom = gsap.utils.clamp(0.25, 8)

export { gsap, Flip, ScrollToPlugin, useGSAP }

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia(STUDIO_MEDIA.reduceMotion).matches
}

function formatAnimatedValue(
  val: number,
  decimals: number,
  prefix: string,
  suffix: string
): string {
  const formatted =
    decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString()
  return `${prefix}${formatted}${suffix}`
}

/**
 * Smoothly interpolates a numeric telemetry value directly on the DOM text node
 * via useGSAP — zero 60fps React re-renders and automatic unmount cleanup.
 */
export const AnimatedNumber: React.FC<{
  value: number
  decimals?: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
}> = ({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 0.55,
  className,
}) => {
  const spanRef = useRef<HTMLSpanElement | null>(null)
  const trackerRef = useRef<{ v: number }>({ v: value })

  useGSAP(
    () => {
      const el = spanRef.current
      if (!el) return

      if (prefersReducedMotion()) {
        trackerRef.current.v = value
        el.textContent = formatAnimatedValue(value, decimals, prefix, suffix)
        return
      }

      gsap.to(trackerRef.current, {
        v: value,
        duration,
        ease: STUDIO_EASE.out,
        overwrite: "auto",
        onUpdate: () => {
          if (spanRef.current) {
            spanRef.current.textContent = formatAnimatedValue(
              trackerRef.current.v,
              decimals,
              prefix,
              suffix
            )
          }
        },
      })
    },
    { dependencies: [value, decimals, prefix, suffix, duration] }
  )

  return React.createElement(
    "span",
    { ref: spanRef, className },
    formatAnimatedValue(trackerRef.current.v, decimals, prefix, suffix)
  )
}
