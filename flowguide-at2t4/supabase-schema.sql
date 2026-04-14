-- FlowGuide Platform Schema v3
-- Run this in your Supabase SQL editor (uxeolwdahwuggeapuurz.supabase.co)

-- ── STUDENTS table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,               -- lowercase for matching
  display_name TEXT,                -- original casing for display
  pin_hash TEXT NOT NULL,           -- SHA-256 of PIN + salt
  agent_id TEXT DEFAULT 'AT2T4-BI-2026',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, agent_id)
);

-- ── EXCHANGES table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchanges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  student_name TEXT,                -- lowercase, matches students.name
  agent_id TEXT DEFAULT 'AT2T4-BI-2026',
  exchange_number INTEGER,
  student_input TEXT,
  coach_response TEXT,
  bloom_rank INTEGER CHECK (bloom_rank BETWEEN 1 AND 6),
  active_pillar TEXT CHECK (active_pillar IN ('TOOLS','RISKS','CONTRIBUTION','DRAFTING')),
  ae3_present BOOLEAN DEFAULT false,
  mode TEXT DEFAULT 'thinking' CHECK (mode IN ('thinking','drafting')),
  section_active TEXT,
  reasoning TEXT,
  sace_grade_signal TEXT,
  next_nudge_direction TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── SESSION SUMMARY VIEW ─────────────────────────────────────
CREATE OR REPLACE VIEW session_summary AS
SELECT
  e.student_name,
  s.display_name,
  e.agent_id,
  COUNT(*) AS total_exchanges,
  MAX(e.bloom_rank) AS highest_bloom,
  ROUND(AVG(e.bloom_rank)::numeric, 1) AS avg_bloom,
  COUNT(*) FILTER (WHERE e.mode = 'thinking') AS thinking_exchanges,
  COUNT(*) FILTER (WHERE e.mode = 'drafting') AS drafting_exchanges,
  BOOL_OR(e.mode = 'drafting') AS reached_drafting,
  BOOL_OR(e.ae3_present) AS ae3_covered,
  COUNT(DISTINCT e.active_pillar) FILTER (
    WHERE e.active_pillar IN ('TOOLS','RISKS','CONTRIBUTION')
  ) AS pillars_covered,
  MIN(e.created_at) AS first_session,
  MAX(e.created_at) AS last_active,
  -- At-risk: avg bloom ≤ 2 after 5+ thinking exchanges
  CASE
    WHEN COUNT(*) FILTER (WHERE e.mode = 'thinking') >= 5
     AND AVG(e.bloom_rank) FILTER (WHERE e.mode = 'thinking') <= 2
    THEN true ELSE false
  END AS at_risk,
  -- Integrity: bloom jumped 3+ ranks in one exchange
  CASE WHEN EXISTS (
    SELECT 1 FROM (
      SELECT
        bloom_rank,
        LAG(bloom_rank) OVER (
          PARTITION BY e2.student_name ORDER BY e2.created_at
        ) AS prev_rank
      FROM exchanges e2
      WHERE e2.student_name = e.student_name
        AND e2.agent_id = e.agent_id
    ) ranked
    WHERE (bloom_rank - prev_rank) >= 3
  ) THEN true ELSE false END AS integrity_flag
FROM exchanges e
LEFT JOIN students s ON s.name = e.student_name AND s.agent_id = e.agent_id
GROUP BY e.student_name, s.display_name, e.agent_id;

-- ── ROW LEVEL SECURITY ───────────────────────────────────────
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchanges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow insert students" ON students FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow read students" ON students FOR SELECT USING (true);
CREATE POLICY "Allow insert exchanges" ON exchanges FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow read exchanges" ON exchanges FOR SELECT USING (true);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_students_name ON students(name);
CREATE INDEX IF NOT EXISTS idx_exchanges_student ON exchanges(student_name);
CREATE INDEX IF NOT EXISTS idx_exchanges_agent ON exchanges(agent_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_session ON exchanges(session_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_created ON exchanges(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchanges_mode ON exchanges(mode);
