import { supabaseAdmin, requireUser } from '../_admin.js';

async function isAdmin(userId) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'admin';
}

const CATEGORIES = ['product', 'payment', 'account', 'other'];

export default async function handler(req, res) {
  try {
    const user = await requireUser(req);
    if (!user) return res.status(401).json({ error: 'Не авторизован' });

    if (req.method === 'GET') {
      const wantAll = req.query.scope === 'all';
      let query = supabaseAdmin.from('support_tickets').select('*').order('created_at', { ascending: false });

      if (wantAll) {
        const admin = await isAdmin(user.id);
        if (!admin) return res.status(403).json({ error: 'Доступ только для администратора' });
      } else {
        query = query.eq('user_id', user.id);
      }

      const { data: tickets, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      if (wantAll && tickets.length) {
        const userIds = [...new Set(tickets.map(t => t.user_id))];
        const { data: profiles } = await supabaseAdmin.from('profiles').select('id, username').in('id', userIds);
        const map = Object.fromEntries((profiles || []).map(p => [p.id, p.username]));
        tickets.forEach(t => { t.username = map[t.user_id] || '—'; });
      }

      return res.status(200).json(tickets || []);
    }

    if (req.method === 'POST') {
      const { subject, category, message } = req.body;
      if (!subject || !subject.trim()) return res.status(400).json({ error: 'Укажите заголовок обращения' });
      if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Некорректное направление обращения' });
      if (!message || !message.trim()) return res.status(400).json({ error: 'Опишите проблему' });

      const { data: ticket, error } = await supabaseAdmin.from('support_tickets')
        .insert({ user_id: user.id, subject: subject.trim().slice(0, 200), category, status: 'new' })
        .select().single();
      if (error) return res.status(500).json({ error: error.message });

      const { error: msgErr } = await supabaseAdmin.from('support_messages').insert({
        ticket_id: ticket.id, sender_id: user.id, sender_role: 'user', body: message.trim()
      });
      if (msgErr) console.error('Ошибка записи первого сообщения обращения:', msgErr);

      return res.status(200).json(ticket);
    }

    return res.status(405).end();
  } catch (e) {
    console.error('Необработанная ошибка в /api/support/tickets:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}
