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

Locally, both `acme.localhost:5173` and `localhost:5173/acme` work. In production a company can be reached by path on any address (`https://<host>/acme`), or by subdomain once `ROOT_DOMAIN` is set with a wildcard DNS record.

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

## Email notifications (leave)

| Event | Who gets an email |
|---|---|
| Leave requested | The first approver (or HR/Admin if there is none), plus a confirmation to the employee |
| Approved at one step | The next approver in the chain |
| Final approval / rejection | The employee, with the approver's comment |
| Cancelled by employee | Whoever it was waiting on, or the people who approved it if it was already approved |

Emails go out in the background after the change is saved, with up to 3 attempts. A mail problem never blocks the leave action. Failures are written to the API log.

- **Local:** `npm run mail:up` starts [Mailpit](http://localhost:8025), which catches every email so you can read it in the browser. Nothing is delivered to real inboxes.
- **Production:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` and `APP_URL` in `api/.env` (e.g. Amazon SES, SendGrid, Zoho, Google Workspace). With `SMTP_HOST` empty, emails are only logged.
- The seed script never sends emails.

## Deploying to Railway

The app deploys as **one Railway service**: the API also serves the built frontend, so there's no separate web service and no CORS setup. `railway.json` sets the build, start, migration and health check commands.

**1. Create the project**
- **New project → Deploy from GitHub repo**, using the repository root (`railway.json` is picked up automatically).
- **Add → Database → PostgreSQL**, then on the app service set `DATABASE_URL=${{Postgres.DATABASE_URL}}`.

**2. Set variables on the app service**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | at least 32 random characters (`openssl rand -hex 32`). The app won't start without it |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | first platform admin, created on the first start (password of at least 10 characters). Remove the password afterwards |
| `ROOT_DOMAIN` | only with your own domain + wildcard, e.g. `peopledesk.in`. Leave it unset on Railway's generated domain. Read when the app starts, so no rebuild is needed |
| `APP_URL` | optional link format for emails: `https://{slug}.peopledesk.in` or `https://<app>.up.railway.app/{slug}`. Worked out automatically when unset |
| `UPLOAD_DIR` | `/data/uploads` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | your email provider. Leave `SMTP_HOST` empty to only log emails |

**3. Add a Volume** mounted at `/data`. Profile pictures are stored there; without a volume they're lost on every deploy.

**4. Company addresses.** Each company gets its own address. Two styles work, and you can use both:
- **Railway's generated domain (works straight away):** companies sign in at `https://<app>.up.railway.app/<company>`, e.g. `https://hrms-production.up.railway.app/acme`. The Super Admin signs in at `https://<app>.up.railway.app/`. Nothing to configure: email links use Railway's `RAILWAY_PUBLIC_DOMAIN` automatically.
- **Your own domain (optional):** add `peopledesk.in` and the wildcard `*.peopledesk.in` as custom domains in Railway, create the DNS records it shows (including `_acme-challenge` for the wildcard certificate), and set `ROOT_DOMAIN=peopledesk.in`. Companies then sign in at `acme.peopledesk.in`; path addresses keep working too.

**What happens on each deploy:** `npm run build` (Prisma client, API and frontend), then `prisma migrate deploy` as the pre-deploy step, then `npm start`. Railway waits for `/api/health` (which also checks the database) before switching traffic.

**Don't run `npm run seed` in production.** It's demo data and deletes and recreates the "acme" company.

**Run one replica.** Uploads live on the volume (attached to one instance), and leave emails are sent from the app process.

## Where things live

- Role → permission map: `api/src/common/permissions.ts` (mirrored in the web menu)
- Statutory rates (PF, ESI, PT slabs, tax slabs): `api/src/payroll/statutory.ts`
- Payroll maths (pure functions): `api/src/payroll/payroll-calculator.ts`
- Email sending / leave email templates: `api/src/notifications/`
- Hierarchy, team scope and approval chain: `api/src/common/hierarchy.ts`
- LOP / paid-days logic: `AttendanceService.monthSummary` in `api/src/attendance/attendance.service.ts`
