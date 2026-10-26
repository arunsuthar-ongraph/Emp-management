import { useEffect } from 'react';
import { Alert, App, Button, Card, Col, Divider, Form, Input, Radio, Row, Select, Space, Typography } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, errMsg, get } from '../api';
import { PageHeader } from '../components/common';

export default function Settings() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const welcome = params.get('welcome') === '1'; // arrived straight from sign-up
  const { data } = useQuery({ queryKey: ['company'], queryFn: () => get('/settings/company') });
  const { data: states = [] } = useQuery({ queryKey: ['states'], queryFn: () => get('/payroll/states') });
  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: (v: any) => api.patch('/settings/company', v),
    onSuccess: () => message.success('Company settings saved'),
    onError: (e) => message.error(errMsg(e)),
  });

  return (
    <>
      <PageHeader title="Company settings" />
      {welcome && (
        <Alert
          type="success"
          showIcon
          style={{ maxWidth: 820, marginBottom: 16 }}
          message={`Welcome! ${data?.name || 'Your company'} is ready.`}
          description={
            <>
              Three steps to get going:
              <ol style={{ margin: '6px 0 8px', paddingLeft: 20 }}>
                <li>Add your company details below (registered address, PAN, TAN, PF and ESI codes) and save.</li>
                <li>Set up departments, for example Engineering, HR or Finance.</li>
                <li>Add your employees and give them logins.</li>
              </ol>
              <Space wrap>
                <Button size="small" onClick={() => navigate('/organization')}>Set up departments</Button>
                <Button size="small" onClick={() => navigate('/employees')}>Add employees</Button>
              </Space>
            </>
          }
        />
      )}
      <Card style={{ maxWidth: 820 }}>
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Row gutter={12}>
            <Col xs={24} sm={16}><Form.Item name="name" label="Company name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={8}>
              <Form.Item name="state" label="State" tooltip="Used for Professional Tax" rules={[{ required: true }]}>
                <Select options={states.map((s: any) => ({ value: s.code, label: s.name }))} />
              </Form.Item>
            </Col>
            <Col xs={24}><Form.Item name="address" label="Registered address"><Input.TextArea rows={2} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="pan" label="Company PAN"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="tan" label="TAN (for TDS)"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="pfCode" label="PF establishment code"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="esiCode" label="ESI code"><Input /></Form.Item></Col>
          </Row>
          <Divider orientation="left" plain>Leave approval flow</Divider>
          <Form.Item name="leaveApprovalFlow" extra="Applies to new leave requests. If an approver is missing, the next one in the chain is used, and HR/Admin handle requests with no approver. HR/Admin can always override.">
            <Radio.Group>
              <Space direction="vertical">
                <Radio value="MANAGER_THEN_HEAD"><b>Reporting manager → Department head</b> <Typography.Text type="secondary">(two levels, recommended for large teams)</Typography.Text></Radio>
                <Radio value="MANAGER"><b>Reporting manager only</b></Radio>
                <Radio value="DEPARTMENT_HEAD"><b>Department head only</b> <Typography.Text type="secondary">(e.g. PHP / MERN / Python stack head)</Typography.Text></Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending}>Save changes</Button>
        </Form>
      </Card>
    </>
  );
}
