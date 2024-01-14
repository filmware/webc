import { ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import Icon from '@/components/Icon';
import { isString } from '@/utils/data';

import css from './SideBarMenu.module.scss';

export type MenuItem = {
  icon?: ReactNode | string;
  key: string;
  label: string;
  path?: string;
};

export type Menu = MenuItem[];

export type Props = {
  menu: Menu;
  onClick?: (key: string) => void;
};

function SideBarMenu({ menu, onClick }: Props) {
  const navigate = useNavigate();

  const handleClick = useCallback(
    (key: string, path?: string) => {
      if (path) navigate(path);
      onClick?.(key);
    },
    [navigate, onClick],
  );

  return (
    <ul className={css.base}>
      {menu.map((item) => (
        <li key={item.key} onClick={() => handleClick(item.key, item.path)}>
          {item.icon && (isString(item.icon) ? <Icon name={item.icon} /> : item.icon)}
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export default SideBarMenu;
