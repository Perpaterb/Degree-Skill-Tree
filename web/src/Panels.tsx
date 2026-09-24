import { useMemo, useState } from 'react';
import { missingFor, progress, unlockedBy, type NodeState, type Progress } from '../../core/engine';
import type { Program, Rule, Subject, TreeDoc } from '../../core/model';
import { track } from './analytics';
import { useApp } from './store';
import { cssColor, stateLabel, stateLook } from './theme';

function Dot({ state }: { state: NodeState | undefined }) {
  const look = stateLook[state ?? 'locked'];
  return <span className="dot" style={{ background: cssColor(look.fill), borderColor: cssColor(look.ring) }} title={stateLabel[state ?? 'locked']} />;
}

function SubjectLink({ code }: { code: string }) {
  const tree = useApp((s) => s.tree)!;
  const state = useApp((s) => s.states.get(code));
  const select = useApp((s) => s.select);
  const s = tree.subjects[code];
  if (!s) return <span className="muted">{code} (not in this tree)</span>;
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

function SubjectDetail({ subject, tree }: { subject: Subject; tree: TreeDoc }) {
  const state = useApp((s) => s.states.get(subject.code));
  const plan = useApp((s) => s.plan);
  const mark = useApp((s) => s.mark);
  const missing = useMemo(() => missingFor(tree, subject.code, new Set(plan.completed)), [tree, subject.code, plan.completed]);
  const unlocks = useMemo(() => unlockedBy(tree, subject.code), [tree, subject.code]);

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
          This subject is named by the degree or by a requisite, but has no page in the {tree.year} handbook. It may have been retired or
          replaced. Completing it in an earlier year can still count towards requisites.
        </p>
      ) : null}
      <div className="actions">
        <button className={state === 'completed' ? 'on' : ''} onClick={() => mark(subject.code, state === 'completed' ? 'none' : 'completed')}>
          {state === 'completed' ? '✓ Completed' : 'Mark completed'}
        </button>
        <button className={state === 'planned' ? 'on plan' : ''} onClick={() => mark(subject.code, state === 'planned' ? 'none' : 'planned')}>
          {state === 'planned' ? '✓ Planned' : 'Plan it'}
        </button>
      </div>

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
              <li key={c}>{tree.subjects[c] ? <SubjectLink code={c} /> : <span className="muted">{c}</span>}</li>
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

function ProgramDetail({ program, tree }: { program: Program; tree: TreeDoc }) {
  const chosen = useApp((s) => s.plan.programs.includes(program.code));
  const toggle = useApp((s) => s.toggleProgram);
  const kind = { major: 'Major', sub_major: 'Sub-major', stream: 'Stream', other: 'Program' }[program.kind];
  const list = (c: Program['structure']): string[] => [...c.items.filter((i) => i.kind === 'subject').map((i) => i.code), ...c.children.flatMap(list)];
  return (
    <>
      <div className="kicker">{kind}</div>
      <h2>{program.title}</h2>
      <div className="meta">
        {program.code} {program.creditPoints ? `· ${program.creditPoints}cp` : ''}
      </div>
      {program.legacy ? <p className="note">Named by this degree but not published in the {tree.year} handbook.</p> : null}
      <div className="actions">
        <button className={chosen ? 'on' : ''} onClick={() => toggle(program.code)} disabled={program.legacy}>
          {chosen ? `✓ Chosen` : `Choose this ${kind.toLowerCase()}`}
        </button>
      </div>
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
  const tree = useApp((s) => s.tree)!;
  const select = useApp((s) => s.select);
  const p = tree.programs[code];
  return (
    <button className="link" onClick={() => select(code, true)}>
      ◆ {p?.title ?? code}
    </button>
  );
}

export function DetailPanel() {
  const tree = useApp((s) => s.tree);
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  if (!tree || !selected) return null;
  const subject = tree.subjects[selected];
  const program = tree.programs[selected];
  const isDegree = selected === tree.degree.code;
  return (
    <aside className="panel detail" data-testid="detail-panel">
      <button className="close" onClick={() => select(null)} aria-label="Close">
        ×
      </button>
      {subject ? <SubjectDetail subject={subject} tree={tree} /> : null}
      {program ? <ProgramDetail program={program} tree={tree} /> : null}
      {isDegree ? (
        <>
          <div className="kicker">Degree</div>
          <h2>{tree.degree.title}</h2>
          <div className="meta">
            {tree.degree.code} · {tree.degree.creditPoints}cp · {tree.degree.faculty}
          </div>
          <StructureView container={tree.degree.structure} />
        </>
      ) : null}
    </aside>
  );
}

function ProgressRow({ p, depth }: { p: Progress; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const pct = (n: number) => (p.required ? Math.min(100, (n / p.required) * 100) : 0);
  return (
    <li>
      <button className="progress-row" onClick={() => setOpen(!open)} disabled={!p.children.length}>
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
  const tree = useApp((s) => s.tree);
  const plan = useApp((s) => s.plan);
  const [open, setOpen] = useState(true);
  const root = useMemo(() => (tree ? progress(tree, plan) : null), [tree, plan]);
  if (!tree || !root) return null;
  return (
    <aside className={`panel progress ${open ? '' : 'collapsed'}`} data-testid="progress-panel">
      <button className="panel-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Degree progress{' '}
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
          {plan.programs.length === 0 ? <p className="muted small">Choose a major: click a large ◆ node on the map.</p> : null}
        </>
      ) : null}
    </aside>
  );
}

export function TopBar() {
  const tree = useApp((s) => s.tree);
  const index = useApp((s) => s.index);
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
          {tree ? (
            <div className="brand-sub">
              {tree.institution} {tree.year} · {tree.degree.title}
            </div>
          ) : null}
        </div>
      </div>
      {index.length > 1 ? (
        <select value={tree?.id} onChange={(e) => (location.hash = `t=${e.target.value}`)} aria-label="Degree">
          {index.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title} ({t.year})
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
            if (confirm('Clear everything you have marked on this tree?')) reset();
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
