import { PropsWithChildren, useMemo } from 'react';

import css from './Root.module.scss';

type Layout = 'default' | 'center';

export type Props = {
  layout?: Layout;
};

function Root({ children, layout = 'default' }: PropsWithChildren<Props>) {
  const className = useMemo(() => {
    const classes = [css.base, css[layout]];
    return classes.join(' ');
  }, [layout]);

  return <div className={className}>{children}</div>;
}

export default Root;
