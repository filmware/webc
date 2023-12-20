import { message } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import Root from '@/components/Root';
import Spin from '@/components/Spin';
import { appPaths } from '@/routes';
import streamStore from '@/stores/stream';

function SignOut() {
  const isLoggingOut = useRef(false);
  const navigate = useNavigate();
  const [messageApi, contextHolder] = message.useMessage();

  const logout = useCallback(async () => {
    try {
      await streamStore.logout();
    } catch (e) {
      messageApi.open({ type: 'error', content: `Unable to login - ${(e as Error).message}` });
    } finally {
      navigate(appPaths.signIn());
    }
  }, [messageApi, navigate]);

  useEffect(() => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;
    logout();
  }, [logout]);

  return (
    <Root layout="center">
      <Spin block tip="Signing out..." />
      {contextHolder}
    </Root>
  );
}

export default SignOut;
