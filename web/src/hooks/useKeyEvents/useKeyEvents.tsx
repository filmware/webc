import { useCallback, useEffect } from 'react';

import { keyEmitter, KeyEventType } from './useKeyEvents.utils';

let isListenerSet = false;

function useKeyEvents() {
  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    keyEmitter.emit(KeyEventType.KeyUp, e);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    keyEmitter.emit(KeyEventType.KeyDown, e);
  }, []);

  useEffect(() => {
    if (isListenerSet) return;

    isListenerSet = true;
    document.body.addEventListener('keyup', handleKeyUp);
    document.body.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.removeEventListener('keyup', handleKeyUp);
      document.body.removeEventListener('keydown', handleKeyDown);
      isListenerSet = false;
    };
  }, [handleKeyUp, handleKeyDown]);
}

export default useKeyEvents;
