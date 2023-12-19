import { PropsWithChildren, ReactNode, useCallback, useMemo, useState } from 'react';

import css from './Page.module.scss';

export type Props = {
  sidebar?: ReactNode;
  title: string;
};

function Page({ children, sidebar, title }: PropsWithChildren<Props>) {
  const [isTop, setIsTop] = useState(true);

  const className = useMemo(() => {
    const classes = [css.base];
    if (!isTop) classes.push(css.scrolled);
    return classes.join(' ');
  }, [isTop]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    setIsTop(e.currentTarget.scrollTop === 0);
  }, []);

  return (
    <div className={className}>
      {sidebar && <aside>{sidebar}</aside>}
      <main>
        <div className={css.header}>
          <h1>{title}</h1>
        </div>
        <div className={css.body} onScroll={handleScroll}>
          {children}
        </div>
      </main>
    </div>
  );
}

export default Page;
