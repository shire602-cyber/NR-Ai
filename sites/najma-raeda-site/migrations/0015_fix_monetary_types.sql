-- Fix monetary columns: change real (4-byte float) to numeric(15,2) for exact decimal storage.
-- UAE FTA compliance requires exact monetary figures; floating point storage causes rounding drift.

-- journal_lines
ALTER TABLE journal_lines
  ALTER COLUMN debit TYPE numeric(15,2) USING debit::numeric(15,2),
  ALTER COLUMN credit TYPE numeric(15,2) USING credit::numeric(15,2);

-- invoices
ALTER TABLE invoices
  ALTER COLUMN subtotal TYPE numeric(15,2) USING subtotal::numeric(15,2),
  ALTER COLUMN vat_amount TYPE numeric(15,2) USING vat_amount::numeric(15,2),
  ALTER COLUMN total TYPE numeric(15,2) USING total::numeric(15,2);

-- invoice_lines
ALTER TABLE invoice_lines
  ALTER COLUMN unit_price TYPE numeric(15,2) USING unit_price::numeric(15,2);

-- receipts
ALTER TABLE receipts
  ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2),
  ALTER COLUMN vat_amount TYPE numeric(15,2) USING vat_amount::numeric(15,2);

-- products
ALTER TABLE products
  ALTER COLUMN unit_price TYPE numeric(15,2) USING unit_price::numeric(15,2),
  ALTER COLUMN cost_price TYPE numeric(15,2) USING cost_price::numeric(15,2);

-- inventory_movements
ALTER TABLE inventory_movements
  ALTER COLUMN unit_cost TYPE numeric(15,2) USING unit_cost::numeric(15,2);

-- bank_transactions
ALTER TABLE bank_transactions
  ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2);

-- budgets
ALTER TABLE budgets
  ALTER COLUMN budget_amount TYPE numeric(15,2) USING budget_amount::numeric(15,2);

-- cash_flow_forecasts
ALTER TABLE cash_flow_forecasts
  ALTER COLUMN predicted_inflow TYPE numeric(15,2) USING predicted_inflow::numeric(15,2),
  ALTER COLUMN predicted_outflow TYPE numeric(15,2) USING predicted_outflow::numeric(15,2),
  ALTER COLUMN predicted_balance TYPE numeric(15,2) USING predicted_balance::numeric(15,2);

-- ecommerce_transactions
ALTER TABLE ecommerce_transactions
  ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2),
  ALTER COLUMN platform_fees TYPE numeric(15,2) USING platform_fees::numeric(15,2),
  ALTER COLUMN net_amount TYPE numeric(15,2) USING net_amount::numeric(15,2);

-- transaction_classifications
ALTER TABLE transaction_classifications
  ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2);

-- subscription_plans
ALTER TABLE subscription_plans
  ALTER COLUMN price_monthly TYPE numeric(15,2) USING price_monthly::numeric(15,2),
  ALTER COLUMN price_yearly TYPE numeric(15,2) USING price_yearly::numeric(15,2);

-- engagements
ALTER TABLE engagements
  ALTER COLUMN monthly_fee TYPE numeric(15,2) USING monthly_fee::numeric(15,2);

-- service_invoices
ALTER TABLE service_invoices
  ALTER COLUMN subtotal TYPE numeric(15,2) USING subtotal::numeric(15,2),
  ALTER COLUMN vat_amount TYPE numeric(15,2) USING vat_amount::numeric(15,2),
  ALTER COLUMN total TYPE numeric(15,2) USING total::numeric(15,2),
  ALTER COLUMN paid_amount TYPE numeric(15,2) USING paid_amount::numeric(15,2);

-- service_invoice_lines
ALTER TABLE service_invoice_lines
  ALTER COLUMN unit_price TYPE numeric(15,2) USING unit_price::numeric(15,2),
  ALTER COLUMN amount TYPE numeric(15,2) USING amount::numeric(15,2);

-- tax_return_archive
ALTER TABLE tax_return_archive
  ALTER COLUMN tax_amount TYPE numeric(15,2) USING tax_amount::numeric(15,2);

-- referral_codes
ALTER TABLE referral_codes
  ALTER COLUMN referrer_reward_value TYPE numeric(15,2) USING referrer_reward_value::numeric(15,2),
  ALTER COLUMN referee_reward_value TYPE numeric(15,2) USING referee_reward_value::numeric(15,2),
  ALTER COLUMN total_rewards_earned TYPE numeric(15,2) USING total_rewards_earned::numeric(15,2);

-- referrals
ALTER TABLE referrals
  ALTER COLUMN referrer_reward_amount TYPE numeric(15,2) USING referrer_reward_amount::numeric(15,2),
  ALTER COLUMN referee_reward_amount TYPE numeric(15,2) USING referee_reward_amount::numeric(15,2);

-- corporate_tax_returns (tax_rate stays as real — it's a rate, not a monetary amount)
ALTER TABLE corporate_tax_returns
  ALTER COLUMN total_revenue TYPE numeric(15,2) USING total_revenue::numeric(15,2),
  ALTER COLUMN total_expenses TYPE numeric(15,2) USING total_expenses::numeric(15,2),
  ALTER COLUMN total_deductions TYPE numeric(15,2) USING total_deductions::numeric(15,2),
  ALTER COLUMN taxable_income TYPE numeric(15,2) USING taxable_income::numeric(15,2),
  ALTER COLUMN exemption_threshold TYPE numeric(15,2) USING exemption_threshold::numeric(15,2),
  ALTER COLUMN tax_payable TYPE numeric(15,2) USING tax_payable::numeric(15,2);

-- vat_returns (all box monetary columns)
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
