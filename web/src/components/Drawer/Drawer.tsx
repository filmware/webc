import { Drawer as AntdDrawer } from 'antd';
import { DrawerProps } from 'antd/es/drawer';
import { PropsWithChildren, ReactNode, useCallback, useMemo, useState } from 'react';

import css from './Drawer.module.scss';

export type Props = DrawerProps & {
  icon?: ReactNode;
  onClose?: () => void;
  title?: ReactNode;
};

function Drawer({ className, children, icon, onClose, title, ...props }: PropsWithChildren<Props>) {
  const [isTop, setIsTop] = useState(true);

  const wrapperClassName = useMemo(() => {
    const classes = [css.base];
    if (className) classes.push(className);
    if (!isTop) classes.push(css.scrolled);
    return classes.join(' ');
  }, [className, isTop]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    setIsTop(e.currentTarget.scrollTop === 0);
  }, []);

  return (
    <AntdDrawer
      className={wrapperClassName}
      title={
        title && (
          <div className={css.title}>
            {icon}
            <span>{title}</span>
          </div>
        )
      }
      onClose={onClose}
      {...props}>
      <div className={css.body} onScroll={handleScroll}>
        {children}
      </div>
    </AntdDrawer>
  );
}

export default Drawer;
