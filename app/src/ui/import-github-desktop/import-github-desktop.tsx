import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { readGitHubDesktopRepositories } from '../main-process-proxy'
import { pathExists } from '../../lib/path-exists'
import { planImport } from '../../lib/github-desktop-import'
import { matchExistingRepository } from '../../lib/repository-matching'

interface IImportFromGitHubDesktopProps {
  readonly dispatcher: Dispatcher

  /** The repositories already in the app. */
  readonly repositories: ReadonlyArray<Repository>

  readonly onDismissed: () => void
}

interface IImportResult {
  readonly added: number
  readonly alreadyAdded: number
  readonly notFound: number
  readonly couldNotAdd: number
  readonly aliases: number
}

type ImportState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'importing' }
  | { readonly kind: 'done'; readonly result: IImportResult }
  | { readonly kind: 'error'; readonly message: string }

interface IImportFromGitHubDesktopState {
  readonly state: ImportState
}

const repositories = (count: number) =>
  `${count} ${count === 1 ? 'repository' : 'repositories'}`

/** Errors from the main process arrive wrapped in IPC boilerplate. */
const errorMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e))
    .replace(/^Error invoking remote method '[^']*': /, '')
    .replace(/^Error: /, '')

/** Copies the repository list from GitHub Desktop into the app. */
export class ImportFromGitHubDesktop extends React.Component<
  IImportFromGitHubDesktopProps,
  IImportFromGitHubDesktopState
> {
  public constructor(props: IImportFromGitHubDesktopProps) {
    super(props)
    this.state = { state: { kind: 'ready' } }
  }

  public render() {
    const { kind } = this.state.state
    const importing = kind === 'importing'

    return (
      <Dialog
        id="import-github-desktop"
        title="Import from GitHub Desktop"
        loading={importing}
        dismissDisabled={importing}
        onSubmit={kind === 'ready' ? this.onImport : this.props.onDismissed}
        onDismissed={this.props.onDismissed}
      >
        <DialogContent>{this.renderContent()}</DialogContent>
        <DialogFooter>{this.renderButtons()}</DialogFooter>
      </Dialog>
    )
  }

  private renderContent() {
    const { state } = this.state

    switch (state.kind) {
      case 'ready':
        return (
          <p>
            This adds the repositories from GitHub Desktop that aren't in{' '}
            {__APP_NAME__} yet, with the names you gave them there. Repositories
            you already have are left as they are. GitHub Desktop isn't changed.
            If it is open, close it first for the most reliable result.
          </p>
        )
      case 'importing':
        return <p>Importing repositories…</p>
      case 'error':
        return <p>{state.message}</p>
      case 'done':
        return this.renderResult(state.result)
    }
  }

  private renderResult(result: IImportResult) {
    const { added, alreadyAdded, notFound, couldNotAdd, aliases } = result

    return (
      <>
        <p>Added {repositories(added)}.</p>
        <ul>
          {alreadyAdded > 0 && (
            <li>{repositories(alreadyAdded)} already here.</li>
          )}
          {aliases > 0 && (
            <li>
              Copied {aliases} {aliases === 1 ? 'name' : 'names'} from GitHub
              Desktop.
            </li>
          )}
          {notFound > 0 && (
            <li>{repositories(notFound)} no longer on disk, so skipped.</li>
          )}
          {couldNotAdd > 0 && (
            <li>
              {repositories(couldNotAdd)} could not be added. See the error
              message.
            </li>
          )}
        </ul>
      </>
    )
  }

  private renderButtons() {
    const { kind } = this.state.state

    if (kind === 'ready') {
      return (
        <OkCancelButtonGroup
          okButtonText="Import"
          onCancelButtonClick={this.props.onDismissed}
        />
      )
    }

    return (
      <OkCancelButtonGroup
        okButtonText="Close"
        okButtonDisabled={kind === 'importing'}
        cancelButtonVisible={false}
      />
    )
  }

  private onImport = async () => {
    this.setState({ state: { kind: 'importing' } })

    try {
      const result = await this.import()
      this.setState({ state: { kind: 'done', result } })
    } catch (e) {
      log.error('Could not import repositories from GitHub Desktop', e)
      this.setState({ state: { kind: 'error', message: errorMessage(e) } })
    }
  }

  private async import(): Promise<IImportResult> {
    const { dispatcher, repositories } = this.props

    const found = await readGitHubDesktopRepositories()
    const onDisk = new Array<typeof found[number]>()
    for (const repository of found) {
      if (await pathExists(repository.path)) {
        onDisk.push(repository)
      }
    }

    const plan = planImport(repositories, onDisk)
    const added = await dispatcher.addRepositories(plan.toAdd.map(r => r.path))

    let aliases = 0
    for (const repository of added) {
      const incoming = matchExistingRepository(plan.toAdd, repository.path)
      if (incoming?.alias != null && repository.alias === null) {
        await dispatcher.changeRepositoryAlias(repository, incoming.alias)
        aliases++
      }
    }

    for (const { repository, alias } of plan.aliasUpdates) {
      await dispatcher.changeRepositoryAlias(repository, alias)
      aliases++
    }

    return {
      added: added.length,
      alreadyAdded: plan.alreadyAdded,
      notFound: found.length - onDisk.length,
      couldNotAdd: plan.toAdd.length - added.length,
      aliases,
    }
  }
}
