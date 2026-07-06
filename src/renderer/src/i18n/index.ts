import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import pl from './pl.json'
import en from './en.json'

export function initI18n(language: 'pl' | 'en'): void {
  i18n.use(initReactI18next).init({
    resources: {
      pl: { translation: pl },
      en: { translation: en }
    },
    lng: language,
    fallbackLng: 'en',
    interpolation: {
      // React already escapes rendered strings.
      escapeValue: false
    },
    returnObjects: true
  })
}

export default i18n
