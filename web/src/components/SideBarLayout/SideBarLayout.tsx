import { Typography } from 'antd';
import { useObservable } from 'micro-observables';
import { PropsWithChildren, ReactNode, useMemo } from 'react';

import SideBarMenu, { Menu } from '@/components/SideBarMenu';
import themeStore from '@/stores/theme';
import { isString } from '@/utils/data';

import css from './SideBarLayout.module.scss';

export type Props = {
  onClick?: (key: string) => void;
  sidebar: Menu | ReactNode;
  title?: ReactNode | string;
};

function SideBarLayout({ children, onClick, sidebar, title }: PropsWithChildren<Props>) {
  const isDarkMode = useObservable(themeStore.isDarkMode);

  const className = useMemo(() => {
    const classes = [css.base];
    if (isDarkMode) classes.push(css.dark);
    return classes.join(' ');
  }, [isDarkMode]);

  return (
    <div className={className}>
      <aside>
        {title && (
          <div className={css.header}>
            {isString(title) ? <Typography.Title level={2}>{title}</Typography.Title> : title}
          </div>
        )}
        {Array.isArray(sidebar) ? <SideBarMenu menu={sidebar} onClick={onClick} /> : sidebar}
      </aside>
      <main>{children}</main>
    </div>
  );
}

export default SideBarLayout;
