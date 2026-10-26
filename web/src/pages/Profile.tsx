import { useEffect, useState } from 'react';
import { Alert, App, Avatar, Button, Card, Col, Descriptions, Form, Input, Popconfirm, Row, Space, Tabs, Tag, Typography, Upload } from 'antd';
import { CameraOutlined, CrownOutlined, DeleteOutlined, LockOutlined, MailOutlined, PhoneOutlined, SaveOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errMsg, fmtDate, get, ROLE_COLOR, ROLE_LABEL } from '../api';
import { useAuth } from '../auth';
import { PageHeader, StatusTag } from '../components/common';

/** Personal details are read-only except the contact number. */
function PersonalDetails({ emp }: { emp: any }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    form.setFieldsValue({ phone: emp.phone });
  }, [emp, form]);

  const save = useMutation({
    mutationFn: (v: { phone: string }) => api.patch('/profile', { phone: v.phone }),
    onSuccess: (r) => {
      message.success('Contact number updated');
      qc.setQueryData(['profile'], r.data);
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => message.error(errMsg(e)),
  });

  return (
    <>
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)} style={{ maxWidth: 480, marginBottom: 20 }}>
        <Form.Item label="Contact number" required>
          <Space.Compact style={{ width: '100%' }}>
            <Form.Item name="phone" noStyle rules={[{ required: true, message: 'Enter your contact number' }, { pattern: /^[+0-9][0-9 -]{6,18}$/, message: 'Enter a valid phone number' }]}>
              <Input prefix={<PhoneOutlined />} placeholder="+91 98xxxxxxxx" />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>Save</Button>
          </Space.Compact>
        </Form.Item>
      </Form>
      <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="First name">{emp.firstName}</Descriptions.Item>
        <Descriptions.Item label="Last name">{emp.lastName}</Descriptions.Item>
        <Descriptions.Item label="Gender">{emp.gender || '—'}</Descriptions.Item>
        <Descriptions.Item label="Date of birth">{fmtDate(emp.dob)}</Descriptions.Item>
        <Descriptions.Item label="Address" span={2}>{emp.address || '—'}</Descriptions.Item>
        <Descriptions.Item label="Emergency contact">{emp.emergencyName || '—'}</Descriptions.Item>
        <Descriptions.Item label="Emergency phone">{emp.emergencyPhone || '—'}</Descriptions.Item>
      </Descriptions>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        Only your contact number and profile picture can be changed here. To update other details, contact HR.
      </Typography.Paragraph>
    </>
  );
}

/** Profile picture with upload / remove. JPG, PNG or WebP up to 2 MB. */
function AvatarEditor({ url, name }: { url?: string | null; name?: string }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const [busy, setBusy] = useState(false);

  const done = async (data: any, msg: string) => {
    qc.setQueryData(['profile'], data);
    qc.invalidateQueries({ queryKey: ['employees'] });
    await refresh();
    message.success(msg);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <Avatar size={96} src={url || undefined} style={{ background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 38 }}>{name?.charAt(0).toUpperCase()}</Avatar>
      <div style={{ marginTop: 10 }}>
        <Space>
          <Upload
            accept="image/jpeg,image/png,image/webp"
            showUploadList={false}
            beforeUpload={(file) => {
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                message.error('Please choose a JPG, PNG or WebP image');
                return Upload.LIST_IGNORE;
              }
              if (file.size > 2 * 1024 * 1024) {
                message.error('Image must be 2 MB or smaller');
                return Upload.LIST_IGNORE;
              }
              return true;
            }}
            customRequest={async ({ file, onSuccess, onError }) => {
              const body = new FormData();
              body.append('file', file as Blob);
              setBusy(true);
              try {
                const r = await api.post('/profile/avatar', body);
                await done(r.data, 'Profile picture updated');
                onSuccess?.(r.data);
              } catch (e: any) {
                message.error(errMsg(e));
                onError?.(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Button size="small" icon={<CameraOutlined />} loading={busy}>{url ? 'Change photo' : 'Upload photo'}</Button>
          </Upload>
          {url && (
            <Popconfirm title="Remove profile picture?" onConfirm={async () => done((await api.delete('/profile/avatar')).data, 'Profile picture removed')}>
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      </div>
    </div>
  );
}

function PasswordForm() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const change = useMutation({
    mutationFn: (v: any) => api.post('/profile/password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      message.success('Password changed');
      form.resetFields();
    },
    onError: (e) => message.error(errMsg(e)),
  });
  return (
    <Form form={form} layout="vertical" onFinish={(v) => change.mutate(v)} style={{ maxWidth: 420 }}>
      <Form.Item name="currentPassword" label="Current password" rules={[{ required: true }]}>
        <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
      </Form.Item>
      <Form.Item name="newPassword" label="New password" rules={[{ required: true, min: 8, message: 'At least 8 characters' }]} hasFeedback>
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="Confirm new password"
        dependencies={['newPassword']}
        hasFeedback
        rules={[
          { required: true },
          ({ getFieldValue }) => ({
            validator: (_, v) => (!v || getFieldValue('newPassword') === v ? Promise.resolve() : Promise.reject(new Error('Passwords do not match'))),
          }),
        ]}
      >
        <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" loading={change.isPending}>Change password</Button>
    </Form>
  );
}

export default function Profile() {
  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => get('/profile') });
  const emp = data?.employee;
  const acc = data?.account;
  const name = emp ? `${emp.firstName} ${emp.lastName}` : acc?.email;

  return (
    <>
      <PageHeader title="My profile" />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7}>
          <Card loading={isLoading} style={{ textAlign: 'center' }}>
            <AvatarEditor url={acc?.avatarUrl} name={name} />
            <Typography.Title level={4} style={{ margin: '12px 0 4px' }}>{name}</Typography.Title>
            {emp && <Typography.Text type="secondary">{[emp.designation, emp.department].filter(Boolean).join(' · ')}</Typography.Text>}
            <div style={{ margin: '12px 0' }}>
              {acc && <Tag color={ROLE_COLOR[acc.role]}>{ROLE_LABEL[acc.role]}</Tag>}
              {emp && <Tag>{emp.code}</Tag>}
              {emp?.heads?.map((h: string) => <Tag key={h} color="gold" icon={<CrownOutlined />}>Head of {h}</Tag>)}
            </div>
            <Space direction="vertical" size={4} style={{ fontSize: 13 }}>
              <span><MailOutlined /> {acc?.email}</span>
              {emp?.phone && <span><PhoneOutlined /> {emp.phone}</span>}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={17}>
          <Card loading={isLoading}>
            <Tabs
              items={[
                ...(emp
                  ? [
                      { key: 'personal', label: 'Personal details', children: <PersonalDetails emp={emp} /> },
                      {
                        key: 'job',
                        label: 'Job',
                        children: (
                          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                            <Descriptions.Item label="Employee code">{emp.code}</Descriptions.Item>
                            <Descriptions.Item label="Status"><StatusTag status={emp.status} /></Descriptions.Item>
                            <Descriptions.Item label="Department">{emp.department || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Designation">{emp.designation || '—'}</Descriptions.Item>
                            <Descriptions.Item label="Reporting manager">{emp.manager ? `${emp.manager.name} (${emp.manager.email})` : '—'}</Descriptions.Item>
                            <Descriptions.Item label="Date of joining">{fmtDate(emp.joiningDate)}</Descriptions.Item>
                            <Descriptions.Item label="Work email">{emp.email}</Descriptions.Item>
                            <Descriptions.Item label="Departments led">{emp.heads.length ? emp.heads.join(', ') : '—'}</Descriptions.Item>
                          </Descriptions>
                        ),
                      },
                      {
                        key: 'bank',
                        label: 'Statutory & bank',
                        children: (
                          <>
                            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="These details are used for salary and tax. To change them, contact HR with supporting documents." />
                            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                              <Descriptions.Item label="PAN">{emp.pan || '—'}</Descriptions.Item>
                              <Descriptions.Item label="UAN (PF)">{emp.uan || '—'}</Descriptions.Item>
                              <Descriptions.Item label="Bank">{emp.bankName || '—'}</Descriptions.Item>
                              <Descriptions.Item label="Account no.">{emp.bankAccount || '—'}</Descriptions.Item>
                              <Descriptions.Item label="IFSC">{emp.ifsc || '—'}</Descriptions.Item>
                            </Descriptions>
                          </>
                        ),
                      },
                    ]
                  : []),
                { key: 'security', label: 'Change password', children: <PasswordForm /> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
