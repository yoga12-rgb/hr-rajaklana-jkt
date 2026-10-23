export function isCurrentOutletLocationRequest(input: {
  requestGeneration: number;
  currentGeneration: number;
  requestOutletId?: string;
  currentOutletId?: string;
  editing: boolean;
  activeTab: string;
}): boolean {
  return input.requestGeneration === input.currentGeneration && input.editing
    && input.activeTab === 'outlets' && input.requestOutletId === input.currentOutletId;
}
