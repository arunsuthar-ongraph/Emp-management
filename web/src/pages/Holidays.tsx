import { useState } from 'react';
import { App, Button, Card, Checkbox, DatePicker, Form, Input, Modal, Popconfirm, Select, Table, Tag } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errMsg, fmtDate, get } from '../api';
import { useAuth } from '../auth';
import { PageHeader } from '../components/common';

export default function Holidays() {
  const { can } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(dayjs().year());
  const { data = [], isLoading } = useQuery({ queryKey: ['holidays', year], queryFn: () => get('/holidays', { year }) });
  const canWrite = can('holiday.write');

  const refresh = () => qc.invalidateQueries({ queryKey: ['holidays'] });
  const add = useMutation({
    mutationFn: (v: any) => api.post('/holidays', { ...v, date: v.date.format('YYYY-MM-DD') }),
    onSuccess: () => {
      message.success('Holiday added');
      refresh();
      setOpen(false);
      form.resetFields();
    },
    onError: (e) => message.error(errMsg(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/holidays/${id}`), onSuccess: refresh });

  return (
    <>
      <PageHeader
        title="Holiday Calendar"
        extra={
          <>
            <Select value={year} onChange={setYear} style={{ width: 110 }} options={[-1, 0, 1].map((o) => ({ value: dayjs().year() + o, label: dayjs().year() + o }))} />
            {canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Add Holiday</Button>}
          </>
        }
      />
      <Card bordered={false}>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          pagination={false}
          columns={[
            { title: 'Date', dataIndex: 'date', render: fmtDate },
            { title: 'Day', dataIndex: 'date', render: (d) => dayjs(d).format('dddd') },
            { title: 'Holiday', dataIndex: 'name' },
            { title: 'Type', dataIndex: 'optional', render: (o) => (o ? <Tag color="gold">Optional</Tag> : <Tag color="purple">Company holiday</Tag>) },
            { title: '', render: (_, h: any) => (dayjs(h.date).isBefore(dayjs(), 'day') ? <Tag>Past</Tag> : null) },
            ...(canWrite
              ? [{
                  title: '',
                  render: (_: any, h: any) => (
                    <Popconfirm title="Delete holiday?" onConfirm={() => remove.mutate(h.id)}>
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  ),
                }]
              : []),
          ]}
        />
      </Card>
      <Modal title="Add Holiday" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={add.isPending}>
        <Form form={form} layout="vertical" onFinish={(v) => add.mutate(v)}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} format="DD MMM YYYY" /></Form.Item>
          <Form.Item name="optional" valuePropName="checked"><Checkbox>Optional / restricted holiday (still a working day)</Checkbox></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
