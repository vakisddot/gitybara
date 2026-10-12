import { ICSharpToken } from './types'

/** Decode LSP's relative, five-integer semantic token representation. */
export function decodeCSharpTokens(
  data: ReadonlyArray<number>,
  tokenTypes: ReadonlyArray<string>
): ReadonlyArray<ICSharpToken> {
  const tokens: ICSharpToken[] = []
  let line = 0
  let start = 0

  for (let offset = 0; offset + 4 < data.length; offset += 5) {
    const [deltaLine, deltaStart, length, typeIndex] = data.slice(
      offset,
      offset + 4
    )
    if (
      ![deltaLine, deltaStart, length, typeIndex].every(
        value => Number.isSafeInteger(value) && value >= 0
      )
    ) {
      break
    }

    line += deltaLine
    start = deltaLine === 0 ? start + deltaStart : deltaStart
    const type = tokenTypes[typeIndex]
    if (type !== undefined && length > 0) {
      tokens.push({ line, start, length, type })
    }
  }

  return tokens
}

/** Use only token categories that the editor has semantic styles for. */
export function getCSharpTokenClass(type: string): string | null {
  switch (type) {
    case 'type':
    case 'class':
    case 'struct':
    case 'interface':
    case 'enum':
    case 'delegate':
    case 'recordClass':
    case 'recordStruct':
    case 'typeParameter':
      return 'ide-csharp-type'
    case 'method':
    case 'function':
    case 'extensionMethod':
      return 'ide-csharp-method'
    case 'variable':
    case 'parameter':
    case 'field':
    case 'property':
    case 'event':
    case 'namespace':
      return 'ide-csharp-variable'
    case 'enumMember':
    case 'constant':
      return 'ide-csharp-constant'
    case 'keyword':
      return 'ide-csharp-keyword'
    case 'controlKeyword':
      return 'ide-csharp-control'
    case 'number':
      return 'ide-csharp-number'
    case 'operator':
    case 'operatorOverloaded':
      return 'ide-csharp-operator'
    case 'punctuation':
      return 'ide-csharp-punctuation'
    default:
      return null
  }
}
