import { useMemo } from 'react';

import { LogoFull, Logo as LogoSVG } from '@/assets';

import css from './Logo.module.scss';

export type Props = {
  full?: boolean;
  text?: boolean;
};

function Logo({ full, text }: Props) {
  const className = useMemo(() => {
    const classes = [css.base];
    if (full) classes.push(css.full);
    if (text) classes.push(css.text);
    return classes.join(' ');
  }, [full, text]);

  return <div className={className}>{text ? 'cilo' : full ? <LogoFull /> : <LogoSVG />}</div>;
}

export default Logo;
