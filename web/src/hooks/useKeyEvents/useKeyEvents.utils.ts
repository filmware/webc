import { EventEmitter } from 'events';

export const enum KeyEventType {
  KeyUp = 'KeyUp',
  KeyDown = 'KeyDown',
}

export const keyEmitter = new EventEmitter();
