import { Logo as LogoSVG } from '@/assets';

import css from './Logo.module.scss';

export type Props = {
  showLabel?: boolean;
};

function Logo({ showLabel }: Props) {
  return (
    <div className={css.base}>
      <LogoSVG />
      {showLabel && <span>PostChain</span>}
    </div>
  );
}

export default Logo;
