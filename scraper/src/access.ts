import { parse, type HTMLElement } from 'node-html-parser';
import { cached, fetchText } from './http.js';

// Requisites are not in the handbook data: the handbook links out to this
// public "access conditions" page, which is where enrolment rules live.
export const ACCESS_URL = 'https://studentforms.uts.edu.au/evop/access/search.cfm?subjectcode=';

export type RuleNode = { op: 'and' | 'or'; args: RuleNode[] } | { ref: string };

export type RequisiteItem =
  | { id: string; type: string; kind: 'subject'; code: string; title: string }
  | { id: string; type: string; kind: 'course'; code: string; title: string }
  | { id: string; type: string; kind: 'credit_points'; min: number; scope: string }
  | { id: string; type: string; kind: 'text'; text: string };

export interface RequisiteBlock {
  ruleText: string;
  rule: RuleNode | null;
  items: RequisiteItem[];
}

export interface AccessConditions {
  requisites: RequisiteBlock | null;
  antiRequisites: RequisiteBlock | null;
  /** Any other headed sections we did not recognise, kept verbatim so nothing is silently lost. */
  other: { heading: string; text: string }[];
}

/** Parse "(1 AND (2 OR 2a) AND 3)" into a tree. AND binds tighter than OR. Throws on malformed input. */
export function parseRule(text: string): RuleNode {
  const tokens = text.match(/\(|\)|[A-Za-z0-9]+/g) ?? [];
  let pos = 0;
  const peekOp = (op: string) => pos < tokens.length && tokens[pos].toUpperCase() === op;

  function list(op: 'and' | 'or', next: () => RuleNode): RuleNode {
    const args = [next()];
    while (peekOp(op.toUpperCase())) {
      pos++;
      args.push(next());
    }
    return args.length === 1 ? args[0] : { op, args };
  }
  const orExpr = (): RuleNode => list('or', andExpr);
  const andExpr = (): RuleNode => list('and', term);

  function term(): RuleNode {
    const t = tokens[pos++];
    if (t === undefined) throw new Error(`unexpected end of rule: ${text}`);
    if (t === '(') {
      const node = orExpr();
      if (tokens[pos++] !== ')') throw new Error(`unbalanced rule: ${text}`);
      return node;
    }
    if (/^(AND|OR|\))$/i.test(t)) throw new Error(`unexpected "${t}" in rule: ${text}`);
    return { ref: t };
  }

  const node = orExpr();
  if (pos !== tokens.length) throw new Error(`trailing tokens in rule: ${text}`);
  return node;
}

export function classifyItem(id: string, type: string, details: string): RequisiteItem {
  const d = details.replace(/\s+/g, ' ').trim();
  let m = d.match(/^(\d{5,6})\s+(.+)$/);
  if (m) return { id, type, kind: 'subject', code: m[1], title: m[2] };
  m = d.match(/^([A-Z]\d{5})\s+(.+)$/);
  if (m) return { id, type, kind: 'course', code: m[1], title: m[2] };
  m = d.match(/at least (\d+) credit points?(?: in)?\s*(.*)$/i);
  if (m) return { id, type, kind: 'credit_points', min: Number(m[1]), scope: m[2].trim() };
  return { id, type, kind: 'text', text: d };
}

function parseBlock(table: HTMLElement): RequisiteBlock {
  const rows = table.querySelectorAll('tr');
  let ruleText = '';
  const items: RequisiteItem[] = [];
  for (const tr of rows) {
    const cells = tr.querySelectorAll('td').map((c) => c.text.replace(/\s+/g, ' ').trim());
    if (cells.length === 0) continue; // header row of <th>
    const ruleMatch = cells[0].match(/rule:\s*(.*)$/i);
    if (cells.length === 1 && ruleMatch) {
      ruleText = ruleMatch[1].trim();
      continue;
    }
    if (cells.length === 2) items.push(classifyItem(cells[0], '', cells[1]));
    else if (cells.length >= 3) items.push(classifyItem(cells[0], cells[1], cells[2]));
  }
  let rule: RuleNode | null = null;
  if (ruleText) rule = parseRule(ruleText);
  else if (items.length === 1) rule = { ref: items[0].id };
  return { ruleText, rule, items };
}

export function parseAccessConditions(html: string): AccessConditions {
  const root = parse(html);
  const out: AccessConditions = { requisites: null, antiRequisites: null, other: [] };
  for (const h3 of root.querySelectorAll('h3')) {
    const heading = h3.text.trim();
    let table = h3.nextElementSibling;
    while (table && table.tagName !== 'TABLE') table = table.nextElementSibling;
    if (!table) continue;
    if (/^anti-requisite/i.test(heading)) out.antiRequisites = parseBlock(table);
    else if (/^requisite/i.test(heading)) out.requisites = parseBlock(table);
    else out.other.push({ heading, text: table.text.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

export async function fetchAccessConditions(rawDir: string, code: string): Promise<AccessConditions> {
  const html = await cached(`${rawDir}/access/${code}.html`, () => fetchText(ACCESS_URL + code));
  return parseAccessConditions(html);
}
