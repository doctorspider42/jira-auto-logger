import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

/** Stack of open modals so Escape only closes the topmost one. */
const modalStack: symbol[] = []

export function Modal({ title, onClose, children, footer }: ModalProps): JSX.Element {
  const modalId = useRef(Symbol('modal'))

  useEffect(() => {
    const id = modalId.current
    modalStack.push(id)
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && modalStack[modalStack.length - 1] === id) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      modalStack.splice(modalStack.indexOf(id), 1)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}
