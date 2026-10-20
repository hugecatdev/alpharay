import { useLayoutEffect, useRef, useState } from 'react'

export function useElementWidth<T extends HTMLElement>(fallback = 600) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth || fallback)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fallback])

  return { ref, width }
}
