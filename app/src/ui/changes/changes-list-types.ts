import { WorkingDirectoryFileChange } from '../../models/status'
import { IFilterListItem } from '../lib/filter-list'

export interface IChangesListItem extends IFilterListItem {
  readonly id: string
  readonly text: ReadonlyArray<string>
  readonly change: WorkingDirectoryFileChange
}
