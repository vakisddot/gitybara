import * as React from 'react'
import * as Path from 'path'
import memoize from 'memoize-one'

import { assertNever } from '../../lib/fatal-error'
import { encodePathAsUrl } from '../../lib/path'

import { Repository } from '../../models/repository'
import {
  CommittedFileChange,
  WorkingDirectoryFileChange,
  AppFileStatusKind,
  isManualConflict,
  isConflictedFileStatus,
} from '../../models/status'
import {
  DiffSelection,
  DiffType,
  IDiff,
  IImageDiff,
  ITextDiff,
  ILargeTextDiff,
  Image,
  ImageDiffType,
  ISubmoduleDiff,
} from '../../models/diff'
import { Button } from '../lib/button'
import { TabBar, TabBarType } from '../tab-bar'
import {
  NewImageDiff,
  ModifiedImageDiff,
  DeletedImageDiff,
} from './image-diffs'
import { BinaryFile } from './binary-file'
import { SideBySideDiff } from './side-by-side-diff'
import { IFileContents } from './syntax-highlighting'
import { SubmoduleDiff } from './submodule-diff'
import { DiffViewController } from './diff-view-controller'
import { Octicon } from '../octicons'
import * as OcticonSymbol from '../octicons/octicons.generated'

// image used when no diff is displayed
const NoDiffImage = encodePathAsUrl(__dirname, 'static/ufo-alert.svg')

type ChangedFile = WorkingDirectoryFileChange | CommittedFileChange

/** Whether an SVG is shown as its code or as the image it draws. */
enum SvgDiffMode {
  Code,
  Preview,
}

/**
 * Turn the lines of one version of an SVG into an image, or undefined when
 * there is no such version (the file was added or deleted).
 */
function getSvgImage(lines: ReadonlyArray<string>): Image | undefined {
  if (lines.length === 0) {
    return undefined
  }

  const contents = Buffer.from(lines.join('\n'), 'utf8')
  return new Image(
    contents.buffer,
    contents.toString('base64'),
    'image/svg+xml',
    contents.length
  )
}

/** The props for the Diff component. */
interface IDiffProps {
  readonly repository: Repository

  /**
   * Whether the diff is readonly, e.g., displaying a historical diff, or the
   * diff's lines can be selected, e.g., displaying a change in the working
   * directory.
   */
  readonly readOnly: boolean

  /** The file whose diff should be displayed. */
  readonly file: ChangedFile

  /** Called when the includedness of lines or a range of lines has changed. */
  readonly onIncludeChanged?: (diffSelection: DiffSelection) => void

  /** The diff that should be rendered */
  readonly diff: IDiff

  /**
   * Contents of the old and new files related to the current text diff.
   */
  readonly fileContents: IFileContents | null

  /** The type of image diff to display. */
  readonly imageDiffType: ImageDiffType

  /** Hiding whitespace in diff. */
  readonly hideWhitespaceInDiff: boolean

  /** Whether we should display side by side diffs. */
  readonly showSideBySideDiff: boolean

  /** Whether we should show a confirmation dialog when the user discards changes */
  readonly askForConfirmationOnDiscardChanges?: boolean

  /** Whether or not to show the diff check marks indicating inclusion in a commit */
  readonly showDiffCheckMarks: boolean

  /**
   * Called when the user requests to open a binary file in an the
   * system-assigned application for said file type.
   */
  readonly onOpenBinaryFile: (fullPath: string) => void

  /** Called when the user requests to open a submodule. */
  readonly onOpenSubmodule?: (fullPath: string) => void

  /**
   * Called when the user is viewing an image diff and requests
   * to change the diff presentation mode.
   */
  readonly onChangeImageDiffType: (type: ImageDiffType) => void

  /*
   * Called when the user wants to discard a selection of the diff.
   * Only applicable when readOnly is false.
   */
  readonly onDiscardChanges?: (
    diff: ITextDiff,
    diffSelection: DiffSelection
  ) => void

  /** Called when the user changes the hide whitespace in diffs setting. */
  readonly onHideWhitespaceInDiffChanged: (checked: boolean) => void

  /** Connects the controls in the header of the diff to it, if there are any */
  readonly viewController?: DiffViewController
}

interface IDiffState {
  readonly forceShowLargeDiff: boolean
  readonly svgDiffMode: SvgDiffMode
}

/** A component which renders a diff for a file. */
export class Diff extends React.Component<IDiffProps, IDiffState> {
  /**
   * The SVG preview, built from the contents already loaded for syntax
   * highlighting. Memoized so the images aren't decoded again on every render.
   */
  private getSvgImageDiff = memoize(
    (fileContents: IFileContents): IImageDiff => ({
      kind: DiffType.Image,
      previous: getSvgImage(fileContents.oldContents),
      current: getSvgImage(fileContents.newContents),
    })
  )

  public constructor(props: IDiffProps) {
    super(props)

    this.state = {
      forceShowLargeDiff: false,
      svgDiffMode: SvgDiffMode.Code,
    }
  }

  public render() {
    const { diff, file } = this.props
    const isSvgText =
      Path.extname(file.path).toLowerCase() === '.svg' &&
      (diff.kind === DiffType.Text || diff.kind === DiffType.LargeText)

    if (!isSvgText) {
      return this.renderDiff()
    }

    return (
      <div className="svg-diff">
        <TabBar
          selectedIndex={this.state.svgDiffMode}
          onTabClicked={this.onSvgDiffModeChanged}
          type={TabBarType.Switch}
        >
          <span>Code</span>
          <span>Preview</span>
        </TabBar>
        {this.state.svgDiffMode === SvgDiffMode.Preview
          ? this.renderSvgPreview()
          : this.renderDiff()}
      </div>
    )
  }

  private renderSvgPreview() {
    const { fileContents } = this.props

    // The contents of a newly selected file are still loading
    if (fileContents === null) {
      return null
    }

    if (fileContents.isTruncated) {
      return (
        <div className="panel empty">The SVG is too large to be previewed.</div>
      )
    }

    return (
      this.renderImage(this.getSvgImageDiff(fileContents)) ?? (
        <div className="panel empty">The SVG can’t be previewed.</div>
      )
    )
  }

  private onSvgDiffModeChanged = (svgDiffMode: SvgDiffMode) => {
    this.setState({ svgDiffMode })
  }

  private renderDiff() {
    const diff = this.props.diff

    switch (diff.kind) {
      case DiffType.Text:
        return this.renderText(diff)
      case DiffType.Binary:
        return this.renderBinaryFile()
      case DiffType.Submodule:
        return this.renderSubmoduleDiff(diff)
      case DiffType.Image:
        return this.renderImage(diff)
      case DiffType.LargeText: {
        return this.state.forceShowLargeDiff
          ? this.renderLargeText(diff)
          : this.renderLargeTextDiff()
      }
      case DiffType.Unrenderable:
        return this.renderUnrenderableDiff()
      default:
        return assertNever(diff, `Unsupported diff type: ${diff}`)
    }
  }

  private renderImage(imageDiff: IImageDiff) {
    if (imageDiff.current && imageDiff.previous) {
      return (
        <ModifiedImageDiff
          onChangeDiffType={this.props.onChangeImageDiffType}
          diffType={this.props.imageDiffType}
          current={imageDiff.current}
          previous={imageDiff.previous}
        />
      )
    }

    if (
      imageDiff.current &&
      (this.props.file.status.kind === AppFileStatusKind.New ||
        this.props.file.status.kind === AppFileStatusKind.Untracked)
    ) {
      return <NewImageDiff current={imageDiff.current} />
    }

    if (
      imageDiff.previous &&
      this.props.file.status.kind === AppFileStatusKind.Deleted
    ) {
      return <DeletedImageDiff previous={imageDiff.previous} />
    }

    return null
  }

  private renderLargeTextDiff() {
    return (
      <div className="panel empty large-diff">
        <img src={NoDiffImage} className="blankslate-image" alt="" />
        <div className="description">
          <p>The diff is too large to be displayed by default.</p>
          <p>
            You can try to show it anyway, but performance may be negatively
            impacted.
          </p>
        </div>
        <Button onClick={this.showLargeDiff}>
          {__DARWIN__ ? 'Show Diff' : 'Show diff'}
        </Button>
      </div>
    )
  }

  private renderUnrenderableDiff() {
    return (
      <div className="panel empty large-diff">
        <img src={NoDiffImage} alt="" />
        <p>The diff is too large to be displayed.</p>
      </div>
    )
  }

  private renderLargeText(diff: ILargeTextDiff) {
    // guaranteed to be set since this function won't be called if text or hunks are null
    const textDiff: ITextDiff = {
      text: diff.text,
      hunks: diff.hunks,
      kind: DiffType.Text,
      lineEndingsChange: diff.lineEndingsChange,
      maxLineNumber: diff.maxLineNumber,
      hasHiddenBidiChars: diff.hasHiddenBidiChars,
    }

    return this.renderTextDiff(textDiff)
  }

  private renderText(diff: ITextDiff) {
    if (diff.hunks.length === 0) {
      if (
        this.props.file.status.kind === AppFileStatusKind.New ||
        this.props.file.status.kind === AppFileStatusKind.Untracked
      ) {
        return <div className="panel empty">The file is empty</div>
      }

      if (this.props.file.status.kind === AppFileStatusKind.Renamed) {
        // Check if it was changed too
        if (this.props.file.status.renameIncludesModifications) {
          return (
            <div className="panel renamed">
              <Octicon symbol={OcticonSymbol.alert} />
              The file was renamed and includes changes.
            </div>
          )
        }
        return (
          <div className="panel renamed">
            The file was renamed but not changed
          </div>
        )
      }

      if (
        isConflictedFileStatus(this.props.file.status) &&
        isManualConflict(this.props.file.status)
      ) {
        return (
          <div className="panel empty">
            The file is in conflict and must be resolved via the command line.
          </div>
        )
      }

      if (this.props.hideWhitespaceInDiff) {
        return <div className="panel empty">Only whitespace changes found</div>
      }

      return <div className="panel empty">No content changes found</div>
    }

    return this.renderTextDiff(diff)
  }

  private renderSubmoduleDiff(diff: ISubmoduleDiff) {
    return (
      <SubmoduleDiff
        onOpenSubmodule={this.props.onOpenSubmodule}
        diff={diff}
        readOnly={this.props.readOnly}
      />
    )
  }

  private renderBinaryFile() {
    return (
      <BinaryFile
        path={this.props.file.path}
        repository={this.props.repository}
        onOpenBinaryFile={this.props.onOpenBinaryFile}
      />
    )
  }

  private renderTextDiff(diff: ITextDiff) {
    return (
      <SideBySideDiff
        file={this.props.file}
        diff={diff}
        fileContents={this.props.fileContents}
        hideWhitespaceInDiff={this.props.hideWhitespaceInDiff}
        showSideBySideDiff={this.props.showSideBySideDiff}
        onIncludeChanged={this.props.onIncludeChanged}
        onDiscardChanges={this.props.onDiscardChanges}
        askForConfirmationOnDiscardChanges={
          this.props.askForConfirmationOnDiscardChanges
        }
        onHideWhitespaceInDiffChanged={this.props.onHideWhitespaceInDiffChanged}
        showDiffCheckMarks={this.props.showDiffCheckMarks}
        viewController={this.props.viewController}
      />
    )
  }

  private showLargeDiff = () => {
    this.setState({ forceShowLargeDiff: true })
  }
}
