import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const ROTATE_MS = 4000

/**
 * Loading indicator that cycles through silly status messages while a long
 * operation (LLM generation) runs. Messages come from i18n so they follow
 * the app language.
 */
export function FunnyLoader(): JSX.Element {
  const { t } = useTranslation()
  const messages = t('funnyLoading', { returnObjects: true }) as string[]
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
        {messages[index]}
      </span>
    </div>
  )
}
