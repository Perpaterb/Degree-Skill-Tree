import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  missingFor,
  prerequisiteGap,
  programsUnder,
  progress,
  progressStatus,
  unlockedBy,
  type NodeState,
  type PrerequisiteGap,
  type Progress,
  type Status,
} from '../../core/engine';
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

/**
 * A requisite rule for the warning: every option, as in the Requisites section, and under any
 * option that is not yet completed, what it needs first in turn.
 */
function PrerequisiteRule({ rule }: { rule: Rule }) {
  const map = useApp((s) => s.map)!;
  const plan = useApp((s) => s.plan);
  const states = useApp((s) => s.states);
  if ('op' in rule) {
    return (
      <div className="rule">
        <div className="rule-head">{rule.op === 'and' ? 'All of:' : 'One of:'}</div>
        <ul>
          {rule.args.map((r, i) => (
            <li key={i}>
              <PrerequisiteRule rule={r} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if ('subject' in rule) {
    const gap = states.get(rule.subject) === 'completed' ? null : prerequisiteGap(map, rule.subject, plan.completed, plan.degree);
    return (
      <>
        <SubjectLink code={rule.subject} />
        {gap && gap.subjects.length ? (
          <div className="muted small needs-first" data-testid="needs-first">
            {/* With alternatives of its own, this is one way in, not the only one. */}
            needs {gap.alternatives ? 'its own prerequisites first, for example ' : ''}
            {gap.subjects.join(', ')}
            {gap.alternatives ? '' : ' first'}
          </div>
        ) : null}
      </>
    );
  }
  return <RuleView rule={rule} />;
}

/** Asks before marking a subject completed when its prerequisites are not completed (US-025). */
function PrerequisiteWarning({ subject, onClose, onConfirm }: { subject: Subject; onClose(): void; onConfirm(): void }) {
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
        <div data-testid="prereq-rule">{subject.requisite ? <PrerequisiteRule rule={subject.requisite} /> : null}</div>
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
      <DegreeOutline degree={degree} map={map} />
      <p>
        <a href={degree.url} target="_blank" rel="noreferrer">
          Official handbook page ↗
        </a>
      </p>
    </>
  );
}

function StructureView({ container }: { container: Program['structure'] }) {
  return <OutlineSection container={container} />;
}

/** A tick after a line that is met (green) or met once the plan is done (blue). */
function Tick({ status }: { status: Status }) {
  return status === 'complete' || status === 'planned' ? <span className="tick"> ✓</span> : null;
}

/** Done / needed credit points, with the planned part in purple: "42+6/48cp". */
function Cp({ p }: { p: { done: number; planned: number; required: number } }) {
  return (
    <>
      {p.done}
      {p.planned ? <span className="planned-num">+{p.planned}</span> : null}/{p.required}cp
    </>
  );
}

function Bar({ p }: { p: { done: number; planned: number; required: number } }) {
  const pct = (n: number) => (p.required ? Math.min(100, (n / p.required) * 100) : 0);
  return (
    <span className="bar">
      <span className="bar-done" style={{ width: `${pct(p.done)}%` }} />
      <span className="bar-planned" style={{ width: `${pct(p.planned)}%` }} />
    </span>
  );
}

/** Progress per container of the degree, keyed by container id, and per chosen program, keyed by code. */
interface OutlineProgress {
  byId: Map<string, Progress>;
  byProgram: Map<string, Progress>;
  /** Chosen program code -> id of the requirement it counts towards (it counts in one place only). */
  within: Map<string, string>;
  /** Status of every program on its own (drives the circle glows too). */
  finish: Map<string, Status>;
}

/** The degree's structure, coloured by progress: green done, blue done once planned, yellow started (US-027). */
function DegreeOutline({ degree, map }: { degree: Degree; map: MapDoc }) {
  const plan = useApp((s) => s.plan);
  const finish = useApp((s) => s.finish);
  const prog = useMemo(() => {
    const root = progress(map, degree.code, plan);
    const byId = new Map<string, Progress>();
    const byProgram = new Map<string, Progress>();
    const within = new Map<string, string>();
    const walk = (n: Progress, parent: string) => {
      if (n.program) byProgram.set(n.program, n), within.set(n.program, parent);
      else byId.set(n.id, n);
      n.children.forEach((c) => walk(c, n.id));
    };
    walk(root, '');
    return { byId, byProgram, within, finish };
  }, [map, degree.code, plan, finish]);
  return <OutlineSection container={degree.structure} prog={prog} />;
}

function OutlineSection({ container, prog }: { container: Program['structure']; prog?: OutlineProgress }) {
  const map = useApp((s) => s.map)!;
  const kindName = (code: string) => (map.programs[code]?.kind === 'sub_major' ? 'sub-major' : map.programs[code]?.kind === 'major' ? 'major' : 'program');
  const node = prog?.byId.get(container.id);
  const status = node ? progressStatus(node) : 'none';
  const ways = node?.ways ?? [];
  const intro = ways.length ? container.description.slice(0, container.description.search(/\b1\.\s/)).trim() : container.description;
  const programStatus = (code: string): Status => {
    const chosen = prog?.byProgram.get(code);
    if (chosen && prog?.within.get(code) !== container.id) return 'none';
    // A chosen program is at least started (yellow), even before any of it is done.
    if (chosen) return progressStatus({ ...chosen, chosen: true });
    const alone = prog?.finish.get(code);
    return alone === 'complete' || alone === 'planned' ? alone : 'none';
  };
  return (
    <section>
      {container.title !== 'Structure' ? (
        <h3 className={`st-${status}`} data-testid="outline-heading" data-status={status}>
          {container.title}{' '}
          {node ? (
            <span className="cp" data-testid="outline-cp">
              (<Cp p={node} />)
            </span>
          ) : container.creditPoints ? (
            <span className="cp">({container.creditPoints}cp)</span>
          ) : null}
          <Tick status={status} />
        </h3>
      ) : null}
      {intro ? <p className="muted">{intro}</p> : null}
      {container.kind === 'free' && node ? <FreeElectives node={node} /> : null}
      {ways.length ? (
        <ol className="ways">
          {ways.map((w) => {
            const ws = w.understood ? progressStatus(w) : 'none';
            return (
              <li key={w.text} className={`st-${ws}`} data-testid="outline-way" data-status={ws}>
                {w.text}
                <Tick status={ws} />
                {w.understood ? (
                  <>
                    <span className="way-num" data-testid="outline-way-cp">
                      <Cp p={w} />
                    </span>
                    <Bar p={w} />
                  </>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      <ul className="plain">
        {container.items.map((i) => {
          if (i.kind === 'subject')
            return (
              <li key={i.code}>
                <SubjectLink code={i.code} />
              </li>
            );
          const ps = programStatus(i.code);
          const home = prog?.within.get(i.code);
          const countsElsewhere = home !== undefined && home !== container.id;
          const shared = countsElsewhere ? [] : elsewhereIn(prog?.byProgram.get(i.code));
          return (
            <li key={i.code} className={`st-${ps}`} data-testid="outline-program" data-code={i.code} data-status={ps}>
              <ProgramLink code={i.code} />
              <Tick status={ps} />
              {countsElsewhere ? <span className="muted small"> (counts under {prog?.byId.get(home)?.title})</span> : null}
              {shared.length ? (
                <ul className="plain muted small" data-testid="outline-shared">
                  {shared.map((e) => (
                    <li key={e.code}>
                      <SubjectLink code={e.code} /> counts towards {e.by}, not here. Another subject from this {kindName(i.code)}'s options
                      makes up its {map.subjects[e.code]?.creditPoints ?? 0}cp.
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {container.children.map((c) => (
        <OutlineSection key={c.id} container={c} prog={prog} />
      ))}
    </section>
  );
}

/** What fills a free-elective slot, and what could (US-032). */
function FreeElectives({ node }: { node: Progress }) {
  const states = useApp((s) => s.states);
  const setGlow = useApp((s) => s.setGlow);
  // Any subject counts, so the useful ones to point at are those that can be taken now.
  const open = useMemo(() => [...states].filter(([, st]) => st === 'available').map(([c]) => c), [states]);
  return (
    <div className="free-electives" data-testid="free-electives">
      {node.fills?.length ? (
        <ul className="plain">
          {node.fills.map((c) => (
            <li key={c}>
              <SubjectLink code={c} />
            </li>
          ))}
        </ul>
      ) : null}
      <p
        className="muted small hint"
        data-testid="free-electives-hint"
        onMouseEnter={() => setGlow(open)}
        onMouseLeave={() => setGlow([])}
      >
        Any UTS subject not already counting towards something else can go here. Hover here to light up the {open.length} subjects on this map
        you could take now.
      </p>
    </div>
  );
}

/** Subjects inside a chosen program that count towards something else instead. */
function elsewhereIn(n: Progress | undefined, out: NonNullable<Progress['elsewhere']> = []) {
  if (!n) return out;
  for (const e of n.elsewhere ?? []) if (!out.some((o) => o.code === e.code)) out.push(e);
  n.children.forEach((c) => elsewhereIn(c, out));
  return out;
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
          <Cp p={p} />
        </span>
        <Bar p={p} />
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
