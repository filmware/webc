import { Card, Col, Row, Select, Statistic } from 'antd';

import Page from '@/components/Page';

function Home() {
  return (
    <Page options={<Select placeholder="Date" />} title="Statistics">
      <Row gutter={[12, 12]}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Completed Days" value="5" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Reports Uploaded" value="5" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Mags Shot" value="60" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Clips Shot" value="360" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="Total Data Size" value="3.2 TB" />
          </Card>
        </Col>
      </Row>
    </Page>
  );
}

export default Home;
