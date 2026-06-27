// Feature flags — centralized toggle for progressive rollout
// All flags default to OFF. Enable via environment variables or DB config.

export const FEATURE_FLAGS = {
  BOM_REVISION_CASCADE: process.env.NEXT_PUBLIC_FF_BOM_CASCADE === 'true',
} as const

export type FeatureFlag = keyof typeof FEATURE_FLAGS

export function isEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag]
}
