// auth.js — FlowGuide student auth
// Uses SUPABASE_SERVICE_KEY for server-side operations

const SUPABASE_URL = process.env.SUPABASE_URL;
const TRINITY_TENANT_ID = 'b8e8dce2-4bc2-46e2-af08-3a2fd0051b4d';
const AGENT_ID = 'AT2T4';
const SUBJECT = 'Stage 2 Business Innovation';

// Use service key for server-side auth operations
function getKey() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
}

async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + 'flowguide_salt_2026');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function db(path, method, body, params = '') {
  const key = getKey();
  const url = `${SUPABASE_URL}/rest/v1/${path}${params}`;
  console.log(`DB ${method} ${url}`);
  
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=representation'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  
  const text = await res.text();
  console.log(`DB response ${res.status}: ${text.substring(0, 200)}`);
  
  try {
    return JSON.parse(text);
  } catch {
    return { error: text, status: res.status };
  }
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
    console.log(`Auth action: ${action}, name: ${name}`);
    
    const nameLower = name.toLowerCase().trim();
    const pinHash = await hashPin(pin);

    // ── CHECK returning student ──────────────────────────────
    if (action === 'check') {
      const students = await db(
        'students',
        'GET', null,
        `?tenant_id=eq.${TRINITY_TENANT_ID}&display_name=ilike.${encodeURIComponent(name.trim())}&select=id,display_name,pin_hash`
      );

      if (!Array.isArray(students) || students.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ exists: false }) };
      }

      const student = students[0];
      if (!student.pin_hash) {
        return { statusCode: 200, headers, body: JSON.stringify({ exists: true, valid: false, noPinSet: true }) };
      }
      if (student.pin_hash !== pinHash) {
        return { statusCode: 200, headers, body: JSON.stringify({ exists: true, valid: false }) };
      }

      // Valid — fetch session
      const sessions = await db(
        'sessions', 'GET', null,
        `?student_id=eq.${student.id}&task_id=eq.${AGENT_ID}&order=started_at.desc&limit=1&select=*`
      );

      let sessionId = null, exchangeCount = 0, lastMode = 'thinking';
      let lastBloom = 1, lastPillar = 'TOOLS';
      let messages = [], displayHistory = [];

      if (Array.isArray(sessions) && sessions.length > 0) {
        const session = sessions[0];
        sessionId = session.id;
        exchangeCount = session.iteration_count || 0;
        lastMode = session.metadata?.mode || 'thinking';

        const entries = await db(
          'logbook_entries', 'GET', null,
          `?session_id=eq.${sessionId}&order=iteration_number.asc&select=*`
        );

        if (Array.isArray(entries)) {
          entries.forEach(entry => {
            if (entry.full_prompt) {
              messages.push({ role: 'user', content: entry.full_prompt });
              displayHistory.push({ role: 'student', text: entry.full_prompt, bloom: null });
            }
            if (entry.ai_response_summary) {
              const bloom = entry.reflection ? {
                bloom_rank: entry.prompt_quality_score,
                active_pillar: entry.reflection.active_pillar,
                sace_grade_signal: entry.reflection.sace_grade_signal
              } : null;
              messages.push({ role: 'assistant', content: entry.ai_response_summary });
              displayHistory.push({ role: 'coach', text: entry.ai_response_summary, bloom });
            }
            if (entry.prompt_quality_score) lastBloom = entry.prompt_quality_score;
            if (entry.reflection?.active_pillar) lastPillar = entry.reflection.active_pillar;
            if (entry.reflection?.mode) lastMode = entry.reflection.mode;
          });
        }
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          exists: true, valid: true,
          studentId: student.id,
          displayName: student.display_name,
          sessionId, exchangeCount,
          messages, displayHistory,
          lastBloom, lastPillar, lastMode
        })
      };
    }

    // ── REGISTER new student ─────────────────────────────────
    if (action === 'register') {
      // Check if already exists
      const existing = await db(
        'students', 'GET', null,
        `?tenant_id=eq.${TRINITY_TENANT_ID}&display_name=ilike.${encodeURIComponent(name.trim())}&select=id,pin_hash`
      );

      let studentId;

      if (Array.isArray(existing) && existing.length > 0) {
        const s = existing[0];
        if (s.pin_hash) {
          return {
            statusCode: 200, headers,
            body: JSON.stringify({
              success: false,
              error: 'A session already exists for that name. Use the "Returning" tab and enter your PIN.'
            })
          };
        }
        // Set PIN on existing student
        await db(`students?id=eq.${s.id}`, 'PATCH', { pin_hash: pinHash });
        studentId = s.id;
      } else {
        // Create new student
        const result = await db('students', 'POST', {
          tenant_id: TRINITY_TENANT_ID,
          display_name: name.trim(),
          email: `${nameLower.replace(/\s+/g, '.')}.${Date.now()}@flowguide.local`,
          pin_hash: pinHash,
          year_level: '12',
          class_code: 'BI-2026'
        });

        if (result.error || !Array.isArray(result) || result.length === 0) {
          console.error('Student insert failed:', JSON.stringify(result));
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: false, error: 'Could not create student record. Please try again.' })
          };
        }
        studentId = result[0].id;
      }

      // Create session
      const sessionResult = await db('sessions', 'POST', {
        tenant_id: TRINITY_TENANT_ID,
        student_id: studentId,
        task_id: AGENT_ID,
        subject: SUBJECT,
        current_step: 1,
        iteration_count: 0,
        metadata: { mode: 'thinking', agent: 'FlowGuide' }
      });

      if (sessionResult.error || !Array.isArray(sessionResult) || sessionResult.length === 0) {
        console.error('Session insert failed:', JSON.stringify(sessionResult));
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: false, error: 'Could not create session. Please try again.' })
        };
      }

      const sessionId = sessionResult[0].id;

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          studentId,
          displayName: name.trim(),
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error', details: err.message }) };
  }
};
