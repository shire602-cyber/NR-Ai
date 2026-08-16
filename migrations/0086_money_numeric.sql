-- 0086_money_numeric: convert float (real) money columns to numeric(15,2).
-- Supersedes the never-journaled 0015_fix_monetary_types for the columns it
-- missed. Postgres real is IEEE-754 single precision (~7 sig digits): it stored
-- AED 9,999,999.99 as 10,000,000. Every VAT 201 box and the AED value of a
-- foreign invoice must be exact. Idempotent: re-running is a no-op.

ALTER TABLE vat_returns
  ALTER COLUMN box1a_abu_dhabi_amount TYPE numeric(15,2) USING box1a_abu_dhabi_amount::numeric(15,2),
  ALTER COLUMN box1a_abu_dhabi_vat TYPE numeric(15,2) USING box1a_abu_dhabi_vat::numeric(15,2),
  ALTER COLUMN box1a_abu_dhabi_adj TYPE numeric(15,2) USING box1a_abu_dhabi_adj::numeric(15,2),
  ALTER COLUMN box1b_dubai_amount TYPE numeric(15,2) USING box1b_dubai_amount::numeric(15,2),
  ALTER COLUMN box1b_dubai_vat TYPE numeric(15,2) USING box1b_dubai_vat::numeric(15,2),
  ALTER COLUMN box1b_dubai_adj TYPE numeric(15,2) USING box1b_dubai_adj::numeric(15,2),
  ALTER COLUMN box1c_sharjah_amount TYPE numeric(15,2) USING box1c_sharjah_amount::numeric(15,2),
  ALTER COLUMN box1c_sharjah_vat TYPE numeric(15,2) USING box1c_sharjah_vat::numeric(15,2),
  ALTER COLUMN box1c_sharjah_adj TYPE numeric(15,2) USING box1c_sharjah_adj::numeric(15,2),
  ALTER COLUMN box1d_ajman_amount TYPE numeric(15,2) USING box1d_ajman_amount::numeric(15,2),
  ALTER COLUMN box1d_ajman_vat TYPE numeric(15,2) USING box1d_ajman_vat::numeric(15,2),
  ALTER COLUMN box1d_ajman_adj TYPE numeric(15,2) USING box1d_ajman_adj::numeric(15,2),
  ALTER COLUMN box1e_umm_al_quwain_amount TYPE numeric(15,2) USING box1e_umm_al_quwain_amount::numeric(15,2),
  ALTER COLUMN box1e_umm_al_quwain_vat TYPE numeric(15,2) USING box1e_umm_al_quwain_vat::numeric(15,2),
  ALTER COLUMN box1e_umm_al_quwain_adj TYPE numeric(15,2) USING box1e_umm_al_quwain_adj::numeric(15,2),
  ALTER COLUMN box1f_ras_al_khaimah_amount TYPE numeric(15,2) USING box1f_ras_al_khaimah_amount::numeric(15,2),
  ALTER COLUMN box1f_ras_al_khaimah_vat TYPE numeric(15,2) USING box1f_ras_al_khaimah_vat::numeric(15,2),
  ALTER COLUMN box1f_ras_al_khaimah_adj TYPE numeric(15,2) USING box1f_ras_al_khaimah_adj::numeric(15,2),
  ALTER COLUMN box1g_fujairah_amount TYPE numeric(15,2) USING box1g_fujairah_amount::numeric(15,2),
  ALTER COLUMN box1g_fujairah_vat TYPE numeric(15,2) USING box1g_fujairah_vat::numeric(15,2),
  ALTER COLUMN box1g_fujairah_adj TYPE numeric(15,2) USING box1g_fujairah_adj::numeric(15,2),
  ALTER COLUMN box2_tourist_refund_amount TYPE numeric(15,2) USING box2_tourist_refund_amount::numeric(15,2),
  ALTER COLUMN box2_tourist_refund_vat TYPE numeric(15,2) USING box2_tourist_refund_vat::numeric(15,2),
  ALTER COLUMN box3_reverse_charge_amount TYPE numeric(15,2) USING box3_reverse_charge_amount::numeric(15,2),
  ALTER COLUMN box3_reverse_charge_vat TYPE numeric(15,2) USING box3_reverse_charge_vat::numeric(15,2),
  ALTER COLUMN box4_zero_rated_amount TYPE numeric(15,2) USING box4_zero_rated_amount::numeric(15,2),
  ALTER COLUMN box5_exempt_amount TYPE numeric(15,2) USING box5_exempt_amount::numeric(15,2),
  ALTER COLUMN box6_imports_amount TYPE numeric(15,2) USING box6_imports_amount::numeric(15,2),
  ALTER COLUMN box6_imports_vat TYPE numeric(15,2) USING box6_imports_vat::numeric(15,2),
  ALTER COLUMN box7_imports_adj_amount TYPE numeric(15,2) USING box7_imports_adj_amount::numeric(15,2),
  ALTER COLUMN box7_imports_adj_vat TYPE numeric(15,2) USING box7_imports_adj_vat::numeric(15,2),
  ALTER COLUMN box8_total_amount TYPE numeric(15,2) USING box8_total_amount::numeric(15,2),
  ALTER COLUMN box8_total_vat TYPE numeric(15,2) USING box8_total_vat::numeric(15,2),
  ALTER COLUMN box8_total_adj TYPE numeric(15,2) USING box8_total_adj::numeric(15,2),
  ALTER COLUMN box9_expenses_amount TYPE numeric(15,2) USING box9_expenses_amount::numeric(15,2),
  ALTER COLUMN box9_expenses_vat TYPE numeric(15,2) USING box9_expenses_vat::numeric(15,2),
  ALTER COLUMN box9_expenses_adj TYPE numeric(15,2) USING box9_expenses_adj::numeric(15,2),
  ALTER COLUMN box10_reverse_charge_amount TYPE numeric(15,2) USING box10_reverse_charge_amount::numeric(15,2),
  ALTER COLUMN box10_reverse_charge_vat TYPE numeric(15,2) USING box10_reverse_charge_vat::numeric(15,2),
  ALTER COLUMN box11_total_amount TYPE numeric(15,2) USING box11_total_amount::numeric(15,2),
  ALTER COLUMN box11_total_vat TYPE numeric(15,2) USING box11_total_vat::numeric(15,2),
  ALTER COLUMN box11_total_adj TYPE numeric(15,2) USING box11_total_adj::numeric(15,2),
  ALTER COLUMN box12_total_due_tax TYPE numeric(15,2) USING box12_total_due_tax::numeric(15,2),
  ALTER COLUMN box13_recoverable_tax TYPE numeric(15,2) USING box13_recoverable_tax::numeric(15,2),
  ALTER COLUMN box14_payable_tax TYPE numeric(15,2) USING box14_payable_tax::numeric(15,2),
  ALTER COLUMN box1_sales_standard TYPE numeric(15,2) USING box1_sales_standard::numeric(15,2),
  ALTER COLUMN box2_sales_other_emirates TYPE numeric(15,2) USING box2_sales_other_emirates::numeric(15,2),
  ALTER COLUMN box3_sales_tax_exempt TYPE numeric(15,2) USING box3_sales_tax_exempt::numeric(15,2),
  ALTER COLUMN box4_sales_exempt TYPE numeric(15,2) USING box4_sales_exempt::numeric(15,2),
  ALTER COLUMN box5_total_output_tax TYPE numeric(15,2) USING box5_total_output_tax::numeric(15,2),
  ALTER COLUMN box6_expenses_standard TYPE numeric(15,2) USING box6_expenses_standard::numeric(15,2),
  ALTER COLUMN box7_expenses_tourist_refund TYPE numeric(15,2) USING box7_expenses_tourist_refund::numeric(15,2),
  ALTER COLUMN box8_total_input_tax TYPE numeric(15,2) USING box8_total_input_tax::numeric(15,2),
  ALTER COLUMN box9_net_tax TYPE numeric(15,2) USING box9_net_tax::numeric(15,2),
  ALTER COLUMN adjustment_amount TYPE numeric(15,2) USING adjustment_amount::numeric(15,2),
  ALTER COLUMN payment_amount TYPE numeric(15,2) USING payment_amount::numeric(15,2);

ALTER TABLE invoices
  ALTER COLUMN base_currency_amount TYPE numeric(15,2) USING base_currency_amount::numeric(15,2);

ALTER TABLE corporate_tax_returns
  ALTER COLUMN tax_rate TYPE numeric(6,4) USING tax_rate::numeric(6,4);
