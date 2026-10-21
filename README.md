# PeopleDesk HRMS

Multi-tenant employee management for Indian companies: leave, attendance and payroll (PF, ESI, PT, TDS new regime).

- `api/`: NestJS 11 + Prisma + PostgreSQL
- `web/`: React 18 + Vite + Ant Design dashboard

## Run locally

```bash
npm install
npm run setup     # starts Postgres in Docker (port 5433), runs migrations, seeds demo data
npm run dev       # API on http://localhost:3000/api, web on http://localhost:5173
```

Re-seed demo data at any time: `npm run seed -w api`

## Sign-in addresses

Each company has its own subdomain. There is no public sign-up: the platform Super Admin creates companies from **Companies → Create Company**, choosing a subdomain and the first Company Admin login.

| Who | Where (local dev) |
|---|---|
| Platform Super Admin | http://localhost:5173 |
| Company users (demo company) | http://acme.localhost:5173 |

A login only works on its own company's subdomain, and a session token is rejected on any other address. The same email may exist in different companies. A suspended company cannot sign in.

In production, set `VITE_ROOT_DOMAIN` in `web/.env` (e.g. `peopledesk.com`) and point a wildcard DNS record (`*.peopledesk.com`) at the app.

## Demo logins (password `Password@123`)

Company users sign in at `acme.localhost:5173`; the super admin signs in at `localhost:5173`.

| Login | Who | Role |
|---|---|---|
| admin@acme.com | Rahul, Director, head of Management | Company Admin |
| hr@acme.com | Priya, head of Human Resources | HR Admin |
| payroll@acme.com | Anil, head of Finance | Payroll Admin |
| manager@acme.com | Vikram, head of Engineering | Manager |
| lead@acme.com | Rohit, head of the **MERN** stack | Employee |
| lead.php@acme.com / lead.mean@acme.com / lead.python@acme.com / lead.qa@acme.com | Stack heads | Employee |
| teamlead@acme.com | Aditya, MERN team lead | Employee |
| employee@acme.com | Sneha, MERN developer (reports to Aditya) | Employee |
| superadmin@hrms.local | Platform super admin | Super Admin |

## Organization hierarchy & leave approval

- **Departments form a tree**, for example Engineering → PHP / MERN / MEAN / Python / QA. Each department can have a **head**.
- **Reporting line**: every employee can have a reporting manager. Circular lines are blocked.
- **Leave approval follows the hierarchy, not the login role.** When a request is created, the approval chain is built from the company setting (Settings → Leave approval flow):
  - *Reporting manager → Department head* (default)
  - *Reporting manager only*
  - *Department head only*

  If an employee is the head of their own department, the head of the parent department is used. A step is skipped when the person has no active login or appears twice. When no approver is left, the request goes to the HR queue.
- Each approver sees **Leave → Approvals**. Approving moves the request to the next level, and the last level finalizes it. HR/Admin can **override** at any level; that decision is final.
- **Team views** (Team Requests, Team Attendance, dashboard team stats) cover direct and indirect reports plus everyone in the departments a person heads.
- **When someone exits**, their direct reports move to their manager, departments they head lose the head, and requests waiting on them go to the HR queue.
- **Built for large teams**: the employee list is paged and searched on the server, employee pickers search the server, the org chart loads one level at a time, and employees can be moved to a department or manager in bulk.

## Where things live

- Role → permission map: `api/src/common/permissions.ts` (mirrored in the web menu)
- Statutory rates (PF, ESI, PT slabs, tax slabs): `api/src/payroll/statutory.ts`
- Payroll maths (pure functions): `api/src/payroll/payroll-calculator.ts`
- Hierarchy, team scope and approval chain: `api/src/common/hierarchy.ts`
- LOP / paid-days logic: `AttendanceService.monthSummary` in `api/src/attendance/attendance.service.ts`
