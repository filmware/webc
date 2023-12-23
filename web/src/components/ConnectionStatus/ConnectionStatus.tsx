import { Tooltip } from 'antd';
import { useObservable } from 'micro-observables';
import { useMemo } from 'react';

import Logo from '@/components/Logo';
import streamStore from '@/stores/stream';

import css from './ConnectionStatus.module.scss';

function ConnectionStatus() {
  const status = useObservable(streamStore.status);
  const isAuthenticated = useObservable(streamStore.authenticated);

  const className = useMemo(() => {
    const classes = [css.base];
    if (isAuthenticated) classes.push(css.onDark);
    classes.push(status.connected ? css.connected : css.disconnected);
    return classes.join(' ');
  }, [isAuthenticated, status.connected]);

  return (
    <Tooltip placement="right" title={status.connected ? 'Online' : 'Offline'}>
      <div className={className}>
        <div className={css.blast} />
        <div className={css.logo}>
          <Logo />
        </div>
        <div className={css.dot} />
      </div>
    </Tooltip>
  );
}

export default ConnectionStatus;
