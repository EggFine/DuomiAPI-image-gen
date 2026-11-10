import React, { useEffect, useRef, useState } from "react"
import gsap from "gsap"
import { Flip } from "gsap/Flip"
import { useGSAP } from "@gsap/react"

gsap.registerPlugin(useGSAP, Flip)

export { gsap, Flip, useGSAP }

export const STUDIO_EASE = {
  out: "power3.out",
  expo: "expo.out",
  inOut: "power2.inOut",
  spring: "back.out(1.45)",
  softSpring: "back.out(1.2)",
} as const

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Smoothly interpolates a numeric telemetry value like a precision instrument meter.
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
  const [display, setDisplay] = useState<number>(value)
  const trackerRef = useRef<{ v: number }>({ v: value })

  useEffect(() => {
    if (prefersReducedMotion()) {
      trackerRef.current.v = value
      setDisplay(value)
      return
    }
    const tween = gsap.to(trackerRef.current, {
      v: value,
      duration,
      ease: STUDIO_EASE.out,
      onUpdate: () => {
        setDisplay(trackerRef.current.v)
      },
    })
    return () => {
      tween.kill()
    }
  }, [value, duration])

  const formatted =
    decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString()

  return React.createElement(
    "span",
    { className },
    `${prefix}${formatted}${suffix}`
  )
}
