export type IdeShortcut =
  | 'find'
  | 'previous-change'
  | 'next-change'
  | 'previous-lines'
  | 'whole-file'

/**
 * How long the key that shows the previous lines is held before it only shows
 * them while it's held, instead of switching them on or off, in milliseconds.
 */
export const PreviousLinesHoldDelay = 250

/** Inputs that take no text, so a letter that is typed in them isn't text */
const NonTextInputTypes = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/**
 * Whether the letters that are typed at the target are text for the target: a
 * field, a dialog or popover, or the editor while it can be edited.
 */
export function isTypingTarget(
  target: EventTarget | null,
  isEditorReadOnly: boolean
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  // The editor has a text area for its input, which takes no text when it can't
  // be edited
  if (target.closest('.ide-code-editor') !== null) {
    return !isEditorReadOnly
  }

  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      !NonTextInputTypes.has(target.type)) ||
    target.closest('dialog, [role="dialog"]') !== null
  )
}

/**
 * What a key press in the file viewer or a diff asks for, if anything. The keys
 * to go to the previous and the next change (W and S), to show the previous
 * lines (F) and to show the whole file (E) are plain letters, so they are left alone where the letters are typed. The
 * previous lines can be shown from there with Ctrl+' (Cmd+' on macOS).
 */
export function getIdeShortcut(
  event: KeyboardEvent,
  isEditorReadOnly: boolean
): IdeShortcut | null {
  if (event.defaultPrevented || event.altKey || event.isComposing) {
    return null
  }

  const key = event.key.toLowerCase()
  const isCmdOrCtrl = __DARWIN__
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey

  if (isCmdOrCtrl) {
    if (event.shiftKey) {
      return null
    }
    return key === 'f' ? 'find' : key === "'" ? 'previous-lines' : null
  }

  if (
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isTypingTarget(event.target, isEditorReadOnly)
  ) {
    return null
  }

  switch (key) {
    case 'w':
      return 'previous-change'
    case 's':
      return 'next-change'
    case 'f':
      return 'previous-lines'
    case 'e':
      return 'whole-file'
    default:
      return null
  }
}

/**
 * Whether the previous lines are shown once the key that shows them is let go.
 * A tap switches them on or off, while a longer press only shows them as long
 * as the key is held.
 */
export function arePreviousLinesShownAfterRelease(
  wereShown: boolean,
  heldFor: number
): boolean {
  return heldFor < PreviousLinesHoldDelay ? !wereShown : wereShown
}
