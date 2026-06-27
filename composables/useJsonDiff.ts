// Minimal line-level JSON diff (LCS) for the Save & Preview modal.
// Renders the committed config vs the draft as classic +/- diff lines.

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

export function jsonLineDiff(before: unknown, after: unknown): DiffLine[] {
  const a = JSON.stringify(before, null, 2).split('\n')
  const b = JSON.stringify(after, null, 2).split('\n')
  const m = a.length
  const n = b.length

  // LCS length table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i] }); i++; j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] }); i++
    } else {
      out.push({ type: 'add', text: b[j] }); j++
    }
  }
  while (i < m) out.push({ type: 'del', text: a[i++] })
  while (j < n) out.push({ type: 'add', text: b[j++] })
  return out
}

export function hasDiff(lines: DiffLine[]): boolean {
  return lines.some(l => l.type !== 'ctx')
}
