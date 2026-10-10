import { getBoolean, setBoolean } from '../../lib/local-storage'

export const ShowSideBySideDiffDefault = false
export const ShowFullFileDiffDefault = false
const showFullFileDiffKey = 'show-full-file-diff'
const showSideBySideDiffKey = 'show-side-by-side-diff'

/**
 * Gets a value indicating whether not to present diffs in a split view mode
 * as opposed to unified (the default).
 */
export function getShowSideBySideDiff(): boolean {
  return getBoolean(showSideBySideDiffKey, ShowSideBySideDiffDefault)
}

/**
 * Sets a local storage key indicating whether not to present diffs in a split
 * view mode as opposed to unified (the default).
 */
export function setShowSideBySideDiff(showSideBySideDiff: boolean) {
  setBoolean(showSideBySideDiffKey, showSideBySideDiff)
}

/**
 * Gets a value indicating whether to show the whole file, like the IDE view
 * does, instead of the diff of the changes to it.
 */
export function getShowFullFileDiff(): boolean {
  return getBoolean(showFullFileDiffKey, ShowFullFileDiffDefault)
}

export function setShowFullFileDiff(showFullFileDiff: boolean) {
  setBoolean(showFullFileDiffKey, showFullFileDiff)
}
