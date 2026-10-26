import { useState } from 'react';
import { Alert, App, Avatar, Badge, Button, Card, Drawer, Form, Input, List, Modal, Popconfirm, Space, Table, Tabs, Tag, Tree, Typography } from 'antd';
import { ApartmentOutlined, CrownOutlined, DeleteOutlined, EditOutlined, PlusOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errMsg, get } from '../api';
import { PageHeader } from '../components/common';
import { DepartmentSelect, DeptNode, EmployeeSelect, useDepartments } from '../components/org';

// ---------- Departments ----------
function DepartmentModal({ open, initial, onClose }: { open: boolean; initial: Partial<DeptNode> | null; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const editing = !!initial?.id;

  const save = useMutation({
    mutationFn: (v: any) => (editing ? api.patch(`/departments/${initial!.id}`, v) : api.post('/departments', v)),
    onSuccess: () => {
      message.success('Department saved');
      qc.invalidateQueries({ queryKey: ['departments'] });
      onClose();
    },
    onError: (e) => message.error(errMsg(e)),
  });

  return (
    <Modal
      title={editing ? `Edit ${initial?.name}` : initial?.parentId ? 'Add sub-department' : 'Add department'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      destroyOnClose
      afterOpenChange={(o) => o && form.setFieldsValue({ name: initial?.name, parentId: initial?.parentId || null, headId: initial?.headId || null })}
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate({ ...v, parentId: v.parentId || null, headId: v.headId || null })} preserve={false}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]} extra="e.g. Engineering, PHP, MERN, MEAN, Python, QA">
          <Input />
        </Form.Item>
        <Form.Item name="parentId" label="Parent department" extra="Leave empty for a top-level department">
          <DepartmentSelect exclude={initial?.id} placeholder="None (top level)" />
        </Form.Item>
        <Form.Item name="headId" label="Department head" extra="The head approves leave for this department and all its sub-departments">
          <EmployeeSelect placeholder="Search employee" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function MembersDrawer({ dept, onClose }: { dept: DeptNode | null; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState<string[]>([]);
  const { data, isLoading } = useQuery({
    queryKey: ['employees', 'dept', dept?.id, page],
    queryFn: () => get('/employees', { departmentId: dept!.id, status: 'ACTIVE', page, pageSize: 15 }),
    enabled: !!dept,
  });

  const add = useMutation({
    mutationFn: () => api.post(`/departments/${dept!.id}/members`, { employeeIds: adding }),
    onSuccess: (r) => {
      message.success(`${r.data.moved} employee(s) moved to ${dept!.name}`);
      setAdding([]);
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (e) => message.error(errMsg(e)),
  });

  return (
    <Drawer open={!!dept} onClose={onClose} width={Math.min(760, window.innerWidth)} title={dept && <Space><ApartmentOutlined />{dept.path}</Space>}>
      {dept && (
        <>
          <Card size="small" style={{ marginBottom: 16 }}>
            <Space wrap>
              <CrownOutlined style={{ color: 'var(--warn-ink)' }} />
              Head: {dept.head ? <b>{dept.head.firstName} {dept.head.lastName}</b> : <Tag color="red">Not assigned</Tag>}
              <Tag icon={<TeamOutlined />}>{dept.total} members incl. sub-departments</Tag>
            </Space>
          </Card>
          <Typography.Text strong>Move employees into this department</Typography.Text>
          <Space.Compact style={{ width: '100%', margin: '8px 0 16px' }}>
            <EmployeeSelect mode="multiple" value={adding} onChange={(v) => setAdding(v || [])} placeholder="Search and pick employees" />
            <Button type="primary" icon={<UserAddOutlined />} disabled={!adding.length} loading={add.isPending} onClick={() => add.mutate()}>Move</Button>
          </Space.Compact>
          <Table
            rowKey="id"
            size="small"
            loading={isLoading}
            dataSource={data?.items || []}
            pagination={{ current: page, pageSize: 15, total: data?.total, onChange: setPage, showTotal: (t) => `${t} employees` }}
            columns={[
              { title: 'Employee', render: (_, e: any) => `${e.firstName} ${e.lastName} (${e.code})` },
              { title: 'Department', render: (_, e: any) => (e.departmentId === dept.id ? e.department?.name : <Tag>{e.department?.name}</Tag>) },
              { title: 'Designation', render: (_, e: any) => e.designation?.name || '—' },
              { title: 'Reports to', render: (_, e: any) => (e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '—') },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}

function Departments() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { tree, list, isLoading } = useDepartments();
  const [modal, setModal] = useState<Partial<DeptNode> | null | undefined>(undefined);
  const [members, setMembers] = useState<DeptNode | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`),
    onSuccess: () => {
      message.success('Department deleted');
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: (e) => message.error(errMsg(e)),
  });

  const noHead = list.filter((d) => !d.headId).length;

  return (
    <Card extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setModal({})}>Add department</Button>}
      title={<Typography.Text type="secondary" style={{ fontWeight: 400 }}>Group employees by function or technology stack; the head approves their leave.</Typography.Text>}>
      {noHead > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${noHead} department(s) have no head. Their leave requests go to the reporting manager or HR.`} />}
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={tree}
        pagination={false}
        expandable={{ defaultExpandAllRows: true }}
        scroll={{ x: 760 }}
        columns={[
          { title: 'Department', dataIndex: 'name', render: (n, d: DeptNode) => <Space><b>{n}</b>{d.children?.length ? <Tag>{d.children.length} sub</Tag> : null}</Space> },
          {
            title: 'Head',
            render: (_, d: DeptNode) =>
              d.head ? (
                <Space><Avatar size="small" style={{ background: 'var(--warn-soft)', color: 'var(--warn-ink)' }} icon={<CrownOutlined />} />{d.head.firstName} {d.head.lastName}</Space>
              ) : (
                <Tag color="red">Not assigned</Tag>
              ),
          },
          { title: 'Members', render: (_, d: DeptNode) => (d.children?.length ? `${d._count.employees} direct · ${d.total} total` : d._count.employees) },
          {
            title: '',
            width: 300,
            render: (_, d: DeptNode) => (
              <Space wrap>
                <Button size="small" icon={<TeamOutlined />} onClick={() => setMembers(d)}>Members</Button>
                <Button size="small" icon={<PlusOutlined />} onClick={() => setModal({ parentId: d.id })}>Sub</Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => setModal(d)} />
                <Popconfirm title="Delete department?" description="Sub-departments move up one level; members become unassigned." onConfirm={() => remove.mutate(d.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <DepartmentModal open={modal !== undefined} initial={modal || null} onClose={() => setModal(undefined)} />
      <MembersDrawer dept={members} onClose={() => setMembers(null)} />
    </Card>
  );
}

// ---------- Org chart (lazy loaded by reporting line) ----------
type ChartNode = { id: string; code: string; name: string; designation?: string; department?: string; heads: string[]; reports: number };

const toTreeNode = (e: ChartNode) => ({
  key: e.id,
  isLeaf: e.reports === 0,
  title: (
    <Space size={6} wrap style={{ padding: '2px 0' }}>
      <Avatar size="small" style={e.heads.length ? { background: 'var(--warn-soft)', color: 'var(--warn-ink)' } : { background: 'var(--brand-soft)', color: 'var(--brand)' }}>{e.name[0]}</Avatar>
      <b>{e.name}</b>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{[e.designation, e.department].filter(Boolean).join(' · ')}</Typography.Text>
      {e.heads.map((h) => <Tag key={h} color="gold" icon={<CrownOutlined />}>Head of {h}</Tag>)}
      {e.reports > 0 && <Badge count={e.reports} color="var(--brand)" title="Direct reports" />}
    </Space>
  ),
});

function OrgChart() {
  const [extra, setExtra] = useState<Record<string, ReturnType<typeof toTreeNode>[]>>({});
  const { data: roots = [], isLoading } = useQuery({ queryKey: ['org-chart-root'], queryFn: () => get<ChartNode[]>('/org/chart') });

  const attach = (nodes: any[]): any[] => nodes.map((n) => ({ ...n, children: extra[n.key] ? attach(extra[n.key]) : undefined }));
  const treeData = attach(roots.map(toTreeNode));

  return (
    <Card loading={isLoading} title={<Typography.Text type="secondary" style={{ fontWeight: 400 }}>Reporting lines. Expand a person to load their direct reports.</Typography.Text>}>
      <Tree
        showLine
        blockNode
        height={600}
        treeData={treeData}
        loadData={async (node) => {
          if (extra[node.key as string]) return;
          const rows = await get<ChartNode[]>('/org/chart', { managerId: node.key });
          setExtra((x) => ({ ...x, [node.key as string]: rows.map(toTreeNode) }));
        }}
      />
    </Card>
  );
}

// ---------- Designations ----------
function Designations() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const { data = [], isLoading } = useQuery({ queryKey: ['designations'], queryFn: () => get('/designations') });
  const add = useMutation({
    mutationFn: () => api.post('/designations', { name: name.trim() }),
    onSuccess: () => {
      setName('');
      qc.invalidateQueries({ queryKey: ['designations'] });
    },
    onError: (e) => message.error(errMsg(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/designations/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['designations'] }) });

  return (
    <Card style={{ maxWidth: 640 }}>
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input placeholder="New designation" value={name} onChange={(e) => setName(e.target.value)} onPressEnter={() => name.trim() && add.mutate()} />
        <Button type="primary" icon={<PlusOutlined />} disabled={!name.trim()} onClick={() => add.mutate()}>Add</Button>
      </Space.Compact>
      <List
        loading={isLoading}
        dataSource={data}
        renderItem={(d: any) => (
          <List.Item actions={[<Popconfirm key="d" title="Delete?" onConfirm={() => remove.mutate(d.id)}><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>]}>
            <Space>{d.name}<Tag>{d._count.employees} employees</Tag></Space>
          </List.Item>
        )}
      />
    </Card>
  );
}

export default function Organization() {
  return (
    <>
      <PageHeader title="Organization" />
      <Tabs
        items={[
          { key: 'departments', label: 'Departments & stacks', children: <Departments /> },
          { key: 'chart', label: 'Org chart', children: <OrgChart /> },
          { key: 'designations', label: 'Designations', children: <Designations /> },
        ]}
      />
    </>
  );
}
