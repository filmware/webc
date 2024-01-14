import { useObservable } from 'micro-observables';
import { useEffect, useMemo } from 'react';

import NavBar from '@/components/NavBar';
import DrawerSettings from '@/drawers/DrawerSettings';
import DrawerWelcome from '@/drawers/DrawerWelcome';
import AuthRouter from '@/routes/AuthRouter';
import drawerStore from '@/stores/drawer';
import streamStore from '@/stores/stream';

import css from './Authenticated.module.scss';

function Authenticated() {
  const isWelcomeOpen = useObservable(drawerStore.welcome);
  const isSettingsOpen = useObservable(drawerStore.settings);
  const projectUuid = useObservable(streamStore.projectUuid);

  const className = useMemo(() => {
    const classes = [css.base];
    return classes.join(' ');
  }, []);

  useEffect(() => {
    if (!projectUuid) drawerStore.setWelcome(true);
  }, [projectUuid]);

  return (
    <>
      <div className={className}>
        <NavBar />
        <div className={css.main}>
          <AuthRouter />
        </div>
      </div>
      <DrawerWelcome open={isWelcomeOpen} onClose={() => drawerStore.setWelcome(false)} />
      <DrawerSettings open={isSettingsOpen} onClose={() => drawerStore.setSettings(false)} />
    </>
  );
}

export default Authenticated;
