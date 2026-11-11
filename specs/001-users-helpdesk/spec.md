# Feature 001 — Users pool & Support help desk

Status: **Implemented** · Source: product requirements

## Summary

A web site where people sign in with their Google account. Regular users get a
support help desk where they can open requests and talk to support. Administrators
see the full users pool and answer support requests.

## Actors

| Actor       | Definition                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------ |
| **Visitor** | Not signed in.                                                                             |
| **User**    | Signed in with Google; email not in the admin list.                                        |
| **Admin**   | Signed in with Google; verified email is in the admin list (`ADMIN_EMAILS` configuration). |

## User stories & acceptance criteria

### US-1 Sign in with Google (P1)

As a visitor I want to sign in with my Google account so I don't need a new password.

- AC-1.1 The landing page offers a single "Continue with Google" action.
- AC-1.2 After sign-in, a user record exists in the users pool (created on first sign-in,
  linked by email if the record was pre-loaded).
- AC-1.3 Accounts whose Google email is not verified are rejected.
- AC-1.4 Admins land on the admin area; users land on the help desk.
- AC-1.5 Signing out returns to the landing page.

### US-2 Users pool (P1)

The system keeps a pool of users with: **Name, Surname, Phone number, Email, About**.

- AC-2.1 Email is unique (case-insensitive) and required.
- AC-2.2 Name and surname are pre-filled from the Google profile on first sign-in.
- AC-2.3 A user can view and update their own Name, Surname, Phone and About
  (Email comes from Google and is read-only).

### US-3 Admin: browse all users (P1)

As an admin I want to see all users' data.

- AC-3.1 Admin sees a paginated table with Name, Surname, Email, Phone, About, created date.
- AC-3.2 Admin can search by name, surname, email or phone.
- AC-3.3 Admin can open a user's details, including that user's support requests.
- AC-3.4 A non-admin calling any admin API receives `403`.

### US-4 Help desk: user requests (P1)

As a user I want to contact support.

- AC-4.1 User can create a request with a subject and a message.
- AC-4.2 User sees only **their own** requests, newest activity first, with status.
- AC-4.3 User can open a request, read the conversation and post follow-ups.
- AC-4.4 User can close their own request; posting to a closed request re-opens it.
- AC-4.5 Regular users have no access to any other area (admin URLs redirect/403).

### US-5 Help desk: admin answers (P1)

As an admin I want to answer user requests.

- AC-5.1 Admin sees all requests, filterable by status (open / answered / closed).
- AC-5.2 Admin can reply; the reply is visible to the user, and the status becomes `answered`.
- AC-5.3 A user follow-up sets the status back to `open`.
- AC-5.4 Admin can close a request.

### US-6 Demo data (P2)

- AC-6.1 A database migration loads ~100 realistic fake users (and a few sample requests).
- AC-6.2 Re-running migrations does not duplicate data.

### US-7 Deployment (P1)

- AC-7.1 The site is deployed to Google Cloud using `gcloud` CLI scripts.
- AC-7.2 Only free-tier / free-limit services are used.

## Non-functional requirements

- NFR-1 Modern, responsive, accessible UI (keyboard navigable, light & dark theme).
- NFR-2 p95 API latency < 300 ms for list endpoints at demo scale (100s of rows).
- NFR-3 All API input validated; errors use a consistent JSON shape.
- NFR-4 No secret committed to git.

## Out of scope

Email notifications, file attachments, multiple admin roles, user deletion (GDPR flows).
