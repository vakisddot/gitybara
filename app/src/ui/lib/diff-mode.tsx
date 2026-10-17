import { clamp } from '../../lib/clamp'
import {
  getBoolean,
  getNumber,
  setBoolean,
  setNumber,
} from '../../lib/local-storage'

export const ShowSideBySideDiffDefault = false
export const ShowGitybaraDiffDefault = false
// The key is from when the Gitybara view was called Full file, so that the
// choice carries over
const showGitybaraDiffKey = 'show-full-file-diff'
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
 * Gets a value indicating whether to show diffs in the Gitybara view, the
 * editor of the IDE view, instead of the unified or split view.
 */
export function getShowGitybaraDiff(): boolean {
  return getBoolean(showGitybaraDiffKey, ShowGitybaraDiffDefault)
}

export function setShowGitybaraDiff(showGitybaraDiff: boolean) {
  setBoolean(showGitybaraDiffKey, showGitybaraDiff)
}

// The key is from when only the IDE view had this, so that the choice carries
// over
const unchangedTextOpacityKey = 'ide-unchanged-text-opacity'

/**
 * How visible the text of unchanged lines is in the diffs and the IDE view, as
 * a percentage.
 */
export function getUnchangedTextOpacity(): number {
  return clamp(getNumber(unchangedTextOpacityKey, 100), 0, 100)
}

export function setUnchangedTextOpacity(unchangedTextOpacity: number) {
  setNumber(unchangedTextOpacityKey, unchangedTextOpacity)
}
