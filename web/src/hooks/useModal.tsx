import React, { useCallback, useState } from 'react';

import { ModalContext } from '@/components/Modal';

function useModal<ModalProps extends object>(ModalComponent: React.FC<ModalProps>) {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);

  const Component = useCallback(
    (props: ModalProps) => {
      return (
        <ModalContext.Provider value={{ isOpen, setIsOpen }}>
          <ModalComponent {...props} />
        </ModalContext.Provider>
      );
    },
    [isOpen, ModalComponent],
  );

  return { Component, open: handleOpen };
}

export default useModal;
