/** What the HR tabs need to know about an employee, passed down from the payroll page's own employee list. */
export interface TabEmployee {
  id: string;
  full_name: string;
  status: string;
}
