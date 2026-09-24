#!/usr/bin/env bash
# Plants one known bug at a time and requires the test suite to go red for each.
# A test that cannot fail is worse than no test.
set -uo pipefail
cd "$(dirname "$0")/.."

mutations=(
  "core/engine.ts|return rule.op === 'and' ? rule.args.every|return rule.op === 'or' ? rule.args.every"
  "core/engine.ts|if (map.subjects[c]?.antiRequisites.includes(subject.code)) return true;|"
  "core/engine.ts|for (const p of parts) if (cost(p) < cost(best)) best = p;|best = parts[0];"
  "core/engine.ts|if (claimed.has(item.code)) continue;|"
  "core/engine.ts|else if (ruleMet(s.requisite, later)) state = 'reachable';|"
  "core/engine.ts|if ('course' in rule) return ctx.enrolled ? rule.course === ctx.enrolled : !!ctx.map.degrees[rule.course];|if ('course' in rule) return true;"
  "core/engine.ts|else if (room >= cp(code) && cp(code) > 0) {|else if (cp(code) > 0) {"
  "core/engine.ts|      impossible = true;|"
  "core/layout.ts|const a1 = a0 + dir * (Math.abs(d) - 2 * da);|const a1 = leg.to - dir * da;"
  "core/layout.ts|do loopOf.set((m = stack.pop()!), groups);|do loopOf.set((m = stack.pop()!), groups++);"
  "core/layout.ts|let ok = clearEnd(a, k, r.from) && clearEnd(a, t, r.to);|let ok = true;"
  "core/linkQuality.ts|else if (deg < 5 && segmentGap(A.s, B.s) < 2)|else if (deg < 5 && segmentGap(A.s, B.s) < 0)"
  "core/layout.ts|...kids.map((b) => ({ r: b.outer.r + CHILD_GAP / 2,|...kids.map((b) => ({ r: b.r + CHILD_GAP / 2,"
  "core/layout.ts|const placed = tops.map((b) => ({ r: b.outer.r + TOP_GAP / 2,|const placed = tops.map((b) => ({ r: b.r + TOP_GAP / 2,"
  "core/layout.ts|    got[n - 1] = Math.min(got[n - 1], got[0] + TAU - min);|"
  "core/layout.ts|      else if (!members.has(r)) entries.add(r);|"
  "core/layout.ts|if (!best || c.r < best.r || (c.r === best.r && d < bestD)) (best = c), (bestD = d);|if (!best || c.r < best.r) (best = c), (bestD = d);"
  "core/layout.ts|else if ('subject' in rule && !out.has(rule.subject)) out.set(rule.subject, inOr ? 'alt' : 'req');|else if ('subject' in rule && !out.has(rule.subject)) out.set(rule.subject, 'req');"
  "scraper/src/access.ts|const orExpr = (): RuleNode => list('or', andExpr);|const orExpr = (): RuleNode => list('and', andExpr);"
  "scraper/src/normalize.ts|return { creditPoints: item.min, scope: item.scope };|return { text: item.scope };"
)

failed=0
for m in "${mutations[@]}"; do
  IFS='|' read -r file from to <<<"$m"
  cp "$file" "$file.bak"
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1:4]
s = open(path).read()
if old not in s:
    sys.exit(f"mutation target not found in {path}: {old}")
open(path, "w").write(s.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then echo "SETUP FAIL: $file: $from"; failed=1; mv "$file.bak" "$file"; continue; fi
  if npx vitest run >/dev/null 2>&1; then
    echo "NOT CAUGHT: $file: $from"; failed=1
  else
    echo "caught:     $file: ${from:0:70}"
  fi
  mv "$file.bak" "$file"
done

npx vitest run >/dev/null 2>&1 || { echo "suite is red after restoring sources"; exit 1; }
exit $failed
