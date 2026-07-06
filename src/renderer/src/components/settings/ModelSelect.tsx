import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const CUSTOM = '__custom__'

interface ModelSelectProps {
  value: string
  /** Known models of the selected backend (kept current by app releases). */
  models: string[]
  /** Adds a "backend default" option represented by an empty value. */
  allowDefault?: boolean
  onChange(model: string): void
}

/**
 * Model picker: a dropdown of known models plus a "custom" entry that
 * reveals a free-text input for anything newer than the hardcoded list.
 */
export function ModelSelect({ value, models, allowDefault, onChange }: ModelSelectProps): JSX.Element {
  const { t } = useTranslation()
  const isKnown = value === '' ? Boolean(allowDefault) : models.includes(value)
  const [customMode, setCustomMode] = useState(!isKnown)

  const selectValue = customMode ? CUSTOM : value

  const onSelect = (next: string): void => {
    if (next === CUSTOM) {
      setCustomMode(true)
      return
    }
    setCustomMode(false)
    onChange(next)
  }

  return (
    <div className="model-select">
      <select value={selectValue} onChange={(e) => onSelect(e.target.value)}>
        {allowDefault && <option value="">{t('settings.cliModelDefault')}</option>}
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
        <option value={CUSTOM}>{t('settings.modelCustom')}</option>
      </select>
      {customMode && (
        <input
          autoFocus
          value={value}
          placeholder={t('settings.modelCustomPlaceholder')}
          onChange={(e) => onChange(e.target.value.trim())}
          spellCheck={false}
        />
      )}
    </div>
  )
}
