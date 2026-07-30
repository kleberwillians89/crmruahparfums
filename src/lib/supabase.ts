import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { publicEnv } from './publicEnv'

export const isSupabaseConfigured = publicEnv.isConfigured
export const supabase: SupabaseClient | null = publicEnv.isConfigured
  ? createClient(publicEnv.supabaseUrl!, publicEnv.supabasePublishableKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null
