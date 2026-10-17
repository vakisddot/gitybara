import * as React from 'react'

interface IUnchangedTextOpacityProps {
  /** How visible the text of unchanged lines is, as a percentage */
  readonly value: number
  readonly onChange: (value: number) => void
}

/**
 * The slider for how visible the text of unchanged lines is, in the header of
 * the diffs and the IDE view.
 */
export class UnchangedTextOpacity extends React.Component<IUnchangedTextOpacityProps> {
  private onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.props.onChange(event.currentTarget.valueAsNumber)
  }

  public render() {
    const { value } = this.props

    return (
      <label className="ide-file-viewer-opacity">
        <span>Unchanged</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={this.onChange}
          aria-label="Unchanged text opacity"
          aria-valuetext={`${value}% visible`}
        />
        <span className="ide-file-viewer-opacity-value">{value}%</span>
      </label>
    )
  }
}
