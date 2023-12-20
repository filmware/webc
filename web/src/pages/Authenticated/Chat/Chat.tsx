import { Input } from 'antd';
import { useObservable } from 'micro-observables';
import { useCallback, useMemo, useState } from 'react';

import AcronymIcon from '@/components/AcronymIcon';
import Icon from '@/components/Icon';
import Page from '@/components/Page';
import SideBar from '@/pages/Authenticated/Chat/SideBar';
import streamStore from '@/stores/stream';
import { timeFormat } from '@/utils/date';

import css from './Chat.module.scss';

function Chat() {
  const [inputValue, setInputValue] = useState('');
  const topicUuid = useObservable(streamStore.topicUuid);
  const topicMap = useObservable(streamStore.topicMap);
  const commentList = useObservable(streamStore.commentList);
  const commentMap = useObservable(streamStore.commentMap);

  const topicTitle = useMemo(() => {
    return (topicUuid && topicMap[topicUuid].name) ?? 'Messages';
  }, [topicMap, topicUuid]);

  const handleInputPressEnter = useCallback(() => {
    const request = streamStore.uploadComment(inputValue);
    if (request) request.onFinish = () => setInputValue('');
  }, [inputValue]);

  return (
    <Page sidebar={<SideBar />} title={topicTitle}>
      <div className={css.base}>
        <div className={css.messages}>
          {commentList.map((uuid) => {
            const comment = commentMap[uuid];
            return (
              <div className={css.message} key={uuid}>
                <div className={css.avatar}>
                  <AcronymIcon size="large" value={comment.user} />
                </div>
                <div className={css.content}>
                  <div className={css.header}>
                    <span className={css.user}>{comment.user}</span>
                    <span className={css.time}>{timeFormat(comment.authortime)}</span>
                    <div className={css.options}>
                      <Icon name="chat" />
                    </div>
                  </div>
                  <div className={css.body}>{comment.body}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className={css.input}>
          <Input
            allowClear
            placeholder="Enter a message"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onPressEnter={handleInputPressEnter}
          />
        </div>
      </div>
    </Page>
  );
}

export default Chat;
