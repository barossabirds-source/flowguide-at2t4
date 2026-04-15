// dashboard-data.js — Serves data to teacher dashboard
// Protected by DASHBOARD_PASSWORD env var

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'trinity2026';

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  // Check password
  const auth = event.headers['authorization'] || '';
  const provided = auth.replace('Bearer ', '');
  if (provided !== DASHBOARD_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const type = event.queryStringParameters?.type || 'summary';

    if (type === 'summary') {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/flowguide_session_summary?task_id=eq.AT2T4&order=student_name.asc`,
        { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
      );
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    if (type === 'exchanges') {
      const sessionId = event.queryStringParameters?.session_id;
      const url = sessionId
        ? `${SUPABASE_URL}/rest/v1/logbook_entries?session_id=eq.${sessionId}&order=iteration_number.asc`
        : `${SUPABASE_URL}/rest/v1/logbook_entries?task_id=eq.AT2T4&order=created_at.desc&limit=100`;

      const res = await fetch(url, {
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` }
      });
      const data = await res.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown type' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
