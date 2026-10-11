export type IdeShortcut = 'find' | 'previous-change' | 'next-change'

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
 * What a key press in the file viewer asks for, if anything. The keys to go to
 * the previous and the next change (W and S) are plain letters, so they are left
 * alone where the letters are typed.
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
    return key === 'f' && !event.shiftKey ? 'find' : null
  }

  if (
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    isTypingTarget(event.target, isEditorReadOnly)
  ) {
    return null
  }

  return key === 'w' ? 'previous-change' : key === 's' ? 'next-change' : null
}
