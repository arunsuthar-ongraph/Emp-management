import { Button, Modal, Spin } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { fmtDate, get, money, monthName } from '../api';

type Line = { name: string; amount: number };

/** Rupees in words (Indian numbering) for the payslip footer. */
function inWords(n: number): string {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x: number) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]} ${a[x % 10]}`.trim());
  const three = (x: number) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred ${two(x % 100)}` : two(x)).trim();
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), rest = n % 1e3;
  if (crore) parts.push(`${two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return parts.join(' ');
}

export default function PayslipView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: p, isLoading } = useQuery({ queryKey: ['payslip', id], queryFn: () => get(`/payroll/payslips/${id}`), enabled: !!id });

  const earnings: Line[] = p?.earnings || [];
  const deductions: Line[] = p?.deductions || [];
  const rows = Math.max(earnings.length, deductions.length);

  return (
    <Modal open={!!id} onCancel={onClose} width={780} footer={<Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>Print / Save PDF</Button>}>
      {isLoading || !p ? (
        <Spin />
      ) : (
        <div className="payslip">
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0 }}>{p.company.name}</h2>
            <div style={{ color: '#6b7280', fontSize: 12 }}>{p.company.address}</div>
            <h3 style={{ margin: '12px 0 0' }}>Payslip for {monthName(p.payrollRun.month, p.payrollRun.year)}</h3>
          </div>
          <table style={{ marginBottom: 16 }}>
            <tbody>
              <tr><th>Employee</th><td>{p.employee.firstName} {p.employee.lastName}</td><th>Code</th><td>{p.employee.code}</td></tr>
              <tr><th>Designation</th><td>{p.employee.designation?.name || '—'}</td><th>Department</th><td>{p.employee.department?.name || '—'}</td></tr>
              <tr><th>Date of joining</th><td>{fmtDate(p.employee.joiningDate)}</td><th>PAN</th><td>{p.employee.pan || '—'}</td></tr>
              <tr><th>UAN</th><td>{p.employee.uan || '—'}</td><th>Bank A/c</th><td>{p.employee.bankName} {p.employee.bankAccount ? `XXXX${p.employee.bankAccount.slice(-4)}` : '—'}</td></tr>
              <tr><th>Days in month</th><td>{p.daysInMonth}</td><th>Paid days / LOP</th><td>{Number(p.paidDays)} / {Number(p.lopDays)}</td></tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr><th>Earnings</th><th className="num">Amount</th><th>Deductions</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }).map((_, i) => (
                <tr key={i}>
                  <td>{earnings[i]?.name}</td><td className="num">{earnings[i] && money(earnings[i].amount)}</td>
                  <td>{deductions[i]?.name}</td><td className="num">{deductions[i] && money(deductions[i].amount)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 600, background: '#f9fafb' }}>
                <td>Gross Earnings</td><td className="num">{money(p.gross)}</td>
                <td>Total Deductions</td><td className="num">{money(p.totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
          <div style={{ marginTop: 16, padding: 12, background: '#eef2ff', borderRadius: 8 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Net Pay: {money(p.net)}</div>
            <div style={{ fontSize: 12, color: '#4b5563' }}>Rupees {inWords(Math.round(Number(p.net)))} Only</div>
          </div>
          {p.employer?.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#6b7280' }}>
              Employer contributions (not deducted): {p.employer.map((e: Line) => `${e.name} ${money(e.amount)}`).join(' · ')}
            </div>
          )}
          <div style={{ marginTop: 16, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>This is a computer-generated payslip and does not require a signature.</div>
        </div>
      )}
    </Modal>
  );
}
