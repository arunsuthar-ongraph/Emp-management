/**
 * Indian statutory rates used by the payroll calculator.
 * Keep every rate here so a rule change is a one-file edit.
 * Values reflect FY 2025-26 rules; confirm with your CA before each financial year.
 */

export const PF = {
  employeeRate: 0.12,
  employerRate: 0.12,
  epsRate: 0.0833, // part of employer share that goes to pension
  epsMaxMonthly: 1250,
  wageCeiling: 15000,
};

export const ESI = {
  employeeRate: 0.0075,
  employerRate: 0.0325,
  grossLimit: 21000, // employees earning above this monthly gross are not covered
};

/** Monthly Professional Tax slabs by state: [upToGross, tax]. Last slab uses Infinity. */
export const PT_SLABS: Record<string, { slabs: [number, number][]; februaryTax?: number }> = {
  MH: { slabs: [[7500, 0], [10000, 175], [Infinity, 200]], februaryTax: 300 },
  KA: { slabs: [[24999, 0], [Infinity, 200]] },
  TS: { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  AP: { slabs: [[15000, 0], [20000, 150], [Infinity, 200]] },
  WB: { slabs: [[10000, 0], [15000, 110], [25000, 130], [40000, 150], [Infinity, 200]] },
  GJ: { slabs: [[11999, 0], [Infinity, 200]] },
};

export const STATES: { code: string; name: string }[] = [
  { code: 'MH', name: 'Maharashtra' },
  { code: 'KA', name: 'Karnataka' },
  { code: 'TS', name: 'Telangana' },
  { code: 'AP', name: 'Andhra Pradesh' },
  { code: 'WB', name: 'West Bengal' },
  { code: 'GJ', name: 'Gujarat' },
  { code: 'TN', name: 'Tamil Nadu' },
  { code: 'DL', name: 'Delhi' },
  { code: 'UP', name: 'Uttar Pradesh' },
  { code: 'HR', name: 'Haryana' },
  { code: 'RJ', name: 'Rajasthan' },
  { code: 'OTHER', name: 'Other' },
];

/** Income tax – new regime (default regime, Section 115BAC). */
export const NEW_REGIME = {
  standardDeduction: 75000,
  slabs: [
    [400000, 0],
    [800000, 0.05],
    [1200000, 0.1],
    [1600000, 0.15],
    [2000000, 0.2],
    [2400000, 0.25],
    [Infinity, 0.3],
  ] as [number, number][],
  rebateLimit: 1200000, // no tax up to this taxable income (Sec 87A), with marginal relief above
  cess: 0.04,
};

/** Salary structure split of monthly CTC. */
export const STRUCTURE = {
  basicPctOfCtc: 0.5, // Labour Code: wages (Basic + DA) should be at least 50% of remuneration
  hraPctOfBasic: 0.5,
};
