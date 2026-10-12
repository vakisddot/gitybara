/** A zero-based UTF-16 position in a C# document. */
export interface ICSharpPosition {
  readonly line: number
  readonly character: number
}

/** The working copy to synchronize before asking Roslyn about a document. */
export interface ICSharpDocument {
  readonly repositoryPath: string
  readonly path: string
  readonly text: string
  readonly isDirty?: boolean
}

/** A source location inside the repository. */
export interface ICSharpLocation {
  readonly path: string
  readonly position: ICSharpPosition
}

/** A semantic token returned by Roslyn, with its legend entry resolved. */
export interface ICSharpToken {
  readonly line: number
  readonly start: number
  readonly length: number
  readonly type: string
}

/** Language features stay optional when setup or project loading fails. */
export interface ICSharpHighlightResult {
  readonly tokens: ReadonlyArray<ICSharpToken>
  readonly error: string | null
}

/** Definitions and references can have more than one source location. */
export interface ICSharpNavigationResult {
  readonly locations: ReadonlyArray<ICSharpLocation>
  readonly error: string | null
}

/** The part of the document for which semantic colors are needed. */
export interface ICSharpRange {
  readonly start: ICSharpPosition
  readonly end: ICSharpPosition
}
