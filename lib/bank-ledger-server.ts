import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { leftDrawer, type DepositStatus } from "@/lib/bank-deposits";
import { buildLedger, type AutoDeposit, type AutoExpense, type AutoPayment, type BankAccount, type BankEntry } from "@/lib/bank-ledger";

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const manila = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/**
 * Everything the Bank Ledger needs, from each account's opening date: the accounts, the encoded entries, and the
 * portal records that post by themselves. Null before migration 202611110098.
 */
export async function loadBankLedger(db: Admin) {
  const acc = await db.from("bank_accounts").select("id,bank,account_name,last4,channel,opening_balance_centavos,opening_on,active").order("bank");
  if (acc.error) return null;
  const accounts = (acc.data ?? []) as BankAccount[];
  if (!accounts.length) return { accounts, entries: [] as BankEntry[], payments: [] as AutoPayment[], deposits: [] as AutoDeposit[], expenses: [] as AutoExpense[], linkable: [] as { id: string; label: string }[] };
  const from = accounts.map((a) => a.opening_on).sort()[0], channels = accounts.map((a) => a.channel);
  const start = `${from}T00:00:00+08:00`;
  const [ent, pay, dep, exp, link] = await Promise.all([
    db.from("bank_entries").select("id,entry_no,account_id,entry_type,entry_on,amount_centavos,payee,description,cheque_no,cheque_status,cleared_on,expense_id,reversal_of,reason").order("entry_on").limit(5000),
    db.from("payments").select("id,amount_centavos,method,received_at,receipts(receipt_number),trainees(legal_first_name,legal_last_name)").eq("valid", true).in("method", channels).gte("received_at", start).limit(10000),
    db.from("bank_deposits").select("id,deposit_no,amount_centavos,account,source,status,deposited_on").or(`account.in.(${channels.map((c) => `"${c}"`).join(",")}),source.in.(${channels.map((c) => `"${c}"`).join(",")})`).gte("deposited_on", from).limit(5000),
    db.from("expenses").select("id,expense_number,voucher_number,payee,amount_centavos,payment_channel,paid_at,status").eq("status", "Paid").in("payment_channel", channels).gte("paid_at", start).limit(5000),
    db.from("expenses").select("id,expense_number,voucher_number,payee,amount_centavos,status").in("status", ["Approved", "Paid"]).order("created_at", { ascending: false }).limit(150),
  ]);
  const payments: AutoPayment[] = (pay.data ?? []).map((p) => {
    const t = one(p.trainees as unknown as { legal_first_name?: string; legal_last_name?: string } | null), r = one(p.receipts as unknown as { receipt_number?: string } | null);
    return { id: p.id as string, on: manila(p.received_at as string), amount: Number(p.amount_centavos), method: p.method as string, reference: r?.receipt_number ?? "Payment", who: t ? `${(t.legal_last_name ?? "").toUpperCase()}, ${t.legal_first_name ?? ""}` : "Payment" };
  });
  const deposits: AutoDeposit[] = (dep.data ?? []).filter((d) => d.deposited_on && leftDrawer(d.status as DepositStatus)).map((d) => ({ id: d.id as string, on: d.deposited_on as string, amount: Number(d.amount_centavos), account: d.account as string, reference: d.deposit_no as string, source: (d.source as string | null) ?? "Cash" }));
  const expenses: AutoExpense[] = (exp.data ?? []).map((x) => ({ id: x.id as string, on: manila(x.paid_at as string), amount: Number(x.amount_centavos), channel: x.payment_channel as string, reference: (x.voucher_number ?? x.expense_number) as string, who: x.payee as string }));
  const linkable = (link.data ?? []).map((x) => ({ id: x.id as string, label: `${x.voucher_number ?? x.expense_number} · ${x.payee} · ₱${(Number(x.amount_centavos) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}` }));
  return { accounts, entries: (ent.data ?? []) as BankEntry[], payments, deposits, expenses, linkable };
}

/** 8:00 PM report lines: cheques outstanding over 30 days, and any account with a negative book balance. */
export async function bankLedgerAlerts(db: Admin) {
  const data = await loadBankLedger(db);
  if (!data?.accounts.length) return [] as string[];
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10), out: string[] = [];
  const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  for (const a of data.accounts.filter((x) => x.active)) {
    const l = buildLedger(a, data);
    if (l.book < 0) out.push(`${a.bank} ${a.account_name}: book balance is negative (${peso(l.book)})`);
    for (const r of l.outstanding.filter((r) => r.on < old)) out.push(`${a.bank} ${r.reference} to ${r.description}: outstanding since ${r.on} (${peso(-r.amount)})`);
  }
  return out;
}
