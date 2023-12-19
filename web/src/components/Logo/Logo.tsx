import { Logo as LogoSVG } from '@/assets';

import css from './Logo.module.scss';

function Logo() {
  return (
    <div className={css.base}>
      <LogoSVG />
    </div>
  );
}

export default Logo;
