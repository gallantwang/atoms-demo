import { createClient } from '@supabase/supabase-js'

const supabaseUrl = window.location.origin + '/supabase'

const supabaseAnonKey = 'sb_publishable_7CTrKLJsiMk2ogb_QncQ0Q_sM94D7jp'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})