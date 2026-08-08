import { supabaseAdmin, requireUser, requireAdmin } from '../../lib/_admin.js';

async function isAdmin(userId) {
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'admin';
}

const CATEGORIES = ['product', 'payment', 'account', 'other'];

export default async function handler(req, res) {
  try {
    const pathOnly = req.url.split('?')[0];
    const parts = pathOnly.split('/').filter(Boolean); // ['api','support','tickets']
    const route = parts[parts.length - 1];

    if (route === 'tickets') return handleTickets(req, res);
    if (route === 'messages') return handleMessages(req, res);
    if (route === 'status') return handleStatus(req, res);
    if (route === 'ai-chat') return handleAiChat(req, res);

    return res.status(404).json({ error: 'Маршрут не найден' });
  } catch (e) {
    console.error('Необработанная ошибка в /api/support:', e);
    return res.status(500).json({ error: e.message || 'Внутренняя ошибка сервера' });
  }
}

/* ---------- Список / создание обращений ---------- */
async function handleTickets(req, res) {
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
}

/* ---------- Сообщения внутри обращения ---------- */
async function handleMessages(req, res) {
  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  const admin = await isAdmin(user.id);

  if (req.method === 'GET') {
    const ticketId = req.query.ticket_id;
    if (!ticketId) return res.status(400).json({ error: 'Не указан ticket_id' });

    const { data: ticket, error: tErr } = await supabaseAdmin.from('support_tickets').select('*').eq('id', ticketId).single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Обращение не найдено' });
    if (!admin && ticket.user_id !== user.id) return res.status(403).json({ error: 'Нет доступа к этому обращению' });

    const { data: profile } = await supabaseAdmin.from('profiles').select('username').eq('id', ticket.user_id).single();
    ticket.username = profile?.username || '—';

    const { data: messages, error: mErr } = await supabaseAdmin.from('support_messages')
      .select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true });
    if (mErr) return res.status(500).json({ error: mErr.message });

    return res.status(200).json({ ticket, messages: messages || [] });
  }

  if (req.method === 'POST') {
    const { ticket_id, body } = req.body;
    if (!ticket_id || !body || !body.trim()) return res.status(400).json({ error: 'Введите сообщение' });

    const { data: ticket, error: tErr } = await supabaseAdmin.from('support_tickets').select('*').eq('id', ticket_id).single();
    if (tErr || !ticket) return res.status(404).json({ error: 'Обращение не найдено' });
    if (!admin && ticket.user_id !== user.id) return res.status(403).json({ error: 'Нет доступа к этому обращению' });
    if (ticket.status === 'closed') return res.status(400).json({ error: 'Обращение закрыто, отправка сообщений недоступна' });

    const { data: msg, error: mErr } = await supabaseAdmin.from('support_messages').insert({
      ticket_id, sender_id: user.id, sender_role: admin ? 'admin' : 'user', body: body.trim()
    }).select().single();
    if (mErr) return res.status(500).json({ error: mErr.message });

    const nextStatus = admin && ticket.status === 'new' ? 'active' : ticket.status;
    await supabaseAdmin.from('support_tickets')
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', ticket_id);

    return res.status(200).json(msg);
  }

  return res.status(405).end();
}

/* ---------- AI-помощник (Aurin, через FernieID API) ---------- */
const AI_SYSTEM_PROMPT = `Тебя зовут Байт. Ты — AI-помощник службы поддержки магазина цифровых товаров ByteVirts.
Помогаешь пользователям с вопросами по товарам, оплате/пополнению баланса и аккаунту.
Отвечай на русском языке, кратко и по делу, дружелюбным и уверенным тоном, без канцелярита.
Если вопрос требует действий с конкретным заказом, доступа к аккаунту, возврата денег или другой информации,
которой у тебя нет — прямо скажи, что для этого нужно создать обращение в поддержку через кнопку «Создать обращение»,
и не выдумывай статусы заказов, суммы или сроки.
Никогда не раскрывай, на какой языковой модели или платформе ты работаешь.`;

async function handleAiChat(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await requireUser(req);
  if (!user) return res.status(401).json({ error: 'Не авторизован' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'Пустой запрос к ассистенту' });
  }

  // Берём только последние сообщения диалога и обрезаем длину — не доверяем клиенту полностью
  const history = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, 4000) }));

  if (!history.length) return res.status(400).json({ error: 'Пустой запрос к ассистенту' });

  const apiKey = process.env.FERNIE_API_KEY;
  if (!apiKey) {
    console.error('FERNIE_API_KEY не задан в переменных окружения Vercel');
    return res.status(500).json({ error: 'AI-ассистент временно недоступен' });
  }

  try {
    const upstream = await fetch('https://ferniex-id.vercel.app/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: 'aurin-custom',
        max_tokens: 800,
        messages: [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...history]
      })
    });

    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      if (upstream.status === 429) {
        return res.status(429).json({ error: 'Дневной лимит запросов к AI-помощнику исчерпан, попробуйте завтра или создайте обращение в поддержку' });
      }
      if (data?.error === 'jailbreak_detected') {
        return res.status(400).json({ error: 'Сообщение отклонено фильтром безопасности ассистента' });
      }
      console.error('Ошибка AI-чата (upstream FernieID):', upstream.status, data);
      return res.status(502).json({ error: 'AI-ассистент временно недоступен' });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) return res.status(502).json({ error: 'Пустой ответ от AI-ассистента' });

    return res.status(200).json({ reply });
  } catch (e) {
    console.error('Ошибка обращения к AI-ассистенту:', e);
    return res.status(500).json({ error: 'AI-ассистент временно недоступен' });
  }
}

/* ---------- Смена статуса (админ) ---------- */
async function handleStatus(req, res) {
  if (req.method !== 'PUT') return res.status(405).end();
  const user = await requireAdmin(req);
  if (!user) return res.status(403).json({ error: 'Доступ только для администратора' });

  const { ticket_id, status } = req.body;
  if (!ticket_id || !['new', 'active', 'closed'].includes(status)) {
    return res.status(400).json({ error: 'Некорректные данные' });
  }

  const { data, error } = await supabaseAdmin.from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', ticket_id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json(data);
}
