import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { PageHero } from '../../components/PageHero';
import { api } from '../../lib/api';
import { useData } from '../../context/DataContext';

export function StudentOptimizerPage() {
  const { mode } = useData();
  const [prefs, setPrefs] = useState({
    avoid_early: false,
    prefer_gaps: true,
    max_daily: 4,
    prefer_online: false,
    notes: '',
  });
  const [result, setResult] = useState<{
    score: number;
    tips: Array<{ day: string; kind: string; text: string }>;
    studyBlocks: Array<{
      day: string;
      start_time: string;
      end_time: string;
      minutes: number;
      suggestion: string;
    }>;
  } | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (mode !== 'api') return;
    void api
      .myPreferences()
      .then((p) =>
        setPrefs({
          avoid_early: Boolean(p.avoid_early),
          prefer_gaps: Boolean(p.prefer_gaps),
          max_daily: Number(p.max_daily) || 4,
          prefer_online: Boolean(p.prefer_online),
          notes: p.notes || '',
        }),
      )
      .catch(() => undefined);
  }, [mode]);

  async function saveAndOptimize() {
    if (mode !== 'api') return;
    setError('');
    try {
      await api.savePreferences(prefs);
      const r = await api.optimizeWeek();
      setResult(r);
      setMsg(`Personal fit score: ${r.score}/100`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimize failed');
    }
  }

  if (mode !== 'api') {
    return (
      <div className="page">
        <PageHero
          variant="page"
          kicker="Smart picks"
          title="Personal optimizer"
          icon={<Sparkles size={22} color="#fff" />}
          subtitle="Personal week optimizer needs the live server."
        />
        <div className="empty-state">
          The personal optimizer requires the live DIU server. Offline / demo mode cannot save
          preferences or score your week.
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHero
        variant="page"
        kicker="Smart picks"
        title="Personal optimizer"
        icon={<Sparkles size={22} color="#fff" />}
        subtitle="Rare feature: tune preferences and get study-gap plans + overload warnings for your batch week — without changing the official routine."
      />
      {error && <div className="error-banner">{error}</div>}
      {msg && <div className="success-banner">{msg}</div>}

      <section className="card pad stack">
        <label className="row-gap">
          <input
            type="checkbox"
            checked={prefs.avoid_early}
            onChange={(e) => setPrefs({ ...prefs, avoid_early: e.target.checked })}
          />
          Flag early (&lt; 10:00) classes
        </label>
        <label className="row-gap">
          <input
            type="checkbox"
            checked={prefs.prefer_gaps}
            onChange={(e) => setPrefs({ ...prefs, prefer_gaps: e.target.checked })}
          />
          Prefer study gaps between classes
        </label>
        <label>
          Max classes / day
          <input
            className="input"
            type="number"
            min={1}
            max={8}
            value={prefs.max_daily}
            onChange={(e) => setPrefs({ ...prefs, max_daily: Number(e.target.value) || 4 })}
          />
        </label>
        <button className="btn-primary" onClick={() => void saveAndOptimize()}>
          Save &amp; optimize week
        </button>
      </section>

      {result && (
        <>
          <section className="card pad">
            <h3>Score {result.score}</h3>
            <ul>
              {result.tips.map((t, i) => (
                <li key={i}>{t.text}</li>
              ))}
              {!result.tips.length && <li className="muted">No overload warnings — looking good.</li>}
            </ul>
          </section>
          <section className="card pad">
            <h3>Suggested study blocks</h3>
            {result.studyBlocks.map((b, i) => (
              <div key={i} className="info-row">
                <span>
                  {b.day} {b.start_time}–{b.end_time} ({b.minutes}m)
                </span>
                <strong style={{ fontWeight: 500, fontSize: 13 }}>{b.suggestion}</strong>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
