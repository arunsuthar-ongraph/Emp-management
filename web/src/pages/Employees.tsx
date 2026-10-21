import { useEffect, useState } from 'react';
import { App, Avatar, Button, Col, DatePicker, Divider, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { ApartmentOutlined, EditOutlined, PlusOutlined, SearchOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errMsg, fmtDate, get, money, ROLE_COLOR, ROLE_LABEL } from '../api';
import { useAuth } from '../auth';
import { PageHeader, StatusTag } from '../components/common';
import { DepartmentSelect, EmployeeSelect } from '../components/org';

const PAGE_SIZE = 20;

/** Bulk move selected employees to a department or a new reporting manager. */
function BulkModal({ kind, ids, onClose }: { kind: 'department' | 'manager' | null; ids: string[]; onClose: (done?: boolean) => void }) {
  const { message } = App.useApp();
  const [value, setValue] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post('/employees/bulk', { employeeIds: ids, [kind === 'department' ? 'departmentId' : 'managerId']: value }),
    onSuccess: (r) => {
      message.success(`${r.data.updated} employee(s) updated`);
      setValue(null);
      onClose(true);
    },
    onError: (e) => message.error(errMsg(e)),
  });
  return (
    <Modal
      title={kind === 'department' ? `Move ${ids.length} employee(s) to department` : `Change reporting manager for ${ids.length} employee(s)`}
      open={!!kind}
      onCancel={() => onClose()}
      onOk={() => save.mutate()}
      okText="Apply"
      confirmLoading={save.isPending}
    >
      {kind === 'department' ? (
        <DepartmentSelect value={value} onChange={setValue} placeholder="Choose department (empty = unassign)" />
      ) : (
        <EmployeeSelect value={value} onChange={setValue} placeholder="Choose new manager (empty = no manager)" />
      )}
    </Modal>
  );
}

export default function Employees() {
  const { can, user } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [editing, setEditing] = useState<any | null>(null);
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<{ search?: string; departmentId?: string; status?: string; page: number }>({ status: 'ACTIVE', page: 1 });
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<'department' | 'manager' | null>(null);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchText || undefined, page: 1 })), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  const { data, isFetching } = useQuery({
    queryKey: ['employees', filters],
    queryFn: () => get('/employees', { ...filters, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const { data: designations = [] } = useQuery({ queryKey: ['designations'], queryFn: () => get('/designations') });

  const canWrite = can('employee.write');
  const canSalary = can('payroll.manage');
  const refresh = () => qc.invalidateQueries({ queryKey: ['employees'] });

  const save = useMutation({
    mutationFn: (v: any) => {
      const body = {
        ...v,
        joiningDate: v.joiningDate.format('YYYY-MM-DD'),
        dob: v.dob ? v.dob.format('YYYY-MM-DD') : undefined,
        password: v.password || undefined,
        role: v.role || undefined,
      };
      return editing ? api.patch(`/employees/${editing.id}`, body) : api.post('/employees', body);
    },
    onSuccess: () => {
      message.success(editing ? 'Employee updated' : 'Employee added');
      refresh();
      qc.invalidateQueries({ queryKey: ['departments'] });
      setOpen(false);
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const toggle = useMutation({
    mutationFn: (e: any) => api.patch(`/employees/${e.id}/status`, { status: e.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: refresh,
    onError: (e) => message.error(errMsg(e)),
  });

  const openForm = (e?: any) => {
    setEditing(e || null);
    form.resetFields();
    form.setFieldsValue(
      e ? { ...e, joiningDate: dayjs(e.joiningDate), dob: e.dob ? dayjs(e.dob) : undefined, role: e.user?.role } : { joiningDate: dayjs(), role: 'EMPLOYEE' },
    );
    setOpen(true);
  };

  const roleOptions = ['EMPLOYEE', 'MANAGER', 'HR_ADMIN', 'PAYROLL_ADMIN', ...(user?.role === 'COMPANY_ADMIN' ? ['COMPANY_ADMIN'] : [])].map((r) => ({ value: r, label: ROLE_LABEL[r] }));

  return (
    <>
      <PageHeader
        title={`Employees (${data?.total ?? 0})`}
        extra={
          <>
            <Input prefix={<SearchOutlined />} placeholder="Search name, code, email" allowClear value={searchText} onChange={(e) => setSearchText(e.target.value)} style={{ width: 230 }} />
            <DepartmentSelect value={filters.departmentId} onChange={(v) => setFilters((f) => ({ ...f, departmentId: v || undefined, page: 1 }))} placeholder="All departments" style={{ width: 200 }} />
            <Select value={filters.status || 'ALL'} style={{ width: 120 }} onChange={(v) => setFilters((f) => ({ ...f, status: v === 'ALL' ? undefined : v, page: 1 }))}
              options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Exited' }, { value: 'ALL', label: 'All' }]} />
            {canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>Add Employee</Button>}
          </>
        }
      />

      {canWrite && selected.length > 0 && (
        <Space style={{ marginBottom: 12, padding: '8px 12px', background: '#eef2ff', borderRadius: 8, width: '100%' }} wrap>
          <b>{selected.length} selected</b>
          <Button size="small" icon={<ApartmentOutlined />} onClick={() => setBulk('department')}>Move to department</Button>
          <Button size="small" icon={<UserSwitchOutlined />} onClick={() => setBulk('manager')}>Change reporting manager</Button>
          <Button size="small" type="link" onClick={() => setSelected([])}>Clear</Button>
        </Space>
      )}

      <Table
        rowKey="id"
        loading={isFetching}
        dataSource={data?.items || []}
        scroll={{ x: 1000 }}
        rowSelection={canWrite ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]), preserveSelectedRowKeys: true } : undefined}
        pagination={{
          current: filters.page,
          pageSize: PAGE_SIZE,
          total: data?.total,
          showSizeChanger: false,
          showTotal: (t, r) => `${r[0]}–${r[1]} of ${t}`,
          onChange: (page) => setFilters((f) => ({ ...f, page })),
        }}
        columns={[
          {
            title: 'Employee',
            render: (_, e: any) => (
              <Space>
                <Avatar src={e.user?.avatarUrl || undefined} style={{ background: '#6366f1' }}>{e.firstName[0]}</Avatar>
                <div>
                  <div style={{ fontWeight: 500 }}>{e.firstName} {e.lastName}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{e.code} · {e.email}</Typography.Text>
                </div>
              </Space>
            ),
          },
          { title: 'Department', render: (_, e: any) => e.department?.name || <Tag>Unassigned</Tag> },
          { title: 'Designation', render: (_, e: any) => e.designation?.name || '—' },
          { title: 'Reports to', render: (_, e: any) => (e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—') },
          { title: 'Joined', dataIndex: 'joiningDate', render: fmtDate },
          ...(canSalary ? [{ title: 'CTC (annual)', dataIndex: 'ctcAnnual', render: (v: number) => money(v), align: 'right' as const }] : []),
          { title: 'Login', render: (_, e: any) => (e.user ? <Tag color={ROLE_COLOR[e.user.role]}>{ROLE_LABEL[e.user.role]}</Tag> : <Tag>No login</Tag>) },
          { title: 'Status', dataIndex: 'status', render: (s) => <StatusTag status={s} /> },
          ...(canWrite
            ? [{
                title: '',
                width: 150,
                render: (_: any, e: any) => (
                  <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openForm(e)} />
                    <Popconfirm
                      title={e.status === 'ACTIVE' ? 'Mark as exited?' : 'Reactivate employee?'}
                      description={e.status === 'ACTIVE' ? 'Login is disabled, direct reports move to their manager, and pending approvals go to HR.' : undefined}
                      onConfirm={() => toggle.mutate(e)}
                    >
                      <Button size="small" danger={e.status === 'ACTIVE'}>{e.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</Button>
                    </Popconfirm>
                  </Space>
                ),
              }]
            : []),
        ]}
      />

      <BulkModal kind={bulk} ids={selected} onClose={(done) => { setBulk(null); if (done) { setSelected([]); refresh(); } }} />

      <Drawer
        title={editing ? `Edit ${editing.firstName} ${editing.lastName}` : 'Add Employee'}
        width={Math.min(640, window.innerWidth)}
        open={open}
        onClose={() => setOpen(false)}
        extra={<Button type="primary" loading={save.isPending} onClick={() => form.submit()}>Save</Button>}
      >
        <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
          <Divider orientation="left" plain>Personal</Divider>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="firstName" label="First name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="lastName" label="Last name" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="phone" label="Phone"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="gender" label="Gender"><Select allowClear options={['Male', 'Female', 'Other'].map((g) => ({ value: g, label: g }))} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="dob" label="Date of birth"><DatePicker style={{ width: '100%' }} format="DD MMM YYYY" /></Form.Item></Col>
            <Col xs={24}><Form.Item name="address" label="Address"><Input.TextArea rows={2} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="emergencyName" label="Emergency contact name"><Input /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="emergencyPhone" label="Emergency contact phone"><Input /></Form.Item></Col>
          </Row>

          <Divider orientation="left" plain>Job &amp; Hierarchy</Divider>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="code" label="Employee code" tooltip="Leave blank to auto-generate"><Input placeholder="Auto" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="joiningDate" label="Joining date" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} format="DD MMM YYYY" /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="departmentId" label="Department / Stack"><DepartmentSelect /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="designationId" label="Designation"><Select allowClear options={designations.map((d: any) => ({ value: d.id, label: d.name }))} /></Form.Item></Col>
            <Col xs={24}>
              <Form.Item name="managerId" label="Reporting manager" extra="First approver for this employee's leave">
                <EmployeeSelect exclude={editing?.id} />
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain>Statutory &amp; Bank</Divider>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="pan" label="PAN"><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="uan" label="UAN (PF)"><Input /></Form.Item></Col>
            <Col xs={24} sm={8}><Form.Item name="bankName" label="Bank"><Input /></Form.Item></Col>
            <Col xs={24} sm={8}><Form.Item name="bankAccount" label="Account no."><Input /></Form.Item></Col>
            <Col xs={24} sm={8}><Form.Item name="ifsc" label="IFSC"><Input style={{ textTransform: 'uppercase' }} /></Form.Item></Col>
          </Row>

          {canSalary && (
            <>
              <Divider orientation="left" plain>Salary</Divider>
              <Form.Item name="ctcAnnual" label="Annual CTC (₹)">
                <InputNumber style={{ width: '100%' }} min={0} step={10000} formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} />
              </Form.Item>
            </>
          )}

          <Divider orientation="left" plain>Login Access</Divider>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="role" label="Role" extra="Department heads can keep the Employee role"><Select options={roleOptions} /></Form.Item></Col>
            <Col xs={24} sm={12}>
              <Form.Item name="password" label={editing?.user ? 'Reset password' : 'Password'} tooltip="Set a password to give this employee a login">
                <Input.Password placeholder={editing?.user ? 'Leave blank to keep' : 'Optional'} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Drawer>
    </>
  );
}
