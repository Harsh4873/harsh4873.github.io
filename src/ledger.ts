export interface LedgerUIHandlers {
  refreshAutoGrades: unknown;
  switchTab: unknown;
  toggleShowSettled: unknown;
  setHomeResultMode: unknown;
  toggleHomeDatePicker: unknown;
  toggleMoreFilters: unknown;
  renderSearch: unknown;
  setActiveFilterFromEl: unknown;
  setHomeSelectedDateFromEl: unknown;
  setHomeSelectedDateFromKey: unknown;
  shiftHomeCalendarMonth: unknown;
  setPulseLogSport: unknown;
  setResult: unknown;
  getIplWinnerActionState: unknown;
  getIplFantasyActionState: unknown;
  addIplWinnerPick: unknown;
  addIplFantasyPick: unknown;
}

export function initLedgerUI(handlers: LedgerUIHandlers): void {
  Object.assign(window, handlers);
}
