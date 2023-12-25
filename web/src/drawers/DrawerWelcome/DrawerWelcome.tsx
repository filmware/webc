import { Button, Divider, Select } from 'antd';
import { useObservable } from 'micro-observables';
import { useCallback, useMemo, useState } from 'react';

import Drawer from '@/components/Drawer';
import Logo from '@/components/Logo';
import streamStore from '@/stores/stream';
import { Uuid } from '@/streams';

import css from './DrawerWelcome.module.scss';

export type Props = {
  open?: boolean;
  onClose?: () => void;
};

function DrawerWelcome({ onClose, open }: Props) {
  const [projectUuid, setProjectUuid] = useState<Uuid>();
  const projectList = useObservable(streamStore.projectList);
  const projectMap = useObservable(streamStore.projectMap);

  const projectOptions = useMemo(() => {
    return projectList.map((uuid) => {
      const project = projectMap[uuid];
      return { label: project.name, value: uuid };
    });
  }, [projectList, projectMap]);

  const handleSelection = useCallback(() => {
    if (!projectUuid) return;
    streamStore.setProjectUuid(projectUuid);
    onClose?.();
  }, [onClose, projectUuid]);

  return (
    <Drawer closeIcon={null} height="100%" open={open} placement="bottom">
      <div className={css.base}>
        <div className={css.content}>
          <div className={css.logo}>
            <Logo full />
          </div>
          <div className={css.description}>
            Welcome to <Logo text />! This might be your first time here. So get started with a
            project to build on.
          </div>
          <div className={css.options}>
            <div className={css.option}>
              <span>Select an existing project to work on.</span>
              <Select
                options={projectOptions}
                placeholder="Select a project"
                value={projectUuid}
                onSelect={(key: string) => setProjectUuid(key)}
              />
              <Button disabled={!projectUuid} type="primary" onClick={handleSelection}>
                Confirm Project Selection
              </Button>
            </div>
            <Divider plain>OR</Divider>
            <Button type="primary">Create a New Project</Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

export default DrawerWelcome;
