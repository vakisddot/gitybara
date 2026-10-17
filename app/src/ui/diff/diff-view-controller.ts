import { shallowEquals } from '../../lib/equality'

/** What a diff can do, for the controls in its header */
export interface IDiffViewState {
  /** Whether there are changes to go to */
  readonly hasChanges: boolean

  /** Whether the diff can show the whole file, or go back from showing it */
  readonly canToggleWholeFile: boolean

  /** Whether the diff shows the whole file */
  readonly isWholeFileExpanded: boolean

  /** How visible the text of unchanged lines is, as a percentage */
  readonly unchangedTextOpacity: number
}

/** A diff that the controls in its header act on */
export interface IDiffView {
  goToChange(direction: 1 | -1): void
  toggleWholeFile(): void
  setUnchangedTextOpacity(unchangedTextOpacity: number): void
}

/**
 * Connects the controls in the header of a diff to the diff, which are drawn
 * apart from each other. The diff attaches itself and says what it can do,
 * and the controls show that and act on the diff through this.
 */
export class DiffViewController {
  private view: IDiffView | null = null
  private viewState: IDiffViewState | null = null
  private readonly listeners = new Set<() => void>()

  /** What the diff can do, or null when there is no diff to act on */
  public get state(): IDiffViewState | null {
    return this.viewState
  }

  public attach(view: IDiffView, state: IDiffViewState) {
    this.view = view
    this.viewState = null
    this.update(view, state)
  }

  /** Say what the diff can do now. Only the attached diff is listened to. */
  public update(view: IDiffView, state: IDiffViewState) {
    if (view !== this.view || shallowEquals(this.viewState, state)) {
      return
    }

    this.viewState = state
    this.listeners.forEach(listener => listener())
  }

  public detach(view: IDiffView) {
    if (view !== this.view) {
      return
    }

    this.view = null
    this.viewState = null
    this.listeners.forEach(listener => listener())
  }

  /** Listen for changes to the state. Returns a function that stops it. */
  public subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public goToChange(direction: 1 | -1) {
    this.view?.goToChange(direction)
  }

  public toggleWholeFile() {
    this.view?.toggleWholeFile()
  }

  public setUnchangedTextOpacity(unchangedTextOpacity: number) {
    this.view?.setUnchangedTextOpacity(unchangedTextOpacity)
  }
}
