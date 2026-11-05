// Listens for the menu/shortcut events that the preload script relays from the main process.
import { MENU_ACTIONS, MENU_EVENT_PREFIX, type MenuAction } from "../shared/types";

/** Registers one handler per menu action; actions without a handler are simply ignored for now. */
export function listenToMenu(handlers: Partial<Record<MenuAction, () => void>>): void {
  for (const action of MENU_ACTIONS) {
    const handler = handlers[action];
    if (handler) document.addEventListener(`${MENU_EVENT_PREFIX}${action}`, handler);
  }
}
