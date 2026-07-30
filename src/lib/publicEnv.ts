const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const publicEnv = {
  supabaseUrl,
  supabasePublishableKey,
  isDevelopment: import.meta.env.DEV,
  isConfigured: Boolean(supabaseUrl && supabasePublishableKey),
} as const

