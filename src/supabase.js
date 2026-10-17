import { createClient } from '@supabase/supabase-js'

const supabaseUrl = window.location.origin + '/supabase'
// 直接写死 Key，不依赖任何环境变量，解决线上白屏问题
const supabaseAnonKey = 'sb_publishable_7CTrKLJsiMk2ogb_QncQ0Q_sM94D7jp'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})