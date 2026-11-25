import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Reliable IME composition detector covering macOS, Windows (Microsoft Pinyin / Sogou / Rime),
 * and Linux (IBus / Fcitx5), including keyCode === 229 and "Process" key guards.
 */
export function isComposingEvent(
  e: React.KeyboardEvent | KeyboardEvent
): boolean {
  const native = "nativeEvent" in e ? e.nativeEvent : e
  const ke = native as KeyboardEvent
  return Boolean(
    ke.isComposing ||
      ke.keyCode === 229 ||
      ke.which === 229 ||
      ke.key === "Process"
  )
}

/**
 * IME-safe controlled input hook that prevents Chinese/CJK composition corruption,
 * cursor jumps, and prompt cross-talk when background SSE or external state updates occur.
 *
 * - During active IME composition (`compositionstart` .. `compositionend`), local DOM value
 *   is never overwritten by background re-renders unless `externalRevision` explicitly increments.
 * - `flushValue()` synchronously reads and commits the latest value before form submission.
 */
export function useCompositionInput(
  externalValue: string,
  onCommit: (next: string) => void,
  externalRevision?: number
) {
  const [localValue, setLocalValue] = useState<string>(externalValue)
  const localValueRef = useRef<string>(externalValue)
  const composingRef = useRef<boolean>(false)
  const prevRevisionRef = useRef<number | undefined>(externalRevision)
  const onCommitRef = useRef(onCommit)
  useEffect(() => {
    onCommitRef.current = onCommit
  }, [onCommit])

  useEffect(() => {
    const revChanged =
      externalRevision !== undefined &&
      externalRevision !== prevRevisionRef.current
    prevRevisionRef.current = externalRevision

    if (revChanged) {
      composingRef.current = false
      localValueRef.current = externalValue
      setLocalValue(externalValue)
      return
    }

    if (!composingRef.current && externalValue !== localValueRef.current) {
      localValueRef.current = externalValue
      setLocalValue(externalValue)
    }
  }, [externalValue, externalRevision])

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])

  const handleCompositionEnd = useCallback(
    (
      e: React.CompositionEvent<HTMLTextAreaElement | HTMLInputElement>
    ) => {
      composingRef.current = false
      const val = e.currentTarget.value
      localValueRef.current = val
      setLocalValue(val)
      onCommitRef.current(val)
    },
    []
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const val = e.target.value
      localValueRef.current = val
      setLocalValue(val)
      const nativeComposing = Boolean(
        (e.nativeEvent as InputEvent | undefined)?.isComposing
      )
      if (!composingRef.current && !nativeComposing) {
        onCommitRef.current(val)
      }
    },
    []
  )

  const setProgrammaticValue = useCallback((next: string) => {
    composingRef.current = false
    localValueRef.current = next
    setLocalValue(next)
    onCommitRef.current(next)
  }, [])

  const flushValue = useCallback((): string => {
    const cur = localValueRef.current
    onCommitRef.current(cur)
    return cur
  }, [])

  const isComposingKey = useCallback(
    (e: React.KeyboardEvent | KeyboardEvent): boolean => {
      return composingRef.current || isComposingEvent(e)
    },
    []
  )

  return {
    value: localValue,
    valueRef: localValueRef,
    composingRef,
    handleChange,
    handleCompositionStart,
    handleCompositionEnd,
    setProgrammaticValue,
    flushValue,
    isComposingKey,
  }
}
