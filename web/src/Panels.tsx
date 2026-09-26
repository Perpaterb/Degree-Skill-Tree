import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from 'react';
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
  type Lock,
  type Status,
  type WayPart,
  type WayPartProgress,
  type WayProgress,
} from '../../core/engine';
import { chosenDegrees, partnersOf } from '../../core/pairs';
import type { Container, Degree, MapDoc, Program, Rule, Subject } from '../../core/model';
import { track } from './analytics';
import { useApp } from './store';
import { cssColor, facultyColour, stateLabel, stateLook } from './theme';
import { TEXT_SIZE_MAX, TEXT_SIZE_MIN } from './view';

function Dot({ state }: { state: NodeState | undefined }) {
  useApp((s) => s.theme); // colours come from the theme
  const look = stateLook[state ?? 'locked'];
  return <span className="dot" style={{ background: cssColor(look.fill), borderColor: cssColor(look.ring) }} title={stateLabel[state ?? 'locked']} />;
}

function SubjectLink({ code }: { code: string }) {
  const map = useApp((s) => s.map)!;
  const state = useApp((s) => s.states.get(code));
  const select = useApp((s) => s.select);
  const glow = useGlowOn([code]);
  const s = map.subjects[code];
  if (!s) return <span className="muted">{code} (not on this map)</span>;
  return (
    <button className="link" onClick={() => select(code, true)} {...glow}>
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
  const lock = useApp((s) => s.locks.get(program.code));
  return (
    <>
      <div className="kicker">{kind}</div>
      <h2>{program.title}</h2>
      <div className="meta">
        {program.code} {program.creditPoints ? `· ${program.creditPoints}cp` : ''}
      </div>
      {program.legacy ? <p className="note">Named by a degree but not published in the {map.year} handbook.</p> : null}
      {lock ? <LockNote lock={lock} degree={degree ? map.degrees[degree] : undefined} chosen={chosen} /> : null}
      {program.onlyWith ? null : offered || chosen ? (
        <div className="actions">
          {chosen && lock ? (
            <button onClick={() => toggle(program.code)} data-testid="unchoose">
              Unchoose
            </button>
          ) : (
            <button className={chosen ? 'on' : ''} onClick={() => toggle(program.code)} disabled={program.legacy || !!lock}>
              {chosen ? `✓ Chosen` : `Choose this ${kind.toLowerCase()}`}
            </button>
          )}
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

/**
 * Choosing a degree (US-046), adding a second to make a double (US-048), an add-on half waiting for a
 * degree to join (US-049), and a degree locked by the current choice (US-047).
 */
function DegreeActions({ degree, map }: { degree: Degree; map: MapDoc }) {
  const current = useApp((s) => s.plan.degree);
  const lock = useApp((s) => s.degreeLocks.get(degree.code));
  const selectDegree = useApp((s) => s.selectDegree);
  const chosen = chosenDegrees(map, current);
  const now = current ? map.degrees[current] : null;
  const made = current && !now?.halves ? partnersOf(map, current).get(degree.code) : undefined;
  const pairs = degree.addOn ? [...partnersOf(map, degree.code).keys()].map((c) => map.degrees[c]) : [];
  let button: ReactElement;
  if (current === degree.code) {
    button = (
      <button className="on" onClick={() => selectDegree(null)} data-testid="choose-degree">
        ✓ Chosen (clear)
      </button>
    );
  } else if (chosen.includes(degree.code)) {
    // One half of the chosen double: removing it leaves the other, unless that is an add-on half.
    const other = now!.halves!.find((h) => h !== degree.code)!;
    button = (
      <button className="on" onClick={() => selectDegree(map.degrees[other].addOn ? null : other)} data-testid="choose-degree">
        ✓ Chosen, part of {now!.title} (remove)
      </button>
    );
  } else if (lock) {
    button = (
      <button disabled data-testid="choose-degree">
        Locked
      </button>
    );
  } else if (made) {
    button = (
      <button onClick={() => selectDegree(made)} data-testid="choose-degree">
        Add to make {map.degrees[made].title}
      </button>
    );
  } else {
    button = (
      <button onClick={() => selectDegree(degree.code)} data-testid="choose-degree">
        Choose this degree
      </button>
    );
  }
  return (
    <>
      {degree.halves ? (
        <p className="note" data-testid="double-halves">
          A double degree: choose {map.degrees[degree.halves[0]].title} and {map.degrees[degree.halves[1]].title}, in either order.
        </p>
      ) : null}
      {degree.addOn ? (
        <p className="note" data-testid="add-on-note">
          Only as part of a double degree. It pairs with: {pairs.map((d) => d.title).join(', ')}.
        </p>
      ) : null}
      {lock ? (
        <div className="note lock-note" data-testid="degree-lock-note">
          <b>✗ Locked.</b> {lock}{' '}
          {current ? (
            <button className="link" onClick={() => selectDegree(null)}>
              Clear {now!.title}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="actions">{button}</div>
    </>
  );
}

function DegreeDetail({ degree, map }: { degree: Degree; map: MapDoc }) {
  const plan = useApp((s) => s.plan);
  const fit = useApp((s) => s.fits.get(degree.code));
  const selectDegree = useApp((s) => s.selectDegree);
  const isSel = plan.degree === degree.code;
  const root = useMemo(() => progress(map, degree.code, plan), [map, degree.code, plan]);
  const glow = useGlowOn([degree.code]);
  const noMajor = isSel && plan.programs.filter((p) => degreesOffering(map, p).some((d) => d.code === degree.code)).length === 0;
  return (
    <>
      <div className="kicker">Degree</div>
      <DegreeTitle degree={degree} />
      <div className="meta">
        {degree.code} · {degree.creditPoints}cp · {degree.faculty}
      </div>
      <div className="degree-total" data-testid="degree-total" {...glow}>
        <span>Progress</span>
        <b data-testid="progress-total">
          <Cp p={root} />
        </b>
        <Bar p={root} />
      </div>
      <DegreeActions degree={degree} map={map} />
      {noMajor ? <p className="muted small">Choose a major: hover "Major" in the outline to see them, then click one of the glowing circles.</p> : null}
      {fit && fit.completedCp > 0 ? (
        <section data-testid="degree-fit">
          <h3>Your completed subjects</h3>
          <p>
            {fit.countingCp} of your {fit.completedCp}cp would count towards this degree.
            {fit.impossible ? ' It can no longer be completed as things stand.' : ''}
          </p>
          {fit.wasted.length ? (
            <div className="not-counting" data-testid="not-counting">
              <p className="muted">These subjects do not count towards this degree:</p>
              <ul className="plain">
                {fit.wasted.map((w) => (
                  <li key={w.code}>
                    <SubjectLink code={w.code} /> <span className="muted">: {w.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <DegreeOutline degree={degree} root={root} />
      <p>
        <a href={degree.url} target="_blank" rel="noreferrer">
          Official handbook page ↗
        </a>
      </p>
    </>
  );
}

/** A degree's title, each part in its faculty's colour (US-039, US-040). */
function DegreeTitle({ degree }: { degree: Degree }) {
  useApp((s) => s.theme); // the colours are made readable per theme
  const parts = degree.titleParts?.length ? degree.titleParts : [{ text: degree.title, faculty: degree.faculty, colour: null }];
  return (
    <h2 data-testid="degree-title">
      {parts.map((p, i) => (
        <span key={i} data-faculty={p.faculty} style={{ color: cssColor(facultyColour(p.colour)) }}>
          {i ? ' ' : ''}
          {p.text}
        </span>
      ))}
    </h2>
  );
}

/** Why a program can no longer count towards the selected degree, and what is in the way (US-037, US-038). */
function LockNote({ lock, degree, chosen }: { lock: Lock; degree: Degree | undefined; chosen: boolean }) {
  const map = useApp((s) => s.map)!;
  return (
    <div className="note lock-note" data-testid="lock-note" data-why={lock.why}>
      <b>
        ✗{' '}
        {lock.why === 'pairing' || !degree
          ? chosen
            ? 'Chosen, but locked.'
            : 'Locked.'
          : chosen
            ? `Chosen, but cannot count towards ${degree.title}.`
            : `Cannot count towards ${degree.title}.`}
      </b>{' '}
      {lock.text}
      {lock.blockers.length ? (
        <ul className="plain">
          {lock.blockers.map((b) => (
            <li key={b}>{map.programs[b] ? <ProgramLink code={b} /> : <SubjectLink code={b} />}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StructureView({ container }: { container: Container }) {
  return <OutlineSection container={container} />;
}

/** A tick after a line that is met (green) or met once the plan is done (purple). */
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

/** Pointer and focus handlers that glow these circles or subjects on the map (US-033). */
function useGlowOn(ids: string[]) {
  const setGlow = useApp((s) => s.setGlow);
  if (!ids.length) return {};
  const on = () => setGlow(ids);
  const off = () => setGlow([]);
  return { onMouseEnter: on, onMouseLeave: off, onFocus: on, onBlur: off };
}

/** Click and keyboard handlers for a row that opens and closes (US-034). */
function toggleProps(open: boolean, setOpen: (o: boolean) => void) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    'data-open': open,
    onClick: () => setOpen(!open),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') e.preventDefault(), setOpen(!open);
    },
  };
}

/** Every program and subject a container names, itself and below. */
function codesUnder(c: Container, out: string[] = []): string[] {
  for (const i of c.items) if (!out.includes(i.code)) out.push(i.code);
  c.children.forEach((k) => codesUnder(k, out));
  return out;
}

/** The containers below `c` that hold something, looking through headings that only group others (US-035). */
function leavesOf(c: Container): Container[] {
  return c.children.flatMap((k) => (!k.items.length && k.children.length ? leavesOf(k) : [k]));
}

/** What a container offers in the terms a way uses: majors, sub-majors, a stream, or free electives. */
function offers(c: Container, map: MapDoc): WayPart['what'] | null {
  if (c.children.length) return null;
  if (c.kind === 'free') return 'electives';
  const kinds = new Set(c.items.map((i) => (i.kind === 'program' ? map.programs[i.code]?.kind : 'subject')));
  const [k] = kinds;
  return kinds.size === 1 && (k === 'major' || k === 'sub_major' || k === 'stream') ? k : null;
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

/** The degree's structure, coloured by progress: green done, purple done once planned, yellow started (US-027). */
function DegreeOutline({ degree, root }: { degree: Degree; root: Progress }) {
  const finish = useApp((s) => s.finish);
  const prog = useMemo(() => {
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
  }, [root, finish]);
  return <OutlineSection container={degree.structure} prog={prog} />;
}

/** Colour of a program line in the list of requirement `containerId`. */
function programStatus(code: string, containerId: string, prog?: OutlineProgress): Status {
  const chosen = prog?.byProgram.get(code);
  if (chosen && prog?.within.get(code) !== containerId) return 'none';
  // A chosen program is at least started (yellow), even before any of it is done.
  if (chosen) return progressStatus({ ...chosen, chosen: !chosen.implied });
  const alone = prog?.finish.get(code);
  return alone === 'complete' || alone === 'planned' ? alone : 'none';
}

/** A program that counts towards another requirement of the degree is not offered here too (US-036). */
function countsElsewhere(code: string, containerId: string, prog?: OutlineProgress) {
  const home = prog?.within.get(code);
  return home !== undefined && home !== containerId;
}

function ProgramLine({ code, containerId, prog }: { code: string; containerId: string; prog?: OutlineProgress }) {
  const map = useApp((s) => s.map)!;
  const kindName = map.programs[code]?.kind === 'sub_major' ? 'sub-major' : map.programs[code]?.kind === 'major' ? 'major' : 'program';
  const lock = useApp((s) => (prog ? s.locks.get(code) : undefined));
  const ps = programStatus(code, containerId, prog);
  const shared = elsewhereIn(prog?.byProgram.get(code));
  // Locked out of the selected degree: greyed and crossed, with the reason on hover (US-037).
  if (lock)
    return (
      <li className="st-locked" data-testid="outline-program" data-code={code} data-status="locked" title={lock.text}>
        <ProgramLink code={code} />
        <span className="cross"> ✗</span>
      </li>
    );
  return (
    <li className={`st-${ps}`} data-testid="outline-program" data-code={code} data-status={ps}>
      <ProgramLink code={code} />
      <Tick status={ps} />
      {shared.length ? (
        <ul className="plain muted small" data-testid="outline-shared">
          {shared.map((e) => (
            <li key={e.code}>
              <SubjectLink code={e.code} /> counts towards {e.by}, not here. Another subject from this {kindName}'s options makes up its{' '}
              {map.subjects[e.code]?.creditPoints ?? 0}cp.
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** What can fill one part of a way: the programs its containers list, or the electives filling it (US-035). */
function partContents(what: WayPart['what'], from: Container[], prog?: OutlineProgress) {
  if (what === 'electives') {
    const fills = [...new Set(from.flatMap((c) => prog?.byId.get(c.id)?.fills ?? []))];
    return { fills, programs: [], ids: fills };
  }
  const programs: { code: string; containerId: string }[] = [];
  for (const c of from)
    for (const i of c.items)
      if (i.kind === 'program' && !programs.some((p) => p.code === i.code) && !countsElsewhere(i.code, c.id, prog)) programs.push({ code: i.code, containerId: c.id });
  return { fills: [], programs, ids: programs.map((p) => p.code) };
}

function PartBody({ what, from, prog }: { what: WayPart['what']; from: Container[]; prog?: OutlineProgress }) {
  const { fills, programs } = partContents(what, from, prog);
  if (what === 'electives') return <FreeElectives fills={fills} />;
  return (
    <ul className="plain way-choices">
      {programs.map((p) => (
        <ProgramLine key={p.code} code={p.code} containerId={p.containerId} prog={prog} />
      ))}
    </ul>
  );
}

function WayPartRow({ part, from, prog }: { part: WayPartProgress; from: Container[]; prog?: OutlineProgress }) {
  const ps = progressStatus(part);
  const glow = useGlowOn(partContents(part.what, from, prog).ids);
  return (
    <div className="way-part">
      <div className={`part-row st-${ps}`} data-testid="outline-part" data-what={part.what} data-status={ps} {...glow}>
        {part.text}
        <Tick status={ps} />
        <span className="way-num" data-testid="outline-part-cp">
          <Cp p={part} />
        </span>
        <Bar p={part} />
      </div>
      <PartBody what={part.what} from={from} prog={prog} />
    </div>
  );
}

/** One numbered way; open, it shows each of its parts and what can fill them (US-034, US-035). */
function WayRow({ way, leaves, prog }: { way: WayProgress; leaves: { c: Container; what: WayPart['what'] | null }[]; prog?: OutlineProgress }) {
  const [open, setOpen] = useState(false);
  const ws = way.understood ? progressStatus(way) : 'none';
  const parts = way.parts.map((p) => ({ p, from: leaves.filter((l) => l.what === p.what).map((l) => l.c) }));
  const glow = useGlowOn([...new Set(parts.flatMap(({ p, from }) => partContents(p.what, from, prog).ids))]);
  return (
    <li>
      <div
        className={`way-row st-${ws}${way.understood ? ' outline-toggle' : ''}`}
        data-testid="outline-way"
        data-status={ws}
        {...(way.understood ? toggleProps(open, setOpen) : {})}
        {...glow}
      >
        {way.text}
        <Tick status={ws} />
        {way.understood ? (
          <>
            <span className="way-num" data-testid="outline-way-cp">
              <Cp p={way} />
            </span>
            <Bar p={way} />
          </>
        ) : null}
      </div>
      {open && way.understood ? (
        <div className="way-body" data-testid="outline-way-body">
          {parts.length === 1 ? (
            <PartBody what={parts[0].p.what} from={parts[0].from} prog={prog} />
          ) : (
            parts.map(({ p, from }) => <WayPartRow key={p.text} part={p} from={from} prog={prog} />)
          )}
        </div>
      ) : null}
    </li>
  );
}

function OutlineSection({ container, prog }: { container: Container; prog?: OutlineProgress }) {
  const map = useApp((s) => s.map)!;
  const [open, setOpen] = useState(true);
  const node = prog?.byId.get(container.id);
  const status = node ? progressStatus(node) : 'none';
  const ways = node?.ways ?? [];
  const intro = ways.length ? container.description.slice(0, container.description.search(/\b1\.\s/)).trim() : container.description;
  const glow = useGlowOn(useMemo(() => codesUnder(container), [container]));
  // With numbered ways, the containers below are shown under the ways that use them, and headings
  // that only group others are dropped; anything no way uses is still shown after the ways (US-035).
  const byWays = ways.some((w) => w.understood);
  const leaves = byWays ? leavesOf(container).map((c) => ({ c, what: offers(c, map) })) : [];
  const used = new Set(ways.flatMap((w) => w.parts.map((p) => p.what)));
  const rest = byWays ? leaves.filter((l) => !l.what || !used.has(l.what)).map((l) => l.c) : container.children;
  const root = container.title === 'Structure';
  return (
    <section>
      {!root ? (
        <h3
          className={`outline-toggle st-${status}`}
          data-testid="outline-heading"
          data-status={status}
          {...toggleProps(open, setOpen)}
          {...glow}
        >
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
      {open || root ? (
        <div className={root ? '' : 'outline-body'}>
          {intro ? <p className="muted">{intro}</p> : null}
          {container.kind === 'free' && node ? <FreeElectives fills={node.fills ?? []} /> : null}
          {ways.length ? (
            <ol className="ways">
              {ways.map((w) => (
                <WayRow key={w.text} way={w} leaves={leaves} prog={prog} />
              ))}
            </ol>
          ) : null}
          <ul className="plain">
            {container.items.map((i) =>
              i.kind === 'subject' ? (
                <li key={i.code}>
                  <SubjectLink code={i.code} />
                </li>
              ) : countsElsewhere(i.code, container.id, prog) ? null : (
                <ProgramLine key={i.code} code={i.code} containerId={container.id} prog={prog} />
              ),
            )}
          </ul>
          {rest.map((c) => (
            <OutlineSection key={c.id} container={c} prog={prog} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** What fills a free-elective slot, and what could (US-032). */
function FreeElectives({ fills }: { fills: string[] }) {
  const states = useApp((s) => s.states);
  const setGlow = useApp((s) => s.setGlow);
  // Any subject counts, so the useful ones to point at are those that can be taken now.
  const open = useMemo(() => [...states].filter(([, st]) => st === 'available').map(([c]) => c), [states]);
  return (
    <div className="free-electives" data-testid="free-electives">
      {fills.length ? (
        <ul className="plain">
          {fills.map((c) => (
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
  const glow = useGlowOn([code]);
  const p = map.programs[code];
  return (
    <button className="link" onClick={() => select(code, true)} {...glow}>
      ◆ {p?.title ?? code}
    </button>
  );
}

export function DetailPanel() {
  const map = useApp((s) => s.map);
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  // A hovered row that goes away with the panel's content never gets its mouseleave.
  useEffect(() => useApp.getState().setGlow([]), [selected]);
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

/** The selected degree and its total, while its panel is not open; click to reopen it (US-033). */
export function DegreeChip() {
  const map = useApp((s) => s.map);
  const plan = useApp((s) => s.plan);
  const selected = useApp((s) => s.selected);
  const select = useApp((s) => s.select);
  const selectDegree = useApp((s) => s.selectDegree);
  const root = useMemo(() => (map && plan.degree ? progress(map, plan.degree, plan) : null), [map, plan]);
  const glow = useGlowOn(map ? chosenDegrees(map, plan.degree) : []);
  if (!map || !root || !plan.degree || selected === plan.degree) return null;
  return (
    <div className="panel degree-chip" data-testid="degree-chip">
      <button className="chip-open" onClick={() => select(plan.degree)} title="Open this degree's panel" {...glow}>
        <span className="chip-title">{map.degrees[plan.degree]?.title}</span>
        <b data-testid="progress-total">
          <Cp p={root} />
        </b>
        <Bar p={root} />
      </button>
      <button className="chip-clear" onClick={() => selectDegree(null)} aria-label="Clear degree" title="Clear degree">
        ×
      </button>
    </div>
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
              {map.institution} {map.year} · {Object.values(map.degrees).filter((d) => !d.addOn).length} degrees
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
            // An add-on half is never chosen first (US-049).
            .filter((d) => !d.addOn)
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
        <ViewSettingsButton />
        <ThemeButton />
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

/** Switches light and dark (US-030). */
function ThemeButton() {
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button onClick={() => setTheme(next)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`} data-testid="theme-toggle">
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  );
}

/** The view settings popup (US-029). */
function ViewSettingsButton() {
  const [open, setOpen] = useState(false);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  return (
    <div className="view-settings" ref={box}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label="View settings" title="View settings" data-testid="view-settings-button">
        ⚙
      </button>
      {open ? (
        <div className="view-popup" role="dialog" aria-label="View settings" data-testid="view-settings">
          <h4>View</h4>
          <label className="check">
            <input type="checkbox" checked={view.grow} onChange={(e) => setView({ grow: e.target.checked })} data-testid="view-grow" />
            Text grows with zoom
          </label>
          <p className="muted small">{view.grow ? 'Grows and shrinks as you zoom, within limits.' : 'Stays the same size on screen at every zoom.'}</p>
          <label className="slider">
            <span>
              Text size <b data-testid="view-size-value">{Math.round(view.textSize * 100)}%</b>
            </span>
            <input
              type="range"
              min={TEXT_SIZE_MIN * 100}
              max={TEXT_SIZE_MAX * 100}
              step={10}
              value={Math.round(view.textSize * 100)}
              onChange={(e) => setView({ textSize: Number(e.target.value) / 100 })}
              data-testid="view-size"
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={view.showCp} onChange={(e) => setView({ showCp: e.target.checked })} data-testid="view-cp" />
            Show credit points on titles
          </label>
        </div>
      ) : null}
    </div>
  );
}

export function Legend() {
  useApp((s) => s.theme); // colours come from the theme
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
