import { useEffect, useState } from 'react'
import { useLoadingMessages } from '@/theme/useThemeCopy'

const ROTATE_MS = 4000

/**
 * Loading indicator that cycles through silly status messages while a long
 * operation (LLM generation) runs. Messages come from i18n so they follow
 * the app language, and a theme may bring its own set.
 */
export function FunnyLoader(): JSX.Element {
  const messages = useLoadingMessages()
  const [index, setIndex] = useState(() => Math.floor(Math.random() * messages.length))

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((current) => {
        // Random, but never the same message twice in a row.
        let next = Math.floor(Math.random() * (messages.length - 1))
        if (next >= current) next += 1
        return next
      })
    }, ROTATE_MS)
    return () => clearInterval(timer)
  }, [messages.length])

  return (
    <div className="funny-loader" role="status">
      <span className="spinner" />
      <span key={index} className="funny-loader-text">
        {/* Wrapped: a theme switch can shrink the set under the current index. */}
        {messages[index % messages.length]}
      </span>
    </div>
  )
}
