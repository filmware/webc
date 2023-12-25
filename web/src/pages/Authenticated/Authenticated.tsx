import { useObservable } from 'micro-observables';
import { useEffect, useMemo, useState } from 'react';

import NavBar from '@/components/NavBar';
import DrawerWelcome from '@/drawers/DrawerWelcome';
import AuthRouter from '@/routes/AuthRouter';
import streamStore from '@/stores/stream';

import css from './Authenticated.module.scss';

function Authenticated() {
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
  const projectUuid = useObservable(streamStore.projectUuid);

  const className = useMemo(() => {
    const classes = [css.base];
    return classes.join(' ');
  }, []);

  useEffect(() => {
    if (!projectUuid) setIsWelcomeOpen(true);
  }, [projectUuid]);

  return (
    <>
      <div className={className}>
        <NavBar />
        <div className={css.main}>
          <AuthRouter />
        </div>
      </div>
      <DrawerWelcome open={isWelcomeOpen} onClose={() => setIsWelcomeOpen(false)} />
    </>
  );
}

export default Authenticated;
