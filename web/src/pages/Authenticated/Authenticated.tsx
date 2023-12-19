import { useMemo } from 'react';

import NavBar from '@/components/NavBar';
import AuthRouter from '@/routes/AuthRouter';

import css from './Authenticated.module.scss';

function Authenticated() {
  const className = useMemo(() => {
    const classes = [css.base];
    return classes.join(' ');
  }, []);

  return (
    <div className={className}>
      <NavBar />
      <div className={css.main}>
        <AuthRouter />
      </div>
    </div>
  );
}

export default Authenticated;
