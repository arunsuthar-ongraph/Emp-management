import { useEffect, useMemo, useState } from 'react';
import { Select, SelectProps, Steps, Tooltip, TreeSelect, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { fmtDate, get } from '../api';

// ---------- Department tree ----------
export interface Dept {
  id: string;
  name: string;
  parentId: string | null;
  headId: string | null;
  head: { id: string; code: string; firstName: string; lastName: string } | null;
  _count: { employees: number };
}
export interface DeptNode extends Dept {
  key: string;
  value: string;
  title: string;
  total: number; // members including sub-departments
  path: string;
  children?: DeptNode[];
}

/** Turns the flat department list into a tree with roll-up member counts. */
export function buildDeptTree(depts: Dept[]): DeptNode[] {
  const nodes = new Map<string, DeptNode>(depts.map((d) => [d.id, { ...d, key: d.id, value: d.id, title: d.name, total: 0, path: d.name }]));
  const roots: DeptNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) (parent.children ||= []).push(n);
    else roots.push(n);
  }
  const walk = (n: DeptNode, path: string): number => {
    n.path = path;
    n.children?.sort((a, b) => a.name.localeCompare(b.name));
    n.total = n._count.employees + (n.children || []).reduce((a, c) => a + walk(c, `${path} › ${c.name}`), 0);
    return n.total;
  };
  roots.sort((a, b) => a.name.localeCompare(b.name)).forEach((r) => walk(r, r.name));
  return roots;
}

export function useDepartments() {
  const q = useQuery({ queryKey: ['departments'], queryFn: () => get<Dept[]>('/departments') });
  const tree = useMemo(() => buildDeptTree(q.data || []), [q.data]);
  return { ...q, list: q.data || [], tree };
}

export function DepartmentSelect(props: { value?: string | null; onChange?: (v: string | null) => void; exclude?: string; placeholder?: string; style?: React.CSSProperties; allowClear?: boolean }) {
  const { tree } = useDepartments();
  const strip = (nodes: DeptNode[]): DeptNode[] =>
    nodes.filter((n) => n.id !== props.exclude).map((n) => ({ ...n, children: n.children && strip(n.children) }));
  return (
    <TreeSelect
      treeData={strip(tree)}
      value={props.value || undefined}
      onChange={(v) => props.onChange?.(v ?? null)}
      placeholder={props.placeholder || 'Select department'}
      allowClear={props.allowClear ?? true}
      treeDefaultExpandAll
      showSearch
      treeNodeFilterProp="title"
      style={props.style || { width: '100%' }}
    />
  );
}

// ---------- Employee picker (server-side search, scales to large companies) ----------
type EmpOption = { id: string; code: string; firstName: string; lastName: string; designation?: { name: string } | null };

export function EmployeeSelect({ value, onChange, exclude, mode, ...rest }: Omit<SelectProps, 'options' | 'onChange'> & { exclude?: string; onChange?: (v: any) => void }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const ids = (Array.isArray(value) ? value : value ? [value] : []).join(',');
  const { data: found = [], isFetching } = useQuery({ queryKey: ['emp-options', debounced], queryFn: () => get<EmpOption[]>('/employees/options', { search: debounced }) });
  const { data: selected = [] } = useQuery({ queryKey: ['emp-options-ids', ids], queryFn: () => get<EmpOption[]>('/employees/options', { ids }), enabled: !!ids });

  const options = [...selected, ...found.filter((f) => !selected.some((s) => s.id === f.id))]
    .filter((e) => e.id !== exclude)
    .map((e) => ({ value: e.id, label: `${e.firstName} ${e.lastName} (${e.code})${e.designation ? ` · ${e.designation.name}` : ''}` }));

  return (
    <Select
      {...rest}
      mode={mode}
      value={value || undefined}
      onChange={(v) => onChange?.(v ?? null)}
      showSearch
      filterOption={false}
      onSearch={setSearch}
      loading={isFetching}
      options={options}
      placeholder={rest.placeholder || 'Search employee by name or code'}
      allowClear
      style={rest.style || { width: '100%' }}
    />
  );
}

// ---------- Approval chain ----------
const stepStatus = { APPROVED: 'finish', REJECTED: 'error', PENDING: 'wait', SKIPPED: 'wait' } as const;

export function ApprovalSteps({ request, size = 'small' }: { request: any; size?: 'small' | 'default' }) {
  const steps = request.approvals || [];
  if (!steps.length) return <Typography.Text type="secondary">—</Typography.Text>;
  const current = steps.findIndex((s: any) => s.level === request.currentLevel);
  return (
    <Steps
      size={size}
      direction="horizontal"
      current={request.status === 'PENDING' ? current : -1}
      style={{ minWidth: 240 }}
      items={steps.map((s: any) => {
        const who = s.approver ? `${s.approver.firstName} ${s.approver.lastName}` : 'HR / Admin';
        const actor = s.actedBy?.employee ? `${s.actedBy.employee.firstName} ${s.actedBy.employee.lastName}` : s.actedBy?.email;
        const pendingNow = request.status === 'PENDING' && s.level === request.currentLevel;
        return {
          title: <Tooltip title={s.role}>{who}</Tooltip>,
          status: pendingNow ? 'process' : stepStatus[s.status as keyof typeof stepStatus],
          description: (
            <span style={{ fontSize: 11 }}>
              {pendingNow ? 'Waiting' : s.status === 'SKIPPED' ? 'Skipped' : s.status === 'PENDING' ? s.role : `${s.status.toLowerCase()}${actor && actor !== who ? ` by ${actor}` : ''} · ${fmtDate(s.actedAt)}`}
              {s.comment && <div>“{s.comment}”</div>}
            </span>
          ),
        };
      })}
    />
  );
}
