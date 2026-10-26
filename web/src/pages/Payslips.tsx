import { useState } from 'react';
import { Button, Card, Table } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { get, money, monthName } from '../api';
import { PageHeader } from '../components/common';
import PayslipView from '../components/PayslipView';

export default function Payslips() {
  const [view, setView] = useState<string | null>(null);
  const { data = [], isLoading } = useQuery({ queryKey: ['my-payslips'], queryFn: () => get('/payroll/payslips/me') });

  return (
    <>
      <PageHeader title="My payslips" />
      <Card>
        <Table
          rowKey="id"
          loading={isLoading}
          dataSource={data}
          scroll={{ x: 600 }}
          locale={{ emptyText: 'No payslips published yet' }}
          columns={[
            { title: 'Month', render: (_, p: any) => monthName(p.payrollRun.month, p.payrollRun.year) },
            { title: 'Paid days', dataIndex: 'paidDays', render: Number },
            { title: 'LOP', dataIndex: 'lopDays', render: Number },
            { title: 'Gross', dataIndex: 'gross', render: money, align: 'right' },
            { title: 'Deductions', dataIndex: 'totalDeductions', render: money, align: 'right' },
            { title: 'Net pay', dataIndex: 'net', render: (v) => <b>{money(v)}</b>, align: 'right' },
            { title: '', render: (_, p: any) => <Button icon={<EyeOutlined />} onClick={() => setView(p.id)}>View</Button> },
          ]}
        />
      </Card>
      <PayslipView id={view} onClose={() => setView(null)} />
    </>
  );
}
