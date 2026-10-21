import { ESI, NEW_REGIME, PF, PT_SLABS, STRUCTURE } from './statutory';

/** Pure payroll maths – no database access. All amounts in whole rupees. */

const r = (n: number) => Math.round(n);

export interface SalaryStructure {
  ctcAnnual: number;
  monthlyCtc: number;
  basic: number;
  hra: number;
  special: number;
  gross: number;
  employerPf: number;
  employerEsi: number;
  esiApplicable: boolean;
}

/** Splits annual CTC into a monthly structure. Employer PF/ESI are part of CTC. */
export function structureFromCtc(ctcAnnual: number): SalaryStructure {
  const monthlyCtc = ctcAnnual / 12;
  let basic = r(monthlyCtc * STRUCTURE.basicPctOfCtc);
  const employerPf = r(Math.min(basic, PF.wageCeiling) * PF.employerRate);

  let gross = monthlyCtc - employerPf;
  let employerEsi = 0;
  const esiApplicable = gross / (1 + ESI.employerRate) <= ESI.grossLimit;
  if (esiApplicable) {
    gross = gross / (1 + ESI.employerRate);
    employerEsi = Math.ceil(gross * ESI.employerRate);
  }
  gross = r(gross);
  if (basic > gross) basic = gross;
  const hra = Math.max(0, Math.min(r(basic * STRUCTURE.hraPctOfBasic), gross - basic));
  const special = gross - basic - hra;

  return { ctcAnnual, monthlyCtc: r(monthlyCtc), basic, hra, special, gross, employerPf, employerEsi, esiApplicable };
}

export function professionalTax(state: string, monthlyGross: number, month: number): number {
  const cfg = PT_SLABS[state];
  if (!cfg) return 0;
  const tax = cfg.slabs.find(([upTo]) => monthlyGross <= upTo)?.[1] ?? 0;
  return month === 2 && cfg.februaryTax && tax === cfg.slabs[cfg.slabs.length - 1][1] ? cfg.februaryTax : tax;
}

/** Annual income tax under the new regime, including 87A rebate with marginal relief and 4% cess. */
export function annualTaxNewRegime(annualGross: number) {
  const taxable = Math.max(0, annualGross - NEW_REGIME.standardDeduction);
  let tax = 0;
  let lower = 0;
  for (const [upper, rate] of NEW_REGIME.slabs) {
    if (taxable > lower) tax += (Math.min(taxable, upper) - lower) * rate;
    lower = upper;
  }
  if (taxable <= NEW_REGIME.rebateLimit) tax = 0;
  else tax = Math.min(tax, taxable - NEW_REGIME.rebateLimit); // marginal relief
  const cess = tax * NEW_REGIME.cess;
  return { taxable: r(taxable), tax: r(tax), cess: r(cess), total: r(tax + cess) };
}

export interface PayslipCalc {
  earnings: { name: string; amount: number }[];
  deductions: { name: string; amount: number }[];
  employer: { name: string; amount: number }[];
  gross: number;
  totalDeductions: number;
  net: number;
}

/** Monthly payslip: prorates the structure by paid days, then applies PF, ESI, PT and TDS. */
export function calculatePayslip(opts: {
  ctcAnnual: number;
  state: string;
  month: number;
  daysInMonth: number;
  paidDays: number;
}): PayslipCalc {
  const s = structureFromCtc(opts.ctcAnnual);
  const ratio = Math.max(0, opts.paidDays) / opts.daysInMonth;

  const basic = r(s.basic * ratio);
  const hra = r(s.hra * ratio);
  const special = r(s.special * ratio);
  const gross = basic + hra + special;

  const pfWage = Math.min(basic, PF.wageCeiling);
  const pfEmployee = r(pfWage * PF.employeeRate);
  const eps = Math.min(r(pfWage * PF.epsRate), PF.epsMaxMonthly);
  const epf = r(pfWage * PF.employerRate) - eps;

  const esiEmployee = s.esiApplicable ? Math.ceil(gross * ESI.employeeRate) : 0;
  const esiEmployer = s.esiApplicable ? Math.ceil(gross * ESI.employerRate) : 0;

  const pt = gross > 0 ? professionalTax(opts.state, gross, opts.month) : 0;
  const tds = gross > 0 ? r(annualTaxNewRegime(s.gross * 12).total / 12) : 0;

  const earnings = [
    { name: 'Basic', amount: basic },
    { name: 'House Rent Allowance', amount: hra },
    { name: 'Special Allowance', amount: special },
  ];
  const deductions = [
    { name: 'Provident Fund', amount: pfEmployee },
    { name: 'ESI', amount: esiEmployee },
    { name: 'Professional Tax', amount: pt },
    { name: 'Income Tax (TDS)', amount: tds },
  ].filter((d) => d.amount > 0);
  const employer = [
    { name: 'PF – EPF (3.67%)', amount: epf },
    { name: 'PF – EPS (8.33%)', amount: eps },
    { name: 'ESI (3.25%)', amount: esiEmployer },
  ].filter((d) => d.amount > 0);

  const totalDeductions = deductions.reduce((a, d) => a + d.amount, 0);
  return { earnings, deductions, employer, gross, totalDeductions, net: gross - totalDeductions };
}
