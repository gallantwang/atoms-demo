import { createClient } from '@supabase/supabase-js'

// 暂时改回真实 URL 用于本地测试
const supabaseUrl = 'https://vzkckffanbcopzugmdkc.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})