/** Custom request sent by the client to force a package index rebuild. */
export const RefreshIndexRequest = 'texlance/refreshIndex';

/** Custom notification sent by the server to update the client's status bar. */
export const StatusNotification = 'texlance/status';

export interface RefreshedIndex {
  packages: number;
  classes: number;
}

export type IndexState = 'indexing' | 'ready' | 'error';

export interface StatusParams {
  state: IndexState;
  packages: number;
  classes: number;
  kpsewhich: string | null;
  message?: string;
}
