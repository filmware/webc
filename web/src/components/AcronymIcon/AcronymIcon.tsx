import { useObservable } from 'micro-observables';
import { CSSProperties, useMemo } from 'react';

import themeStore from '@/stores/theme';
import Color, { stringToColor } from '@/utils/color';

import css from './AcronymIcon.module.scss';

type Size = 'small' | 'medium' | 'large';

export type Props = {
  round?: boolean;
  size?: Size;
  value: string;
};

function AcronymIcon({ round, size = 'medium', value }: Props) {
  const isDarkMode = useObservable(themeStore.isDarkMode);

  const className = useMemo(() => {
    const classes = [css.base, css[size]];
    if (round) classes.push(css.round);
    return classes.join(' ');
  }, [round, size]);

  const style: CSSProperties = useMemo(() => {
    const hsl = stringToColor(value).hsl;
    hsl.l = isDarkMode ? Math.max(0.6, hsl.l) : Math.min(0.4, hsl.l);
    hsl.s = Math.min(0.8, hsl.s);
    return { backgroundColor: new Color(hsl).hex };
  }, [isDarkMode, value]);

  const acronym = useMemo(() => {
    return value
      .split(/\s+/)
      .map((word: string) => word.substring(0, 1).toLocaleUpperCase())
      .slice(0, 2)
      .join('');
  }, [value]);

  return (
    <div className={className} style={style}>
      {acronym}
    </div>
  );
}

export default AcronymIcon;
