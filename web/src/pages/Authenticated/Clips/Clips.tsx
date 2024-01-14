import { Table } from 'antd';
import { useMemo } from 'react';

import Page from '@/components/Page';

function Clips() {
  const columns = useMemo(() => {
    return [
      { key: 'mag', dataIndex: 'mag', title: 'Mag' },
      { key: 'scene', dataIndex: 'scene', title: 'Scene' },
      { key: 'take', dataIndex: 'take', title: 'Take' },
      { key: 'cameraStart', dataIndex: 'cameraStart', title: 'Camera Start' },
      { key: 'cameraStop', dataIndex: 'cameraStop', title: 'Camera Stop' },
      { key: 'fps', dataIndex: 'fps', title: 'FPS' },
      { key: 'audioStart', dataIndex: 'audioStart', title: 'Audio Start' },
      { key: 'audioStop', dataIndex: 'audioStop', title: 'Audio Stop' },
      { key: 'frameSize', dataIndex: 'frameSize', title: 'Audio Stop' },
      { key: 'scriptNotes', dataIndex: 'scriptNotes', title: 'Script Notes' },
    ];
  }, []);

  return (
    <Page title="Clips">
      <Table columns={columns} dataSource={[]} scroll={{ x: 1200 }} />
    </Page>
  );
}

export default Clips;
