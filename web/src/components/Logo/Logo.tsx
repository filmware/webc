import { useMemo } from 'react';

import { LogoFull, Logo as LogoSVG } from '@/assets';

import css from './Logo.module.scss';

export type Props = {
  full?: boolean;
};

function Logo({ full }: Props) {
  const className = useMemo(() => {
    const classes = [css.base];
    if (full) classes.push(css.full);
    return classes.join(' ');
  }, [full]);

  return <div className={className}>{full ? <LogoFull /> : <LogoSVG />}</div>;
}

export default Logo;
