# Payroll legal parameters — for counsel review

Status: **engineering reading, not legal advice. Needs review by UAE employment / pensions counsel.**

Every statutory number the payroll engine uses is configuration
(`server/services/payroll/legal-params.ts`, `DEFAULT_LEGAL_PARAMS`). A company can override any
value with `PUT /api/companies/:companyId/payroll/settings` and record that its adviser confirmed
the values (`adviserConfirmed`). Until that flag is set, the Payroll settings tab and the GPSSA
export show the rates as unconfirmed.

| Area                   | Default                                                                                                     | Source the reading is based on                                                                     | Open questions for counsel                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPSSA rates (UAE)      | Employee 5%, employer 12.5%                                                                                 | Federal Decree-Law No. 57 of 2023 on Pensions and Social Security (replacing Federal Law 7/1999)   | Government share (2.5%) is not posted. Abu Dhabi Pension Fund members use the ADPF row below (per employee).                                            |
| ADPF rates (Abu Dhabi) | Employee 5%, employer 15% of basic + housing (`pension.ADPF`, **confirm with adviser**, `confirmed: false`) | Abu Dhabi Law No. 2 of 2000 (Abu Dhabi Pension Fund) as amended                                    | Applies to employees with `pensionScheme = adpf` (UAE nationals registered with ADPF). Confirm the contribution salary, rates and any government share. |
| Pension base           | Basic + housing (`basic_housing`)                                                                           | The code's own header comment ("contribution account salary = basic + housing only"); audit R09-06 | Whether other allowances named in the employment contract belong in the contribution account salary under the 2023 law.                                 |
| Contribution floor/cap | None                                                                                                        | 2023 law and GPSSA circulars set minimum / maximum contribution salaries                           | Confirm the current AED floor and cap and enter them as `minContributionSalary` / `maxContributionSalary`.                                              |
| Other GCC nationals    | Same as UAE, flagged `confirmed: false`                                                                     | GCC Unified Insurance Protection Extension: the home-country scheme's rates apply                  | Confirm rates and bases for SA, BH, KW, OM, QA (they differ from the UAE).                                                                              |
| Gratuity tiers         | 21 days of basic per year for years 1–5, 30 days after                                                      | Federal Decree-Law No. 33 of 2021, Art. 51                                                         | Part-time workers (pro-rated) and the treatment of resignations under old unlimited contracts (no longer distinguished since 2022).                     |
| Daily wage             | Basic / 30                                                                                                  | Art. 51 reading                                                                                    | —                                                                                                                                                       |
| Partial year           | Trailing days / 365 x tier days                                                                             | Art. 51 ("for fractions of the year")                                                              | Whether fractions should use 360 days.                                                                                                                  |
| Minimum service        | One completed year; no accrual before it (catch-up in the first eligible month)                             | Art. 51(1)                                                                                         | —                                                                                                                                                       |
| Gratuity cap           | 24 months of **basic** wage (R09-07; previously total wage)                                                 | Art. 51 ("shall not exceed two years' wage")                                                       | Confirm "wage" means basic wage for the cap.                                                                                                            |
| Unpaid leave           | Excluded from the service period; deducted from pay at basic / 30 per day                                   | Art. 51 (days of unpaid absence are not counted)                                                   | Whether the payroll deduction should use gross / 30 (configurable: `unpaidLeave.basis`).                                                                |
| Overtime               | +25% of hourly basic (1.25); 1.5 for night (22:00–04:00) or rest-day work; hourly basic = basic/30/8        | Art. 19                                                                                            | Rest-day work may alternatively be compensated with a day off.                                                                                          |
| Notice pay in lieu     | Gross wage / 30 per day                                                                                     | Art. 43                                                                                            | —                                                                                                                                                       |
| Leave encashment       | Basic wage / 30 per untaken annual-leave day                                                                | Art. 29 reading                                                                                    | Confirm basic vs gross for encashment.                                                                                                                  |
| Annual leave           | 30 days/year accrued monthly                                                                                | Art. 29 (2 days/month between 6 and 12 months of service)                                          | The first-year 2-days-per-month rule is approximated by monthly accrual.                                                                                |
| Partial month          | Fixed pay (basic + allowances) x days on the payroll in the month / calendar days in the month              | Engineering reading (X4): joiners from the join date, leavers through the termination date         | Whether a 30-day month should be used instead of calendar days.                                                                                         |
| Settlement due date    | A `task.due` event 14 days after termination                                                                | Art. 53                                                                                            | —                                                                                                                                                       |

Final month of a leaver: the payroll run for the month of termination pays the salary for the
days worked (once); the end-of-service settlement covers gratuity, notice pay in lieu, leave
encashment and other items only. Once a settlement exists, that run accrues no further
gratuity (the settlement already settled the whole entitlement against the provision).

## Opening gratuity provision at go-live (A4, M10)

An employee who joined before their first payroll run in Muhasib already earned gratuity. That
provision is an opening balance (2036 at go-live, IAS 19 / IAS 8), not the first month's expense.
The first run refuses to calculate (422 `OPENING_GRATUITY_REQUIRED`) until each such employee has
an opening provision, and suggests the entitlement at the day before the run's month. With it the
run expenses only the month's movement (entitlement at month end - opening - earlier accruals).
Enter `0` only when no provision existed: the whole catch-up is then expensed in that run. The
same amount must be in the 2036 opening balance; the month-end control check compares GL 2036
with opening provisions + run accruals - provisions used by settlements.

## Pension contribution payments (A4, M14)

Approved runs credit 2032 with employee + employer contributions, tagged per line with the fund
(`payroll_items.pension_fund`: `gpssa` — UAE nationals and, under the GCC extension, other GCC
nationals — or `adpf`). `POST /api/companies/:companyId/payroll/pension-payments` records a
payment to one fund (Dr 2032 / Cr bank), capped at that fund's outstanding contributions;
`/pension-payments/:id/reverse` reverses it. The GPSSA / ADPF portal payment itself is external.
The GPSSA export excludes ADPF members (`?fund=adpf` lists them).

## Payroll accrual date (A4, L6)

A run approved after its month accrues at month end; approved inside the month it accrues on the
approval date (same month); it cannot be approved before the month starts. No payroll journal is
future-dated, consistent with final settlements.

## WPS Salary Information File (external boundary)

`server/services/wps-sif.service.ts` writes the Central Bank comma-separated SIF (EDR per
employee, then one SCR) and a validator that parses it back. File name: 13-digit MOHRE
establishment id + `YYMMDDHHMMSS` + `.SIF`. Individual banks and exchange houses (WPS agents)
publish their own variants; confirm the agent's template before the first submission.
The EDR "days on leave" field carries unpaid leave days only (paid annual leave is salary paid in
full, so it does not explain a lower fixed component); confirm this reading with the WPS agent.
Submission and the bank transfer happen outside Muhasib.ai. The WPS status on a run
(submitted / accepted / rejected) is entered by the user and never inferred.

## GPSSA contribution export (external boundary)

`GET /api/payroll-runs/:id/gpssa-export` lists contribution salary and shares per UAE/GCC
national from an approved run. The GPSSA employer portal's upload template must be confirmed;
the export does not submit or pay contributions.
