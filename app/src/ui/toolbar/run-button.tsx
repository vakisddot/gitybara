import * as React from 'react'
import {
  IAppRunnerStatus,
  IRunProfile,
  RunConfigResult,
  idleStatus,
  runConfigPath,
} from '../../lib/app-runner'
import * as ipcRenderer from '../../lib/ipc-renderer'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { ToolbarButton, ToolbarButtonStyle } from './button'
import {
  DropdownState,
  ToolbarDropdown,
  ToolbarDropdownStyle,
} from './dropdown'

interface IRunButtonProps {
  /** The absolute path of the current repository. */
  readonly repositoryPath: string

  /** Whether the profile dropdown traps focus. Off while a dialog is open. */
  readonly enableFocusTrap: boolean
}

interface IRunButtonState {
  readonly config: RunConfigResult
  readonly status: IAppRunnerStatus

  /** The name of the profile the button starts. Defaults to the first one. */
  readonly selectedProfile: string | null
  readonly isDropdownOpen: boolean
}

/** What a profile will run, for people to check before they start it. */
function describeCommands(profile: IRunProfile) {
  const commands = [profile.build, profile.run].filter(
    (command): command is ReadonlyArray<string> => command !== undefined
  )
  return commands.map(command => command.join(' ')).join(' → ')
}

interface IRunProfileItemProps {
  readonly profile: IRunProfile
  readonly isSelected: boolean
  readonly onSelected: (profile: IRunProfile) => void
}

/** One profile in the list to pick from. */
class RunProfileItem extends React.Component<IRunProfileItemProps> {
  private onClick = () => this.props.onSelected(this.props.profile)

  public render() {
    const { profile, isSelected } = this.props

    return (
      <Button className="push-pull-dropdown-item" onClick={this.onClick}>
        <Octicon symbol={isSelected ? octicons.check : octicons.play} />
        <div className="text-container">
          <div className="title">{profile.name}</div>
          <div className="detail">{describeCommands(profile)}</div>
        </div>
      </Button>
    )
  }
}

/**
 * A toolbar button that builds and runs the app in the current repository,
 * as described by the repository's run config.
 *
 * It renders nothing for a repository without a config.
 */
export class RunButton extends React.Component<
  IRunButtonProps,
  IRunButtonState
> {
  private isUnmounted = false

  public constructor(props: IRunButtonProps) {
    super(props)
    this.state = {
      config: { kind: 'missing' },
      status: idleStatus,
      selectedProfile: null,
      isDropdownOpen: false,
    }
  }

  public componentDidMount() {
    ipcRenderer.on('app-runner-status', this.onStatusChanged)
    // The config is edited outside the app, so look again on coming back to it.
    window.addEventListener('focus', this.loadConfig)

    this.loadConfig()
    ipcRenderer
      .invoke('app-runner-get-status', this.props.repositoryPath)
      .then(status => this.setStatus(status))
  }

  public componentWillUnmount() {
    this.isUnmounted = true
    ipcRenderer.removeListener('app-runner-status', this.onStatusChanged)
    window.removeEventListener('focus', this.loadConfig)
  }

  private setStatus(status: IAppRunnerStatus) {
    if (!this.isUnmounted) {
      this.setState({ status })
    }
  }

  private onStatusChanged = (
    _: unknown,
    repositoryPath: string,
    status: IAppRunnerStatus
  ) => {
    if (repositoryPath === this.props.repositoryPath) {
      this.setStatus(status)
    }
  }

  private loadConfig = async () => {
    const config = await ipcRenderer.invoke(
      'app-runner-get-config',
      this.props.repositoryPath
    )
    if (!this.isUnmounted) {
      this.setState({ config })
    }
  }

  private getSelectedProfile(profiles: ReadonlyArray<IRunProfile>) {
    return (
      profiles.find(p => p.name === this.state.selectedProfile) ?? profiles[0]
    )
  }

  private onStartClick = () => {
    const { config } = this.state
    if (config.kind === 'ok') {
      ipcRenderer.invoke(
        'app-runner-start',
        this.props.repositoryPath,
        this.getSelectedProfile(config.profiles).name
      )
    }
  }

  private stop = () => {
    ipcRenderer.invoke('app-runner-stop', this.props.repositoryPath)
  }

  private onDropdownStateChanged = (state: DropdownState) => {
    this.setState({ isDropdownOpen: state === 'open' })
  }

  private onProfileSelected = (profile: IRunProfile) => {
    this.setState({ selectedProfile: profile.name, isDropdownOpen: false })
  }

  private renderProfiles = () => {
    const { config } = this.state
    if (config.kind !== 'ok') {
      return null
    }

    const selected = this.getSelectedProfile(config.profiles)

    // This borrows the push and pull dropdown's list of buttons.
    return (
      <div className="push-pull-dropdown">
        {config.profiles.map(profile => (
          <RunProfileItem
            key={profile.name}
            profile={profile}
            isSelected={profile === selected}
            onSelected={this.onProfileSelected}
          />
        ))}
      </div>
    )
  }

  private renderRunning(status: IAppRunnerStatus) {
    const isBuilding = status.phase === 'building'

    return (
      <ToolbarButton
        className="run-button"
        style={ToolbarButtonStyle.Subtitle}
        icon={octicons.stop}
        title={isBuilding ? 'Building…' : 'Stop'}
        description={status.profile ?? undefined}
        tooltip={isBuilding ? 'Cancel the build' : `Stop ${status.profile}`}
        onClick={this.stop}
      />
    )
  }

  private renderStart(profiles: ReadonlyArray<IRunProfile>) {
    const { status, isDropdownOpen } = this.state
    const profile = this.getSelectedProfile(profiles)

    return (
      <ToolbarDropdown
        buttonClassName="run-button"
        style={ToolbarButtonStyle.Subtitle}
        dropdownStyle={ToolbarDropdownStyle.MultiOption}
        icon={octicons.play}
        title="Run"
        description={status.error ? `${profile.name} failed` : profile.name}
        tooltip={status.error ?? describeCommands(profile)}
        onClick={this.onStartClick}
        ariaLabel="Run profiles"
        showDisclosureArrow={profiles.length > 1}
        dropdownState={isDropdownOpen ? 'open' : 'closed'}
        onDropdownStateChanged={this.onDropdownStateChanged}
        dropdownContentRenderer={this.renderProfiles}
        enableFocusTrap={this.props.enableFocusTrap}
      />
    )
  }

  private renderBody() {
    const { config, status } = this.state

    switch (config.kind) {
      case 'missing':
        return null
      case 'invalid':
        return (
          <ToolbarButton
            className="run-button"
            style={ToolbarButtonStyle.Subtitle}
            icon={octicons.alert}
            title="Run"
            description={`Fix ${runConfigPath}`}
            tooltip={config.message}
          />
        )
      case 'ok':
        return status.phase === 'idle'
          ? this.renderStart(config.profiles)
          : this.renderRunning(status)
    }
  }

  public render() {
    const body = this.renderBody()
    return body === null ? null : (
      <div className="run-button-container">{body}</div>
    )
  }
}
