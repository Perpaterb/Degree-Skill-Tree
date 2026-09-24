import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { missingFor, prerequisiteGap, programsUnder, progress, unlockedBy, type NodeState, type PrerequisiteGap, type Progress } from '../../core/engine';
import type { Degree, MapDoc, Program, Rule, Subject } from '../../core/model';
import { track } from './analytics';
import { useApp } from './store';
import { cssColor, stateLabel, stateLook } from './theme';

function Dot({ state }: { state: NodeState | undefined }) {
  const look = stateLook[state ?? 'locked'];
  return <span className="dot" style={{ background: cssColor(look.fill), borderColor: cssColor(look.ring) }} title={stateLabel[state ?? 'locked']} />;
}

function SubjectLink({ code }: { code: string }) {
  const map = useApp((s) => s.map)!;
  const state = useApp((s) => s.states.get(code));
  const select = useApp((s) => s.select);
  const s = map.subjects[code];
  if (!s) return <span className="muted">{code} (not on this map)</span>;
  return (
    <button className="link" onClick={() => select(code, true)}>
      <Dot state={state} />
      <b>{code}</b> {s.title}
    </button>
  );
}

/** A requisite rule in plain language. */
function RuleView({ rule }: { rule: Rule }) {
  // Sources often list the same credit-point threshold once per degree type; say it once.
  if ('op' in rule && rule.op === 'or' && rule.args.length > 1) {
    const cps = rule.args.filter((r): r is Extract<Rule, { creditPoints: number }> => 'creditPoints' in r);
    if (cps.length === rule.args.length && cps.every((r) => r.creditPoints === cps[0].creditPoints)) {
      return (
        <span title={cps.map((r) => r.scope).join('\n')}>
          At least {cps[0].creditPoints} credit points completed <span className="muted">(in any of {cps.length} listed degree types)</span>
        </span>
      );
    }
  }
  if ('op' in rule) {
    return (
      <div className="rule">
        <div className="rule-head">{rule.op === 'and' ? 'All of:' : 'One of:'}</div>
        <ul>
          {rule.args.map((r, i) => (
            <li key={i}>
              <RuleView rule={r} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if ('subject' in rule) return <SubjectLink code={rule.subject} />;
  if ('course' in rule) return <span>Enrolled in {rule.course} {rule.title}</span>;
  if ('creditPoints' in rule) return <span>At least {rule.creditPoints} credit points completed{rule.scope ? ` (${rule.scope})` : ''}</span>;
  return <span>{rule.text}</span>;
}

function Html({ html }: { html: string }) {
  // Content comes from the institution's handbook; tags are stripped to plain paragraphs.
  const text = html.replace(/<\/(p|li)>/g, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#43;/g, '+').replace(/&#39;/g, "'").trim();
  return (
    <>
      {text
        .split('\n')
        .filter((t) => t.trim())
        .map((t, i) => (
          <p key={i}>{t.trim()}</p>
        ))}
    </>
  );
}

/** Asks before marking a subject completed when its prerequisites are not completed (US-025). */
function PrerequisiteWarning({ subject, gap, onClose, onConfirm }: { subject: Subject; gap: PrerequisiteGap; onClose(): void; onConfirm(): void }) {
  const map = useApp((s) => s.map)!;
  const states = useApp((s) => s.states);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Rendered on the page itself: inside the panel, its backdrop would only cover the panel, and a
  // click beside the dialog would reach the map.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prereq-title"
        data-testid="prereq-warning"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="prereq-title">Prerequisites not completed</h2>
        <p>
          <b>{subject.code}</b> {subject.title} needs these completed first:
        </p>
        {gap.subjects.length ? (
          <ol className="chain" data-testid="prereq-missing">
            {gap.subjects.map((c) => (
              <li key={c}>
                <Dot state={states.get(c)} />
                <b>{c}</b> {map.subjects[c]?.title ?? '(not on this map)'}
              </li>
            ))}
          </ol>
        ) : null}
        {gap.notes.map((n) => (
          <p key={n} className="muted">
            {gap.subjects.length ? 'Also: ' : ''}
            {n}
          </p>
        ))}
        {gap.alternatives ? <p className="muted small">Other combinations would also work; see Requisites in the subject panel.</p> : null}
        <div className="modal-actions">
          <button ref={close} onClick={onClose}>
            Close
          </button>
          <button className="warn" onClick={onConfirm}>
            Mark as completed anyway
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SubjectDetail({ subject, map }: { subject: Subject; map: MapDoc }) {
  const state = useApp((s) => s.states.get(subject.code));
  const plan = useApp((s) => s.plan);
  const mark = useApp((s) => s.mark);
  const missing = useMemo(() => missingFor(map, subject.code, new Set(plan.completed), plan.degree), [map, subject.code, plan.completed]);
  const unlocks = useMemo(() => unlockedBy(map, subject.code), [map, subject.code]);
  const [warning, setWarning] = useState<PrerequisiteGap | null>(null);
  // A different subject in the panel never inherits the warning.
  useEffect(() => setWarning(null), [subject.code]);
  const markCompleted = () => {
    if (state === 'completed') return mark(subject.code, 'none');
    const gap = prerequisiteGap(map, subject.code, plan.completed, plan.degree);
    if (gap) setWarning(gap);
    else mark(subject.code, 'completed');
  };

  return (
    <>
      <div className="kicker">
        <Dot state={state} /> {stateLabel[state ?? 'locked']}
      </div>
      <h2>
        {subject.code} {subject.title}
      </h2>
      <div className="meta">
        {subject.creditPoints ? `${subject.creditPoints}cp` : ''} {subject.level && `· ${subject.level}`} {subject.school && `· ${subject.school}`}
      </div>
      {subject.legacy ? (
        <p className="note">
          This subject is named by the degree or by a requisite, but has no page in the {map.year} handbook. It may have been retired or
          replaced. Completing it in an earlier year can still count towards requisites.
        </p>
      ) : null}
      <div className="actions">
        <button className={state === 'completed' ? 'on' : ''} onClick={markCompleted}>
          {state === 'completed' ? '✓ Completed' : 'Mark completed'}
        </button>
        <button className={state === 'planned' ? 'on plan' : ''} onClick={() => mark(subject.code, state === 'planned' ? 'none' : 'planned')}>
          {state === 'planned' ? '✓ Planned' : 'Plan it'}
        </button>
      </div>
      {warning ? (
        <PrerequisiteWarning
          subject={subject}
          gap={warning}
          onClose={() => setWarning(null)}
          onConfirm={() => {
            setWarning(null);
            mark(subject.code, 'completed');
          }}
        />
      ) : null}

      {state === 'locked' || state === 'reachable' ? (
        <section>
          <h3>To unlock</h3>
          {missing.subjects.length ? (
            <ol className="chain">
              {missing.subjects.map((c) => (
                <li key={c}>
                  <SubjectLink code={c} />
                </li>
              ))}
            </ol>
          ) : null}
          {missing.notes.map((n) => (
            <p key={n} className="muted">
              Also: {n}
            </p>
          ))}
        </section>
      ) : null}

      {subject.requisite ? (
        <section>
          <h3>Requisites</h3>
          <RuleView rule={subject.requisite} />
        </section>
      ) : subject.legacy ? null : (
        <section>
          <h3>Requisites</h3>
          <p className="muted">None</p>
        </section>
      )}
      {subject.antiRequisites.length ? (
        <section>
          <h3>Cannot be taken with</h3>
          <ul className="plain">
            {subject.antiRequisites.map((c) => (
              <li key={c}>{map.subjects[c] ? <SubjectLink code={c} /> : <span className="muted">{c}</span>}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {unlocks.length ? (
        <section>
          <h3>Leads to</h3>
          <ul className="plain">
            {unlocks.map((c) => (
              <li key={c}>
                <SubjectLink code={c} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {subject.recommended ? (
        <section>
          <h3>Recommended prior study</h3>
          <p>{subject.recommended}</p>
        </section>
      ) : null}
      {subject.description ? (
        <section>
          <h3>Description</h3>
          <Html html={subject.description} />
        </section>
      ) : null}
      {subject.learningOutcomes.length ? (
        <section>
          <h3>Learning outcomes</h3>
          <ol>
            {subject.learningOutcomes.map((lo, i) => (
              <li key={i}>
                <Html html={lo} />
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {subject.offerings.length ? (
        <section>
          <h3>Offered</h3>
          <ul className="plain">
            {subject.offerings.map((o, i) => (
              <li key={i}>
                {o.session} · {o.location} · {o.mode}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p>
        <a href={subject.url} target="_blank" rel="noreferrer">
          Official handbook page ↗
        </a>
      </p>
    </>
  );
}

/** Degrees on the map that offer a program anywhere in their structure. */
function degreesOffering(map: MapDoc, code: string): Degree[] {
  return Object.values(map.degrees).filter((d) => programsUnder(map, d.structure).has(code));
}

function ProgramDetail({ program, map }: { program: Program; map: MapDoc }) {
  const chosen = useApp((s) => s.plan.programs.includes(program.code));
  const degree = useApp((s) => s.plan.degree);
  const toggle = useApp((s) => s.toggleProgram);
  const selectDegree = useApp((s) => s.selectDegree);
  const kind = { major: 'Major', sub_major: 'Sub-major', stream: 'Stream', other: 'Program' }[program.kind];
  const list = (c: Program['structure']): string[] => [...c.items.filter((i) => i.kind === 'subject').map((i) => i.code), ...c.children.flatMap(list)];
  const offering = degreesOffering(map, program.code);
  const offered = !!degree && offering.some((d) => d.code === degree);
  return (
    <>
      <div className="kicker">{kind}</div>
      <h2>{program.title}</h2>
      <div className="meta">
        {program.code} {program.creditPoints ? `· ${program.creditPoints}cp` : ''}
      </div>
      {program.legacy ? <p className="note">Named by a degree but not published in the {map.year} handbook.</p> : null}
      {offered || chosen ? (
        <div className="actions">
          <button className={chosen ? 'on' : ''} onClick={() => toggle(program.code)} disabled={program.legacy}>
            {chosen ? `✓ Chosen` : `Choose this ${kind.toLowerCase()}`}
          </button>
        </div>
      ) : (
        <div className="note">
          {degree ? `${map.degrees[degree].title} does not offer this ${kind.toLowerCase()}. ` : ''}
          Select a degree that offers it to choose it:
          <ul className="plain">
            {offering.map((d) => (
              <li key={d.code}>
                <button className="link" onClick={() => selectDegree(d.code)}>
                  ◯ {d.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <StructureView container={program.structure} />
      {list(program.structure).length === 0 ? null : (
        <p>
          <a href={program.url} target="_blank" rel="noreferrer">
            Official handbook page ↗
          </a>
        </p>
      )}
    </>
  );
}

function DegreeDetail({ degree, map }: { degree: Degree; map: MapDoc }) {
  const selectedDegree = useApp((s) => s.plan.degree);
  const fit = useApp((s) => s.fits.get(degree.code));
  const selectDegree = useApp((s) => s.selectDegree);
  const isSel = selectedDegree === degree.code;
  return (
    <>
      <div className="kicker">Degree</div>
      <h2>{degree.title}</h2>
      <div className="meta">
        {degree.code} · {degree.creditPoints}cp · {degree.faculty}
      </div>
      <div className="actions">
        <button className={isSel ? 'on' : ''} onClick={() => selectDegree(isSel ? null : degree.code)}>
          {isSel ? '✓ Working towards this (clear)' : 'Work towards this degree'}
        </button>
      </div>
      {fit && fit.completedCp > 0 ? (
        <section data-testid="degree-fit">
          <h3>Your completed subjects</h3>
          <p>
            {fit.countingCp} of your {fit.completedCp}cp would count towards this degree.
            {fit.impossible ? ' It can no longer be completed as things stand.' : ''}
          </p>
          {fit.wasted.length ? (
            <>
              <p className="muted">In the way:</p>
              <ul className="plain">
                {fit.wasted.map((w) => (
                  <li key={w.code}>
                    <SubjectLink code={w.code} /> <span className="muted">: {w.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
      <StructureView container={degree.structure} />
      <p>
        <a href={degree.url} target="_blank" rel="noreferrer">
          Official handbook page ↗
        </a>
      </p>
    </>
  );
}

function StructureView({ container }: { container: Program['structure'] }) {
  return (
    <section>
      {container.title !== 'Structure' ? (
        <h3>
          {container.title} {container.creditPoints ? <span className="muted">({container.creditPoints}cp)</span> : null}
        </h3>
      ) : null}
      {container.description ? <p className="muted">{container.description}</p> : null}
      <ul className="plain">
        {container.items.map((i) => (
          <li key={i.code}>{i.kind === 'subject' ? <SubjectLink code={i.code} /> : <ProgramLink code={i.code} />}</li>
        ))}
      </ul>
      {container.children.map((c) => (
        <StructureView key={c.id} container={c} />
      ))}
    </section>
  );
}

function ProgramLink({ code }: { code: string }) {
  const map = useApp((s) => s.map)!;
  const select = useApp((s) => s.select);
  const p = map.programs[code];
  return (
    <button className="link" onClick={() => select(code, true)}>
      ◆ {p?.title ?? code}
    </button>
  );
}

export function DetailPanel() {
  const map = useApp((s) => s.map);
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  if (!map || !selected) return null;
  const subject = map.subjects[selected];
  const program = map.programs[selected];
  const degree = map.degrees[selected];
  return (
    <aside className="panel detail" data-testid="detail-panel">
      <button className="close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      {subject ? <SubjectDetail subject={subject} map={map} /> : null}
      {program ? <ProgramDetail program={program} map={map} /> : null}
      {degree ? <DegreeDetail degree={degree} map={map} /> : null}
    </aside>
  );
}

function ProgressRow({ p, depth }: { p: Progress; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const setGlow = useApp((s) => s.setGlow);
  const pct = (n: number) => (p.required ? Math.min(100, (n / p.required) * 100) : 0);
  return (
    <li>
      <button
        className="progress-row"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setGlow(p.refs)}
        onMouseLeave={() => setGlow([])}
        onFocus={() => setGlow(p.refs)}
        onBlur={() => setGlow([])}
        aria-disabled={!p.children.length}
      >
        <span className="progress-title">{p.title}</span>
        <span className="progress-num">
          {p.done}
          {p.planned ? <span className="planned-num">+{p.planned}</span> : null}/{p.required}cp
        </span>
        <span className="bar">
          <span className="bar-done" style={{ width: `${pct(p.done)}%` }} />
          <span className="bar-planned" style={{ width: `${pct(p.planned)}%` }} />
        </span>
      </button>
      {open && p.children.length ? (
        <ul>
          {p.children.map((c) => (
            <ProgressRow key={c.id} p={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ProgressPanel() {
  const map = useApp((s) => s.map);
  const plan = useApp((s) => s.plan);
  const selectDegree = useApp((s) => s.selectDegree);
  const [open, setOpen] = useState(true);
  const root = useMemo(() => (map && plan.degree ? progress(map, plan.degree, plan) : null), [map, plan]);
  const fit = useApp((s) => (plan.degree ? s.fits.get(plan.degree) : undefined));
  // Only shown while a degree is selected (US-022).
  if (!map || !root || !plan.degree) return null;
  return (
    <aside className={`panel progress ${open ? '' : 'collapsed'}`} data-testid="progress-panel">
      <button className="panel-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {root.title}{' '}
        <b data-testid="progress-total">
          {root.done}/{root.required}cp
        </b>
      </button>
      {open ? (
        <>
          <ul className="progress-tree">
            {root.children.map((c) => (
              <ProgressRow key={c.id} p={c} depth={0} />
            ))}
          </ul>
          {plan.programs.filter((p) => degreesOffering(map, p).some((d) => d.code === plan.degree)).length === 0 ? (
            <p className="muted small">Choose a major: hover "Major" above to see them, then click one of the glowing circles.</p>
          ) : null}
          {fit && fit.wasted.length ? (
            <section className="not-counting" data-testid="not-counting">
              <h4>Completed, but not counting</h4>
              <p className="muted small">These subjects do not count towards this degree.</p>
              <ul className="plain">
                {fit.wasted.map((w) => (
                  <li key={w.code} title={w.reason}>
                    <SubjectLink code={w.code} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <button className="link small" onClick={() => selectDegree(null)}>
            Clear degree
          </button>
        </>
      ) : null}
    </aside>
  );
}

export function TopBar() {
  const map = useApp((s) => s.map);
  const plan = useApp((s) => s.plan);
  const selectDegree = useApp((s) => s.selectDegree);
  const search = useApp((s) => s.search);
  const matches = useApp((s) => s.matches);
  const setSearch = useApp((s) => s.setSearch);
  const select = useApp((s) => s.select);
  const reset = useApp((s) => s.resetPlan);
  const [cursor, setCursor] = useState(0);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      prompt('Copy this link to share your plan:', location.href);
    }
    track('plan_shared');
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">◈</span>
        <div>
          <div className="brand-name">Degree Skill Tree</div>
          {map ? (
            <div className="brand-sub">
              {map.institution} {map.year} · {Object.keys(map.degrees).length} degrees
            </div>
          ) : null}
        </div>
      </div>
      {map ? (
        <select
          value={plan.degree ?? ''}
          onChange={(e) => {
            selectDegree(e.target.value || null);
            if (e.target.value) select(e.target.value, true);
          }}
          aria-label="Degree"
          data-testid="degree-picker"
        >
          <option value="">Any degree (explore)</option>
          {Object.values(map.degrees)
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((d) => (
            <option key={d.code} value={d.code}>
              {d.title}
            </option>
          ))}
        </select>
      ) : null}
      <div className="search">
        <input
          type="search"
          placeholder="Search subjects, e.g. 31251 or security"
          value={search}
          data-testid="search"
          onChange={(e) => {
            setSearch(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length) {
              select(matches[cursor % matches.length], true);
              setCursor(cursor + 1);
              track('search_used');
            }
            if (e.key === 'Escape') setSearch('');
          }}
        />
        {search.trim().length >= 2 ? (
          <span className="search-count" data-testid="search-count">
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
            {matches.length ? ' · Enter to cycle' : ''}
          </span>
        ) : null}
      </div>
      <div className="top-actions">
        <button onClick={share}>{copied ? 'Link copied' : 'Share plan'}</button>
        <button
          onClick={() => {
            if (confirm('Clear everything you have marked on this map?')) reset();
          }}
        >
          Reset
        </button>
      </div>
    </header>
  );
}

export function Legend() {
  const order: NodeState[] = ['completed', 'planned', 'available', 'reachable', 'locked', 'excluded', 'legacy'];
  return (
    <div className="legend">
      {order.map((s) => (
        <span key={s}>
          <Dot state={s} /> {stateLabel[s]}
        </span>
      ))}
    </div>
  );
}
