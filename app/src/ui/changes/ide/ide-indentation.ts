/** The widest indent that is looked for when guessing the indent of a file. */
const MaxIndentUnit = 8

/**
 * How many columns a line is indented, with tabs counting as going to the next
 * tab stop. A line with only whitespace has no indentation of its own, which
 * is `null`.
 */
export function getIndentColumns(line: string, tabSize: number): number | null {
  let columns = 0

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === ' ') {
      columns++
    } else if (char === '\t') {
      columns += tabSize - (columns % tabSize)
    } else {
      return columns
    }
  }

  return null
}

/**
 * Guess how many columns one level of indentation is in a file: the tab size
 * if the file is indented with tabs, otherwise the size that lines are most
 * often indented deeper than the line before them.
 */
export function detectIndentUnit(
  lines: ReadonlyArray<string>,
  tabSize: number
): number {
  const increases = new Array<number>(MaxIndentUnit + 1).fill(0)
  let previous = 0

  for (const line of lines) {
    if (line.startsWith('\t')) {
      return tabSize
    }

    const columns = getIndentColumns(line, tabSize)

    if (columns === null) {
      continue
    }

    const increase = columns - previous

    if (increase > 0 && increase <= MaxIndentUnit) {
      increases[increase]++
    }

    previous = columns
  }

  let unit = tabSize
  let mostOften = 0

  increases.forEach((count, size) => {
    if (count > mostOften) {
      mostOften = count
      unit = size
    }
  })

  return unit
}

/**
 * The indentation of each line in columns. Blank lines take the smaller of the
 * indentation of the lines around them, so the guides of a block run through
 * the empty lines in it but not past its end.
 */
export function getLineIndentation(
  lines: ReadonlyArray<string>,
  tabSize: number
): ReadonlyArray<number> {
  const own = lines.map(line => getIndentColumns(line, tabSize))
  const indentation = new Array<number>(lines.length).fill(0)

  // The indentation of the next line that isn't blank, from the end
  const next = new Array<number>(lines.length + 1).fill(0)
  for (let i = lines.length - 1; i >= 0; i--) {
    next[i] = own[i] ?? next[i + 1]
  }

  let previous = 0
  for (let i = 0; i < lines.length; i++) {
    const columns = own[i]

    if (columns === null) {
      indentation[i] = Math.min(previous, next[i + 1])
    } else {
      indentation[i] = columns
      previous = columns
    }
  }

  return indentation
}

/**
 * The style that draws a line at each level of indentation in the indentation
 * of a line, with the lines going from the start of the text. It's measured in
 * characters so it only works in a monospace font. Without any indentation
 * there is nothing to draw.
 *
 * @param columns  How many columns the line is indented.
 * @param unit     How many columns one level of indentation is.
 * @param offset   Where the text starts, as a CSS length.
 */
export function getIndentGuidesStyle(
  columns: number,
  unit: number,
  offset = '0px'
) {
  if (columns <= 0 || unit <= 0) {
    return undefined
  }

  const guideCount = Math.ceil(columns / unit)
  const color = 'var(--ide-indent-guide-color)'

  return {
    backgroundImage: `repeating-linear-gradient(to right, ${color} 0, ${color} 1px, transparent 1px, transparent ${unit}ch)`,
    backgroundSize: `${guideCount * unit}ch 100%`,
    backgroundPosition: `${offset} 0`,
    backgroundRepeat: 'no-repeat',
  }
}
