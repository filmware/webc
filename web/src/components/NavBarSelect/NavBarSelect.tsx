import { Dropdown } from 'antd';
import { PropsWithChildren, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { randomUUID } from '@/utils/string';

import css from './NavBarSelect.module.scss';

type MenuItem = {
  key: string;
  label: ReactNode;
}

export type Props = {
  menu: MenuItem[];
  onSelect?: (key: string) => void;
  placement?: 'bottom' | 'top';
}

function NavBarSelect({ children, menu, onSelect, placement = 'bottom' }: PropsWithChildren<Props>) {
  const uuid = useRef(randomUUID());
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  const className = useMemo(() => {
    const classes = [css.base];
    if (placement === 'top') classes.push(css.top);
    return classes.join(' ');
  }, [placement]);

  const getPopupContainer = useCallback((trigger: HTMLElement) => {
    return document.getElementById(uuid.current) ?? trigger;
  }, []);

  const handleDropdownClick = useCallback(({ key }: { key: string }) => onSelect?.(key), [onSelect]);

  useEffect(() => {
    function handleOutsideClick(e: Event) {
      if (e.target) {
        const dropdown = document.getElementById(uuid.current);
        const target = e.target as HTMLElement;
        if (!triggerRef.current?.contains(target) && !dropdown?.contains(target)) setIsOpen(false);
      }
    }

    document.body.addEventListener('click', handleOutsideClick);

    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  return (
    <div className={className} ref={triggerRef} onClick={() => setIsOpen((prev) => !prev)}>
      {children}
      <Dropdown
        getPopupContainer={getPopupContainer}
        menu={{ items: menu, onClick: handleDropdownClick }}
        open={isOpen}
        overlayClassName={css.dropdown}>
        <div className={css.dropdownPlacement} id={uuid.current} ref={dropdownRef} />
      </Dropdown>
    </div>
  );
}

export default NavBarSelect;
