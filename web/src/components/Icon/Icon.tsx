import { useMemo } from 'react';

import { ICON_NAME_MAP } from './Icon.utils';

export type Size = 'small' | 'medium' | 'large';

export type Props = {
  inline?: boolean;
  name: string;
  size?: Size;
};

const ICON_SIZE_MAP: Record<Size, number> = {
  large: 24,
  medium: 20,
  small: 16,
};

function Icon({ inline, name, size = 'medium' }: Props) {
  const SVG = useMemo(() => {
    let ICON_SVG = ICON_NAME_MAP[name];
    if (!ICON_SVG) ICON_SVG = ICON_NAME_MAP['bell'];
    return ICON_SVG;
  }, [name]);

  /**
   * The span.anticon wrapper centers the icon for inline use in buttons, inputs, etc.
   * It also doesn't impact placements outside of antd use so wrapping everything.
   */
  return inline ? (
    <span className="anticon" role="img">
      <SVG style={{ height: ICON_SIZE_MAP[size], width: ICON_SIZE_MAP[size] }} />
    </span>
  ) : (
    <SVG style={{ height: ICON_SIZE_MAP[size], width: ICON_SIZE_MAP[size] }} />
  );
}

export default Icon;
