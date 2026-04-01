'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type Locale = 'vi' | 'en'

interface I18nContextType {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (vi: string, en: string) => string
}

const I18nContext = createContext<I18nContextType>({
  locale: 'vi', setLocale: () => {}, t: (vi) => vi,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('vi')

  useEffect(() => {
    const saved = localStorage.getItem('ibs-locale') as Locale
    if (saved) setLocale(saved)
  }, [])

  const changeLocale = (l: Locale) => {
    setLocale(l)
    localStorage.setItem('ibs-locale', l)
  }

  const t = (vi: string, en: string) => locale === 'en' ? en : vi

  return (
    <I18nContext.Provider value={{ locale, setLocale: changeLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export const useI18n = () => useContext(I18nContext)
