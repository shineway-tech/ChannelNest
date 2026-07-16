import type { UserMessage } from "../../domain/types";

export class MessagesState {
  items: UserMessage[] = [];
  unreadCount = 0;

  reset() {
    this.items = [];
    this.unreadCount = 0;
  }
}
