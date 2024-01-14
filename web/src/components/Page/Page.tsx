import { Typography } from 'antd';
import { PropsWithChildren, ReactNode, useCallback, useMemo, useState } from 'react';

import css from './Page.module.scss';

export type Props = {
  noBodyPadding?: boolean;
  options?: ReactNode;
  title: string;
};

function Page({ children, noBodyPadding, options, title }: PropsWithChildren<Props>) {
  const [isTop, setIsTop] = useState(true);

  const className = useMemo(() => {
    const classes = [css.base];
    if (noBodyPadding) classes.push(css.noBodyPadding);
    if (!isTop) classes.push(css.scrolled);
    return classes.join(' ');
  }, [isTop, noBodyPadding]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    setIsTop(e.currentTarget.scrollTop === 0);
  }, []);

  return (
    <div className={className}>
      <div className={css.header}>
        <Typography.Title level={2}>{title}</Typography.Title>
        {options}
      </div>
      <div className={css.body} onScroll={handleScroll}>
        {children}
      </div>
    </div>
  );
}

export default Page;
