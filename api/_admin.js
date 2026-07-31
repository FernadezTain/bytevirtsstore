import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function requireAdmin(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabaseAdmin
    .from('profiles').select('role').eq('id', user.id).single();
  return profile?.role === 'admin' ? user : null;
}

export async function requireUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}
