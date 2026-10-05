# Supabase client contract

Apply all files in `migrations/` in timestamp order. All IDs UUID. Dates `YYYY-MM-DD`; timestamps ISO UTC; outlet and attendance use Asia/Jakarta. Client may read tables but employee/attendance/leave writes must use RPC. All RPCs return a row object unless described otherwise. Failure is a Postgres error with Indonesian message; show that message to the user, never mark a failed mutation as successful.

## Tables

- `departments`: id, name, active.
- `positions`: id, department_id, name, is_cashier, active.
- `outlets`: id, code, name, address, latitude, longitude, radius_m (default100), max_accuracy_m(default100), opens_at, closes_at, morning_starts_at(default07:00), afternoon_starts_at(default15:00), late_tolerance_minutes(default0), production_location, active.
- `employees`: id, employee_number(autoRK000001), auth_user_id, full_name, whatsapp, department_id, position_id, outlet_id, approver_employee_id, approval_mode(`internal`/`external`), starts_on, employment_type(`permanent`), status(`active`/`inactive`), account_status(`uninvited`/`pending`/`active`/`disabled`), ends_on, exit_reason, can_clock, can_middle_shift, weekly_off_days(int[];0=Sunday), birthday, gender(`male`/`female`/`unspecified`), address, emergency_name, emergency_phone, photo_path.
- `employee_roles`: employee_id, role(`employee`/`admin_hr`/`head_baker`). Approver permission comes from the relationship, not HR role.
- `attendance`: id, employee_id, outlet_id, work_date, shift(`morning`/`afternoon`/`middle`), expected_in(nullforMiddle), expected_out, clock_in, clock_out, selfie_path, late_minutes, worked_minutes, in_distance_m, out_distance_m, corrected, source(`clock`/`manual`). Manual records have null selfie/GPS evidence and must be visibly labeled as HR entries. Remaining snapshot/location fields available for recap.
- `leave_requests`: id, employee_id, kind(`annual`/`personal`/`sick`), extent(`full_day`/`late_arrival`/`temporary_exit`/`early_departure`), starts_on, ends_on, starts_at, ends_at, reason, status(`pending`/`approved`/`rejected`/`cancelled`/`needs_info`), deductions(year->daysJSON), decision_by, external_decider, decision_note, decided_at, created_at.
- `leave_adjustments`: id, leave_request_id, type(`change`/`cancel`), starts_on, ends_on, starts_at, ends_at, reason, status(`pending`/`approved`/`rejected`), decision_by, external_decider, decision_note, decided_at.
- `leave_ledger`: immutable signed amount; negative deduction/positive refund, year. Never insert directly.
- `audit_events`: actor_employee_id, entity, entity_id, action, reason, before_data, after_data, created_at. HR-only read.

## Auth Edge Function `hr-api`

Call `supabase.functions.invoke('hr-api',{body:{action,...}})`; public login/activation work with publishable/anonkey.

- `login`: employee_number,password -> `{session,user}`. Set Supabase session with access_token and refresh_token. Employee number case-insensitive. Only active linked accounts work.
- `issue_activation` / `issue_reset`: employee_id; authenticated AdminHR -> `{url,expires_at,employee_number,full_name,message}`. URL can be copied into WhatsApp manually; it is not sent.
- A token currently being consumed cannot be replaced during its five-minute claim lease. HR can replace abandoned/expired claims afterward; the old token is revoked and cannot finalize. This prevents worker failures from permanently blocking activation/reset.
- `activate` / `reset_password`: token,password -> `{ok:true,employee_number}`. Password >=10 characters. Then log in normally.
- `inspect_token`: token -> `{purpose,employee_number,full_name,expires_at}` for activation form. No DB write.
- `bootstrap`: bootstrap_secret,full_name,whatsapp,password,outlet_name -> `{ok:true,employee_number}`. Server `HR_BOOTSTRAP_SECRET` must be at least32characters, works only before an AdminHR exists. Creates initial admin and the provided outlet with coordinates unset; department/position structure is seeded by migration. Remove bootstrap secret after success. Configure the outlet coordinates before clock in can work.

Server-only env: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN` (canonical frontend origin), optional `HR_BOOTSTRAP_SECRET`. Edge verifier disabled because actions explicitly verify user JWT when needed. No servicekey goes to browser.

## Authenticated RPC

- `employee_directory()` -> active employee array with safe id,employee_number,full_name,department_id,position_id,outlet_id,approver_employee_id,approval_mode,status,can_clock,can_middle_shift. Use these work fields to resolve names and team approval relationships. Private profiles remain readable only by their owner/AdminHR; directory omits phone, address, birthday, start date and login identity. Approvers obtain team balance with `leave_balance`, not a local calculation from private start date/ledger.
- `hr_save_employee({p_employee:object,p_id:null|uuid,p_reason:string})` -> employee. Work snake fields permitted; auth_user_id/employee_number/account_status not permitted. New employee gets `employee` role. Use `hr_set_roles({p_employee_id,p_roles:['admin_hr',...]})` separately. Own roles cannot be changed.
- `update_my_profile({p_profile:{address,emergency_name,emergency_phone,photo_path}})` -> employee.
- `attendance_clock_in({p_shift,p_latitude,p_longitude,p_accuracy_m,p_selfie_path})` -> attendance. First upload new camera JPEG to private `attendance-selfies` at `${auth.uid()}/${crypto.randomUUID()}.jpg`. Server checks distance, accuracy, ownership, photo presence, employee permissions and concurrent duplicates. Clock in/out are database time.
- `attendance_clock_out({p_latitude,p_longitude,p_accuracy_m})` -> attendance. Resolves open session automatically including across midnight.
- `attendance_correct({p_id,p_clock_in,p_clock_out,p_reason,p_shift:null|'morning'|'afternoon'|'middle'})` -> attendance; HR-only, no own correction; original saved in audit. Use ISO timestamps, null clockout allowed. Shift correction recalculates lateness from original outlet schedule snapshots, not today's settings.
- `attendance_record_manual({p_employee_id,p_shift,p_clock_in,p_clock_out:null|ISOtimestamp,p_reason})` -> attendance; HR-only, no own entry. For failed GPS/camera or forgotten clock in with no existing row. Reason must have at least five characters; work date derives from supplied time in Asia/Jakarta. Times cannot be in the future and duplicate/overlapping records are rejected. Uses current employee outlet settings, preserves a schedule snapshot, `source:'manual'`, `corrected:true`, and an audit event. It records no fabricated GPS or selfie. Correct an existing row with `attendance_correct` instead.
- `leave_balance({p_employee_id:null|uuid,p_year:2026})` -> `{year,allowance,used,remaining,expired}`. Entitlement computes calendar three months with first eligible month counted full; each new year independent. `expired:true` means no spendable balance even if historical remaining positive.
- `leave_submit({p_kind,p_starts_on,p_ends_on,p_reason,p_extent:'full_day',p_starts_at:null,p_ends_at:null,p_attachment_path:null})` -> request.
- Partial-day requests use one date. `late_arrival` and `early_departure` accept the relevant time in `p_starts_at` (single input; `p_ends_at:null`). `temporary_exit` requires both `p_starts_at` and a later `p_ends_at`. The same validation applies when proposing date/time changes. Approved late-arrival requests and their times remain available to recap alongside actual `late_minutes`; approval does not silently erase actual lateness.
- `leave_decide({p_id,p_decision:'approved'|'rejected'|'needs_info',p_deductions:{'2026':2},p_note:null,p_external_decider:null})` -> request. EmptyJSON means no deduction. Non-own approver only; for externalapproval, anotherAdminHR records externalname.
- `leave_request_change({p_id,p_starts_on,p_ends_on,p_reason,p_starts_at:null,p_ends_at:null})` -> `{request,adjustment}`. Pending request edits immediately; approved creates pending adjustment preserving olddates/balance.
- `leave_request_cancel({p_id,p_reason})` -> `{request,adjustment}`. Pending directcancel, approved pending adjustment preserving oldrequest.
- `leave_decide_adjustment({p_id:adjustmentUUID,p_approved:boolean,p_deductions:{'2026':1},p_note:null,p_external_decider:null})` -> adjustment. New deduction total (notdelta); cancellation ignores deductions and refunds old charge to originalyear. Reject leaves original untouched. Transactions lock employee balance; duplicate decisions rejected.

For crossyear requests, UI must split total deduction by year explicitly. Always show allocation before approval. Final sum may be dynamic; DB validates each year's remaining. Refund from an expiredyear is recorded historically and never becomes nextyear balance.

Realtime tables: employees,attendance,leave_requests,leave_adjustments. Re-fetch after changes and appresume. All private tables require active account via RLS, including JWTs retained after disabling profile. Selfie signed URL may be obtained only by employeeowner/AdminHR; cache neither privatephotos nor signedURLs in serviceworker.

Optional leave evidence uploads to private `leave-attachments` at `${auth.uid()}/${crypto.randomUUID()}.jpg` (JPEG/PNG/WebP/PDF,max5MiB); p_attachment_path is validated against actual uploaded object and current owner. Read allowed to employeeowner, assignedapprover, AdminHR. Profile photos use private `profile-photos` with same ownerpath and max5MiB imageformats; employee/HR only. Uploads cannot be overwritten. Active owners may remove unused uploads after a failed save; RLS denies deleting objects referenced by any attendance, leave request or employee profile, even when that reference is hidden from the owner by RLS. HR cannot remove another user's upload.

Master tables support `.insert`/`.update` for HR. No delete; set active=false. UI validates emptyfields. Positions is_cashier is a form convenience; set employee can_clock explicitly and server permission remains authoritative.
