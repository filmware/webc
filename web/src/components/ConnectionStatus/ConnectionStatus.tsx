import { Tooltip } from 'antd';
import { useObservable } from 'micro-observables';
import { useMemo } from 'react';

import { PlugBlink, PlugFemale, PlugMale } from '@/assets';
import streamStore from '@/stores/stream';

import css from './ConnectionStatus.module.scss';

function ConnectionStatus() {
  const status = useObservable(streamStore.status);
  const isAuthenticated = useObservable(streamStore.authenticated);

  const className = useMemo(() => {
    const classes = [css.base];
    if (isAuthenticated) classes.push(css.onDark);
    if (status.connected) classes.push(css.connected);
    return classes.join(' ');
  }, [isAuthenticated, status.connected]);

  return (
    <Tooltip placement="right" title={status.connected ? 'Online' : 'Offline'}>
      <div className={className}>
        <div className={css.plugFemale}>
          <PlugFemale />
        </div>
        <div className={css.plugMale}>
          <PlugMale />
        </div>
        <div className={css.plugBlink}>
          <PlugBlink />
        </div>
        <div>{status.connected}</div>
      </div>
    </Tooltip>
  );
}

export default ConnectionStatus;
