import { format } from 'date-fns'
import { pl as plLocale, enUS } from 'date-fns/locale'

export const toIsoDate = (date: Date): string => format(date, 'yyyy-MM-dd')

export function formatHours(seconds: number): string {
  const hours = seconds / 3600
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

export function dateLocale(language: string): Locale {
  return language === 'pl' ? plLocale : enUS
}

type Locale = typeof plLocale
