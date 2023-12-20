import { LoadingOutlined } from '@ant-design/icons';
import { Spin as AntdSpin, SpinProps } from 'antd';
import { PropsWithChildren, useMemo } from 'react';

import css from './Spin.module.scss';

AntdSpin.setDefaultIndicator(<LoadingOutlined />);

export type Props = {
  block?: boolean;
} & SpinProps;

function Spin({ block, className, spinning = true, ...props }: PropsWithChildren<Props>) {
  const wrapperClassName = useMemo(() => {
    const classes = [css.base, className];
    if (block) classes.push(css.block);
    return classes.length !== 0 ? classes.join(' ') : undefined;
  }, [block, className]);

  const children = useMemo(() => {
    return block ? <div>{props.children}</div> : props.children;
  }, [block, props.children]);

  return (
    <AntdSpin spinning={spinning} wrapperClassName={wrapperClassName} {...props}>
      {children}
    </AntdSpin>
  );
}

export default Spin;
