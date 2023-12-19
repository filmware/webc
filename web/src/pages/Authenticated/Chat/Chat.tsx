import { Input } from 'antd';

import Page from '@/components/Page';
import SideBar from '@/pages/Authenticated/Chat/SideBar';
import { randomUUID } from '@/utils/string';

import css from './Chat.module.scss';

const MESSAGES = new Array(50).fill(null).map(() => ({
  key: randomUUID(),
  message: 'This is a message',
}));

function Chat() {
  return (
    <Page sidebar={<SideBar />} title="Chat">
      <div className={css.base}>
        <div className={css.messages}>
          {MESSAGES.map((m) => (
            <div className={css.message} key={m.key}>
              {m.message}
            </div>
          ))}
        </div>
        <div className={css.input}>
          <Input allowClear placeholder="Enter a message" />
        </div>
      </div>
    </Page>
  );
}

export default Chat;
