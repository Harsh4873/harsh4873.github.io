export interface HistoryUIHandlers {
  toggleTrendGameFromEl: unknown;
  toggleTrendPropsFromEl: unknown;
  toggleSourceCardFromEl: unknown;
  _dailyJumpToSourceFromEl: unknown;
}

export function initHistoryUI(handlers: HistoryUIHandlers): void {
  Object.assign(window, handlers);
}
