// auth.js — Student registration and session resume
// Handles: register new student, verify returning student, fetch session history

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// Simple SHA-256 hash for PIN storage
async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + 'flowguide_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function supabase(path, method, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method Not Allowed' };

  try {
    const { action, name, pin } = JSON.parse(event.body);
    const nameLower = name.toLowerCase().trim();
    const pinHash = await hashPin(pin);

    // ── CHECK if student exists ──────────────────────────────
    if (action === 'check') {
      const students = await supabase(
        `students?name=eq.${encodeURIComponent(nameLower)}&select=id,name,pin_hash,created_at`,
        'GET'
      );

      if (!Array.isArray(students) || students.length === 0) {
        // New student
        return { statusCode: 200, headers, body: JSON.stringify({ exists: false }) };
      }

      // Existing student — verify PIN
      const student = students[0];
      if (student.pin_hash !== pinHash) {
        return { statusCode: 200, headers, body: JSON.stringify({ exists: true, valid: false }) };
      }

      // PIN correct — fetch full session history
      const exchanges = await supabase(
        `exchanges?student_name=eq.${encodeURIComponent(nameLower)}&agent_id=eq.AT2T4-BI-2026&order=created_at.asc&select=*`,
        'GET'
      );

      // Rebuild conversation messages for Claude context
      const messages = [];
      const displayHistory = [];
      let lastBloom = 1;
      let lastPillar = 'TOOLS';
      let lastMode = 'thinking';
      let sessionId = null;

      if (Array.isArray(exchanges) && exchanges.length > 0) {
        sessionId = exchanges[0].session_id;
        exchanges.forEach(ex => {
          if (ex.student_input) {
            messages.push({ role: 'user', content: ex.student_input });
            displayHistory.push({
              role: 'student',
              text: ex.student_input,
              bloom: null
            });
          }
          if (ex.coach_response) {
            messages.push({ role: 'assistant', content: ex.coach_response });
            displayHistory.push({
              role: 'coach',
              text: ex.coach_response,
              bloom: {
                bloom_rank: ex.bloom_rank,
                active_pillar: ex.active_pillar,
                sace_grade_signal: ex.sace_grade_signal
              }
            });
          }
          if (ex.bloom_rank) lastBloom = ex.bloom_rank;
          if (ex.active_pillar) lastPillar = ex.active_pillar;
          if (ex.mode) lastMode = ex.mode;
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          exists: true,
          valid: true,
          studentId: student.id,
          sessionId: sessionId,
          exchangeCount: exchanges.length || 0,
          messages,
          displayHistory,
          lastBloom,
          lastPillar,
          lastMode
        })
      };
    }

    // ── REGISTER new student ─────────────────────────────────
    if (action === 'register') {
      // Double-check they don't already exist
      const existing = await supabase(
        `students?name=eq.${encodeURIComponent(nameLower)}&select=id`,
        'GET'
      );

      if (Array.isArray(existing) && existing.length > 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: false, error: 'Name already registered. Try a different name or check your PIN.' })
        };
      }

      // Create student record
      const newStudent = await supabase('students', 'POST', {
        name: nameLower,
        display_name: name.trim(),
        pin_hash: pinHash,
        agent_id: 'AT2T4-BI-2026',
        created_at: new Date().toISOString()
      });

      const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          studentId: Array.isArray(newStudent) ? newStudent[0]?.id : newStudent?.id,
          sessionId,
          exchangeCount: 0,
          messages: [],
          displayHistory: [],
          lastBloom: 1,
          lastPillar: 'TOOLS',
          lastMode: 'thinking'
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error('Auth error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', details: err.message })
    };
  }
};
